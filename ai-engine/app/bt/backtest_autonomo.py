"""
backtest_autonomo.py — Simulación histórica del ciclo autónomo de BT.

Reproduce la lógica de entrada/salida de autonomo.py sobre velas históricas
usando únicamente señales técnicas reproducibles (LSTM + indicadores).
Los componentes de sentimiento en tiempo real (FinBERT, Reddit, Fear&Greed)
se establecen en neutro (0.0) al no estar disponibles históricamente.
"""
import time
import math
import asyncio
from datetime import datetime, timezone

import requests

from app.config import logger, _has_ml, BINANCE_KLINES
from app.bt.autonomo import (
    UMBRAL_ENTRADA, UMBRAL_SALIDA, UMBRAL_SALIDA_SIG,
)

_TP_PCT = 0.15   # take profit
_SL_PCT = 0.08   # stop loss (negativo)


# ─── Obtención de datos históricos ────────────────────────────────────────────

def _fetch_historico(symbol: str, dias: int, interval: str = "1h") -> list[dict]:
    """
    Descarga hasta `dias` días de velas OHLCV de Binance con paginación.
    Devuelve lista de dicts con open_time, open, high, low, close, volume.
    """
    ms_por_vela = {"1m": 60_000, "5m": 300_000, "15m": 900_000,
                   "1h": 3_600_000, "4h": 14_400_000}
    ms_step = ms_por_vela.get(interval, 3_600_000)
    ahora   = int(time.time() * 1000)
    inicio  = ahora - dias * 24 * 3_600_000

    candles: list[dict] = []
    cursor = inicio

    while cursor < ahora - ms_step:
        url = (f"{BINANCE_KLINES}?symbol={symbol}&interval={interval}"
               f"&limit=1000&startTime={cursor}")
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code != 200:
                break
            rows = resp.json()
            if not rows:
                break
            for row in rows:
                candles.append({
                    "open_time": int(row[0]),
                    "open":      float(row[1]),
                    "high":      float(row[2]),
                    "low":       float(row[3]),
                    "close":     float(row[4]),
                    "volume":    float(row[5]),
                })
            cursor = int(rows[-1][0]) + ms_step
        except Exception as e:
            logger.warning(f"[backtest] Error fetch {symbol}: {e}")
            break

    # Deduplicar y ordenar por tiempo
    seen: set = set()
    result: list[dict] = []
    for c in sorted(candles, key=lambda x: x["open_time"]):
        if c["open_time"] not in seen:
            seen.add(c["open_time"])
            result.append(c)
    return result


# ─── Cálculo de convicción técnica (sin sentimiento) ──────────────────────────

_REGIME_COMP = {"TRENDING": 0.4, "RANGING": 0.0, "VOLATILE": -0.4, "TRANSITION": -0.2}


