"""
calibracion.py — MotorBacktest (histórico) y ciclo de calibración isotónica online.
"""
import json
import time
import asyncio
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

import requests
from app.config import (logger, _has_ml, BINANCE_KLINES,
                        redis_client, _precios_recientes, _buffer_predicciones)
from app.indicadores import IndicadoresTecnicos
from app.regimen import DetectorRegimen


class MotorBacktest:
    """
    Calibra la confianza del modelo contra precisión histórica real.
    Descarga 6 meses de velas 1h de Binance, ejecuta la lógica técnica
    sobre ventanas deslizantes y ajusta la curva de confianza con IsotonicRegression.
    """

    CALIBRACION_TTL = 86400   # 24h en Redis
    HORIZONTE       = 6       # velas a futuro para verificar la señal
    STEP            = 3       # salto entre ventanas (reduce cómputo)

    def __init__(self):
        self._estados: dict = {}
        self._lock          = threading.Lock()
        self._executor      = ThreadPoolExecutor(max_workers=1)

    def _descargar_historico_completo(self, symbol: str) -> list:
        """Descarga ~6 meses de klines 1h paginando (máx 1000 por llamada)."""
        todas = []
        end_time = None
        for _ in range(30):   # 30 * 1000 velas = ~42 días cada página, 30 páginas ≈ 3.5 años
            params = f"symbol={symbol}&interval=1h&limit=1000"
            if end_time:
                params += f"&endTime={end_time}"
            resp = requests.get(f"{BINANCE_KLINES}?{params}", timeout=15)
            if resp.status_code != 200:
                break
            page = resp.json()
            if not page:
                break
            todas = page + todas
            end_time = int(page[0][0]) - 1
            if len(todas) >= 4320:   # ~6 meses de velas 1h
                break
            time.sleep(0.12)
        return todas

    @staticmethod
    def _senal_tecnica(df, precio: float) -> tuple:
        """Devuelve (dirección: -1|0|1, confianza_raw: 0-100)."""
        if not _has_ml:
            return 0, 50
        try:
            import pandas as pd
            df2 = df.copy()
            df2['RSI']  = IndicadoresTecnicos.rsi(df2)
            df2['MACD'], macd_sig = IndicadoresTecnicos.macd(df2)
            bb_upper, bb_lower  = IndicadoresTecnicos.bollinger(df2)
            df2.bfill(inplace=True); df2.fillna(0, inplace=True)

            rsi_val   = float(df2['RSI'].iloc[-1]) if not pd.isna(df2['RSI'].iloc[-1]) else 50.0
            macd_hist = float((df2['MACD'] - macd_sig).iloc[-1])
            ema_cross = IndicadoresTecnicos.ema_cross(df2)
            bb_pos    = IndicadoresTecnicos.bollinger_position(precio, bb_upper, bb_lower)
            stoch_rsi = float(IndicadoresTecnicos.stoch_rsi(df2).iloc[-1])

            score = 0.0
            if rsi_val < 30:       score += 0.30
            elif rsi_val > 70:     score -= 0.30
            if stoch_rsi < 0.20:   score += 0.20
            elif stoch_rsi > 0.80: score -= 0.20
            if macd_hist > 0:      score += 0.20
            elif macd_hist < 0:    score -= 0.20
            if ema_cross > 0:      score += 0.15
            elif ema_cross < 0:    score -= 0.15
            if bb_pos < -0.5:      score += 0.15
            elif bb_pos > 0.5:     score -= 0.15

            direccion = 1 if score > 0.10 else -1 if score < -0.10 else 0
            confianza = int(min(95, max(50, abs(score) * 50 + 50)))
            return direccion, confianza
        except Exception:
            return 0, 50

    def _ejecutar(self, symbol: str):
        with self._lock:
            self._estados[symbol] = {"estado": "ejecutando"}
        try:
            import pandas as pd
            import numpy as np
            rows = self._descargar_historico_completo(symbol)
            if len(rows) < 100:
                raise ValueError(f"Datos insuficientes: {len(rows)} velas")

            df_full = pd.DataFrame(rows, columns=[
                'ts','open','high','low','close','vol',
                'close_ts','quote_vol','trades','taker_base','taker_quote','ignore'
            ])
            df_full['Close']  = df_full['close'].astype(float)
            df_full['Volume'] = df_full['vol'].astype(float)
            df_full['High']   = df_full['high'].astype(float)
            df_full['Low']    = df_full['low'].astype(float)
            df_full['RSI']    = IndicadoresTecnicos.rsi(df_full)
            df_full['MACD'], _ = IndicadoresTecnicos.macd(df_full)
            df_full.bfill(inplace=True); df_full.fillna(0, inplace=True)

            n, SEQ = len(df_full), 60
            raw_confs, correct_labels, signals_list = [], [], []

            for i in range(SEQ, n - self.HORIZONTE, self.STEP):
                df_win     = df_full.iloc[i - SEQ:i].copy()
                precio_now = float(df_win['Close'].iloc[-1])
                precio_fut = float(df_full['Close'].iloc[i + self.HORIZONTE - 1])
                pred_dir, raw_conf = self._senal_tecnica(df_win, precio_now)
                cambio = (precio_fut - precio_now) / (precio_now + 1e-9)
                if pred_dir == 1:    correct = 1 if cambio >  0.005 else 0
                elif pred_dir == -1: correct = 1 if cambio < -0.005 else 0
                else:                correct = 1 if abs(cambio) < 0.02 else 0
                raw_confs.append(raw_conf)
                correct_labels.append(correct)
                signals_list.append(pred_dir)

            if len(raw_confs) < 30:
                raise ValueError(f"Muestras insuficientes: {len(raw_confs)}")

            total    = len(correct_labels)
            accuracy = round(sum(correct_labels) / total, 4)
            buys     = [(c, l) for c, l, s in zip(raw_confs, correct_labels, signals_list) if s == 1]
            sells    = [(c, l) for c, l, s in zip(raw_confs, correct_labels, signals_list) if s == -1]
            tp = sum(1 for _, l in buys  if l == 1)
            fp = sum(1 for _, l in buys  if l == 0)
            fn = sum(1 for _, l in sells if l == 0)
            precision = round(tp / (tp + fp + 1e-9), 4)
            recall    = round(tp / (tp + fn + 1e-9), 4)
            buy_returns = [0.01 if l == 1 else -0.01 for _, l in buys]
            r_arr = np.array(buy_returns) if buy_returns else np.array([0.0])
            sharpe = float(r_arr.mean() / (r_arr.std() + 1e-9) * np.sqrt(252))

            from sklearn.isotonic import IsotonicRegression
            X_cal = np.array(raw_confs, dtype=float) / 100.0
            y_cal = np.array(correct_labels, dtype=float)
            iso   = IsotonicRegression(out_of_bounds='clip')
            iso.fit(X_cal, y_cal)
            calibration_map = {
                str(c): round(float(iso.predict([c / 100.0])[0]) * 100, 1)
                for c in range(50, 97)
            }

            buckets: dict = {}
            for conf, correct in zip(raw_confs, correct_labels):
                bkt = (conf // 10) * 10
                if bkt not in buckets:
                    buckets[bkt] = {"total": 0, "correct": 0}
                buckets[bkt]["total"]   += 1
                buckets[bkt]["correct"] += correct

            calibration_curve = {
                bkt: {"predicha": bkt,
                      "real": round(d["correct"] / d["total"] * 100, 1),
                      "muestras": d["total"]}
                for bkt, d in sorted(buckets.items())
            }

            resultado = {
                "symbol":            symbol,
                "muestras":          total,
                "accuracy":          accuracy,
                "precision":         precision,
                "recall":            recall,
                "sharpe_simulado":   round(sharpe, 3),
                "calibration_curve": calibration_curve,
                "timestamp":         datetime.utcnow().isoformat() + "Z",
            }

            if redis_client:
                try:
                    redis_client.setex(f"backtest:{symbol}",     self.CALIBRACION_TTL, json.dumps(resultado))
                    redis_client.setex(f"calibration:{symbol}", self.CALIBRACION_TTL, json.dumps(calibration_map))
                except Exception as e:
                    logger.warning(f"Redis backtest {symbol}: {e}")

            with self._lock:
                self._estados[symbol] = {"estado": "completado", "resultado": resultado}
            logger.info(f"Backtest {symbol} completado — accuracy={accuracy:.1%} muestras={total}")

        except Exception as e:
            logger.error(f"Error backtest {symbol}: {e}")
            with self._lock:
                self._estados[symbol] = {"estado": "error", "error": str(e)}

    def lanzar(self, symbol: str) -> bool:
        with self._lock:
            if self._estados.get(symbol, {}).get("estado") == "ejecutando":
                return False
        self._executor.submit(self._ejecutar, symbol)
        return True

    def estado(self, symbol: str) -> dict:
        with self._lock:
            return self._estados.get(symbol, {"estado": "no_iniciado"})

    @staticmethod
    def aplicar_calibracion(symbol: str, raw_conf: int) -> int:
        if not redis_client:
            return raw_conf
        try:
            cal_json = redis_client.get(f"calibration:{symbol}")
            if not cal_json:
                return raw_conf
            cal_map   = json.loads(cal_json)
            calibrado = cal_map.get(str(raw_conf))
            return int(round(float(calibrado))) if calibrado is not None else raw_conf
        except Exception:
            return raw_conf


# Instancia global
motor_backtest = MotorBacktest()


# ─── Ciclo de calibración online ──────────────────────────────────────────────

async def _ciclo_calibracion_online():
    MIN_OUTCOMES     = 20
    VENTANA_S        = 300
    UMBRAL_MOVIMIENT = 0.005
    nuevos_outcomes: dict = {}

    while True:
        await asyncio.sleep(60)
        ahora = time.time()

        for symbol, buf in list(_buffer_predicciones.items()):
            precio_actual = _precios_recientes.get(symbol)
            if precio_actual is None:
                continue

            pendientes, y_true_list, y_pred_list = [], [], []

            for pred in buf:
                if ahora - pred["ts"] < VENTANA_S:
                    pendientes.append(pred)
                    continue
                movimiento = (precio_actual - pred["price"]) / pred["price"]
                es_compra  = "COMPRAR" in pred["signal"]
                es_venta   = "VENDER"  in pred["signal"]
                if es_compra:
                    acierto = 1 if movimiento >= UMBRAL_MOVIMIENT else 0
                elif es_venta:
                    acierto = 1 if movimiento <= -UMBRAL_MOVIMIENT else 0
                else:
                    continue
                y_true_list.append(acierto)
                y_pred_list.append(pred["conf"])

            _buffer_predicciones[symbol] = pendientes
            nuevos = len(y_true_list)
            if nuevos == 0:
                continue
            nuevos_outcomes[symbol] = nuevos_outcomes.get(symbol, 0) + nuevos
            if nuevos_outcomes.get(symbol, 0) < MIN_OUTCOMES:
                continue

            try:
                cal_key  = f"calibration_raw:{symbol}"
                raw_json = redis_client.get(cal_key) if redis_client else None
                if raw_json:
                    prev = json.loads(raw_json)
                    y_true_list = (prev["y_true"] + y_true_list)[-1000:]
                    y_pred_list = (prev["y_pred"] + y_pred_list)[-1000:]

                from sklearn.isotonic import IsotonicRegression
                import numpy as np
                ir = IsotonicRegression(out_of_bounds="clip")
                ir.fit(y_pred_list, y_true_list)
                confs_raw = list(range(101))
                confs_cal = ir.predict(confs_raw)
                cal_map   = {str(c): round(float(v) * 100, 1) for c, v in zip(confs_raw, confs_cal)}

                if redis_client:
                    redis_client.setex(f"calibration:{symbol}",     86400, json.dumps(cal_map))
                    redis_client.setex(f"calibration_raw:{symbol}", 86400,
                                       json.dumps({"y_true": y_true_list, "y_pred": y_pred_list}))
                    redis_client.set(f"calibration_ts:{symbol}", ahora)

                nuevos_outcomes[symbol] = 0
                logger.info(f"[CalibOnline] {symbol} recalibrado con {len(y_true_list)} muestras")
            except Exception as e:
                logger.debug(f"[CalibOnline] Error calibrando {symbol}: {e}")