def _conviction_tecnica(closes: list[float], volumes: list[float]) -> tuple[int, str]:
    """
    Calcula conviction 0-100 y señal 'BUY'/'SELL'/'HOLD' usando solo
    indicadores técnicos + LSTM (sin FinBERT, Reddit ni Fear&Greed).
    """
    if not _has_ml or len(closes) < 20:
        return 50, "HOLD"

    try:
        import numpy as np
        import pandas as pd
        import app.modelos as modelos

        df = pd.DataFrame({"Close": closes, "Volume": volumes})

        # ── Indicadores ───────────────────────────────────────────────────────
        from app.indicadores import IndicadoresTecnicos
        df["RSI"]         = IndicadoresTecnicos.rsi(df)
        df["MACD"], msig  = IndicadoresTecnicos.macd(df)
        bb_up, bb_lo      = IndicadoresTecnicos.bollinger(df)
        df["StochRSI"]    = IndicadoresTecnicos.stoch_rsi(df)
        ema9  = df["Close"].ewm(span=9,  adjust=False).mean()
        ema21 = df["Close"].ewm(span=21, adjust=False).mean()
        df["EMA_cross"]   = ((ema9 - ema21) / (ema21 + 1e-9) * 100).clip(-10, 10)
        sma20 = df["Close"].rolling(20).mean()
        std20 = df["Close"].rolling(20).std()
        bb_rng = (std20 * 4).replace(0, 1e-9)
        df["BB_pos"]      = ((df["Close"] - (sma20 - 2 * std20)) / bb_rng * 2 - 1).clip(-2, 2)
        sign_s = df["Close"].diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
        obv_raw = (df["Volume"] * sign_s).cumsum()
        obv_mx  = obv_raw.abs().rolling(50, min_periods=1).max().replace(0, 1)
        df["OBV_norm"]    = (obv_raw / obv_mx).clip(-1, 1)
        df["Momentum"]    = df["Close"].pct_change(10).fillna(0).clip(-0.2, 0.2)
        df.bfill(inplace=True)
        df.fillna(0, inplace=True)

        rsi_val   = float(df["RSI"].iloc[-1])
        macd_hist = float((df["MACD"] - msig).iloc[-1])
        stoch_v   = float(df["StochRSI"].iloc[-1])
        obv_delta = float(df["OBV_norm"].iloc[-1])
        ema_v     = float(df["EMA_cross"].iloc[-1])

        # Régimen simple via ADX proxy (pendiente EMA)
        ema21_slope = float(ema21.pct_change(5).iloc[-1])
        if abs(ema21_slope) > 0.005:
            regime = "TRENDING"
        elif rsi_val > 60 or rsi_val < 40:
            regime = "VOLATILE"
        else:
            regime = "RANGING"

        # ── LSTM ──────────────────────────────────────────────────────────────
        lstm_active = False
        tech_score  = 0.0
        if modelos.lstm_model and modelos.scaler and len(closes) >= 60:
            feats = ["Close", "Volume", "RSI", "MACD", "StochRSI",
                     "EMA_cross", "BB_pos", "OBV_norm", "Momentum"]
            expected = (modelos.lstm_model.input_shape[-1]
                        if hasattr(modelos.lstm_model, "input_shape") else len(feats))
            if expected == len(feats):
                mat    = df[feats].values[-60:]
                scaled = modelos.scaler.transform(mat)
                pred   = modelos.lstm_model.predict(np.array([scaled]), verbose=0)
                dummy  = np.zeros((1, len(feats)))
                dummy[0, 0] = pred[0][0]
                p_val  = float(modelos.scaler.inverse_transform(dummy)[0][0])
                price  = closes[-1]
                lstm_score = float(((p_val - price) / price) * 100)
                # Mezcla LSTM + señal técnica según régimen
                tech_signal = (
                    (0.25 if rsi_val < 50 else -0.25) +
                    (0.18 if macd_hist > 0 else -0.18) +
                    (0.15 if ema_v > 0 else -0.15)
                )
                w_lstm_mix = {"TRENDING": 0.55, "RANGING": 0.25,
                              "VOLATILE": 0.20, "TRANSITION": 0.40}.get(regime, 0.40)
                tech_score  = lstm_score * w_lstm_mix + tech_signal * (1 - w_lstm_mix)
                lstm_active = True

        # ── Componentes de convicción (solo técnicos) ─────────────────────────
        lstm_comp   = max(-1.0, min(1.0, tech_score / 5.0)) if lstm_active else 0.0
        rsi_comp    = max(-1.0, min(1.0, (50.0 - rsi_val) / 20.0))
        macd_comp   = max(-1.0, min(1.0, macd_hist * 20.0))
        regime_comp = _REGIME_COMP.get(regime, 0.0)
        obv_comp    = max(-1.0, min(1.0, obv_delta * 5.0))
        stoch_comp  = max(-1.0, min(1.0, (0.5 - stoch_v) * 2.0))
        ema_comp    = max(-1.0, min(1.0, ema_v / 5.0))

        w_lstm   = 0.35 if lstm_active else 0.0
        w_rsi    = 0.20
        w_macd   = 0.18
        w_regime = 0.13
        w_obv    = 0.07
        w_stoch  = 0.04
        w_ema    = 0.03
        w_total  = w_lstm + w_rsi + w_macd + w_regime + w_obv + w_stoch + w_ema or 0.01

        raw = (
            lstm_comp   * w_lstm   +
            rsi_comp    * w_rsi    +
            macd_comp   * w_macd   +
            regime_comp * w_regime +
            obv_comp    * w_obv    +
            stoch_comp  * w_stoch  +
            ema_comp    * w_ema
        ) / w_total

        conviction = max(0, min(100, int(round((raw + 1.0) * 50))))

        # Penalizar si régimen desfavorable
        if regime in ("RANGING", "VOLATILE") and conviction > 49:
            conviction = min(conviction, 49)

        if conviction >= 55:
            signal = "BUY"
        elif conviction <= 45:
            signal = "SELL"
        else:
            signal = "HOLD"

        return conviction, signal

    except Exception as e:
        logger.debug(f"[backtest] Error conviction_tecnica: {e}")
        return 50, "HOLD"


# ─── Motor principal de backtesting ───────────────────────────────────────────

def _sharpe(returns: list[float]) -> float:
    if len(returns) < 2:
        return 0.0
    import statistics
    mu  = statistics.mean(returns)
    std = statistics.stdev(returns) or 1e-9
    return round(mu / std * math.sqrt(365 * 24), 3)


def _max_drawdown(equity: list[float]) -> float:
    if len(equity) < 2:
        return 0.0
    peak = equity[0]
    mdd  = 0.0
    for v in equity:
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0
        if dd > mdd:
            mdd = dd
    return round(mdd * 100, 2)


def _ts_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


async def backtest_autonomo(
    symbol: str,
    dias: int = 90,
    balance_inicial: float = 1000.0,
) -> dict:
    """
    Simula el ciclo autónomo sobre datos históricos de `dias` días.
    Retorna métricas, curva de equity y lista de trades ejecutados.
    """
    candles = await asyncio.to_thread(_fetch_historico, symbol, dias)

    if len(candles) < 80:
        return {"error": f"Datos insuficientes para {symbol}: {len(candles)} velas"}

    balance   = balance_inicial
    posicion  = None          # dict con precio_entrada, cantidad, ts_entrada, conviction
    trades:   list[dict] = []
    equity:   list[dict] = []
    retornos: list[float] = []
    prev_eq   = balance_inicial

    # Ventana mínima de 60 velas para LSTM
    for i in range(60, len(candles)):
        candle        = candles[i]
        precio        = candle["close"]
        ts            = candle["open_time"]

        closes  = [c["close"]  for c in candles[i - 60:i + 1]]
        volumes = [c["volume"] for c in candles[i - 60:i + 1]]

        conviction, signal = _conviction_tecnica(closes, volumes)

        # ── Lógica de entrada ─────────────────────────────────────────────────
        if posicion is None and signal == "BUY" and conviction >= UMBRAL_ENTRADA:
            cantidad  = (balance * 0.95) / precio
            posicion  = {
                "precio_entrada":   precio,
                "cantidad":         cantidad,
                "ts_entrada":       ts,
                "conviction_entrada": conviction,
            }
            balance  -= cantidad * precio

        # ── Lógica de salida ──────────────────────────────────────────────────
        elif posicion is not None:
            pe      = posicion["precio_entrada"]
            cant    = posicion["cantidad"]
            pnl_pct = (precio - pe) / pe

            razon = None
            if pnl_pct >= _TP_PCT:
                razon = "TP"
            elif pnl_pct <= -_SL_PCT:
                razon = "SL"
            elif conviction < UMBRAL_SALIDA:
                razon = "conviction_baja"
            elif signal == "SELL" and conviction >= UMBRAL_SALIDA_SIG:
                razon = "señal_girada"

            if razon:
                balance += cant * precio
                trades.append({
                    "symbol":             symbol,
                    "ts_entrada":         _ts_iso(posicion["ts_entrada"]),
                    "ts_salida":          _ts_iso(ts),
                    "precio_entrada":     round(pe, 4),
                    "precio_salida":      round(precio, 4),
                    "pnl_pct":            round(pnl_pct * 100, 2),
                    "pnl_usd":            round((precio - pe) * cant, 4),
                    "razon":              razon,
                    "conviction_entrada": posicion["conviction_entrada"],
                    "duracion_h":         round((ts - posicion["ts_entrada"]) / 3_600_000, 1),
                })
                posicion = None

        # ── Curva de equity ───────────────────────────────────────────────────
        val_pos = (posicion["cantidad"] * precio) if posicion else 0.0
        eq_val  = balance + val_pos
        equity.append({"ts": _ts_iso(ts), "valor": round(eq_val, 4)})

        ret_h = (eq_val - prev_eq) / prev_eq if prev_eq > 0 else 0.0
        retornos.append(ret_h)
        prev_eq = eq_val

    # Cerrar posición abierta al precio final
    if posicion:
        precio_fin = candles[-1]["close"]
        balance += posicion["cantidad"] * precio_fin
        pnl_pct = (precio_fin - posicion["precio_entrada"]) / posicion["precio_entrada"]
        trades.append({
            "symbol":             symbol,
            "ts_entrada":         _ts_iso(posicion["ts_entrada"]),
            "ts_salida":          _ts_iso(candles[-1]["open_time"]),
            "precio_entrada":     round(posicion["precio_entrada"], 4),
            "precio_salida":      round(precio_fin, 4),
            "pnl_pct":            round(pnl_pct * 100, 2),
            "pnl_usd":            round((precio_fin - posicion["precio_entrada"]) * posicion["cantidad"], 4),
            "razon":              "fin_backtest",
            "conviction_entrada": posicion["conviction_entrada"],
            "duracion_h":         round((candles[-1]["open_time"] - posicion["ts_entrada"]) / 3_600_000, 1),
        })

    valor_final = equity[-1]["valor"] if equity else balance_inicial
    precio_ini  = candles[60]["close"]
    precio_fin2 = candles[-1]["close"]
    bh_return   = (precio_fin2 - precio_ini) / precio_ini * 100

    wins = [t for t in trades if t["pnl_pct"] > 0]

    # Normalizar equity curve para el frontend (máx 200 puntos)
    step = max(1, len(equity) // 200)
    equity_reducida = equity[::step]

    return {
        "symbol":            symbol,
        "dias":              dias,
        "balance_inicial":   balance_inicial,
        "balance_final":     round(valor_final, 2),
        "retorno_pct":       round((valor_final - balance_inicial) / balance_inicial * 100, 2),
        "bh_retorno_pct":    round(bh_return, 2),
        "num_trades":        len(trades),
        "win_rate_pct":      round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "sharpe":            _sharpe(retornos),
        "max_drawdown_pct":  _max_drawdown([e["valor"] for e in equity]),
        "avg_duracion_h":    round(sum(t["duracion_h"] for t in trades) / len(trades), 1) if trades else 0.0,
        "candles_analizadas": len(candles) - 60,
        "nota":              "Sentimiento (FinBERT/Reddit/Fear&Greed) fijado en neutro — solo señales técnicas + LSTM.",
        "trades":            trades,
        "equity_curve":      equity_reducida,
    }
