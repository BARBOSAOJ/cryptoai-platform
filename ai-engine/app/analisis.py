"""
analisis.py — realizar_analisis: núcleo de decisión IA + pre-warm de caché.
"""
import time
import json
import asyncio

from app.config import (logger, _has_ml, AI_CACHE_TTL,
                        redis_client, _precios_recientes, _buffer_predicciones)
from app.monitor import monitor_fallos
from app.indicadores import IndicadoresTecnicos, confluencia_multi_timeframe, obtener_velas_binance
from app.regimen import DetectorRegimen
from app.sentimiento import obtener_noticias, analizar_titulares
from app.calibracion import MotorBacktest
from app.fuentes.fear_greed import obtener_fear_greed
from app.fuentes.reddit import obtener_sentimiento_reddit


def _obtener_resumen_backtest(symbol: str) -> dict:
    """Lee el resultado del backtest desde Redis si está disponible."""
    if not redis_client:
        return None
    try:
        raw = redis_client.get(f"backtest:{symbol}")
        if not raw:
            return None
        data = json.loads(raw)
        return {
            "accuracy":        data.get("accuracy"),
            "precision":       data.get("precision"),
            "muestras":        data.get("muestras"),
            "sharpe_simulado": data.get("sharpe_simulado"),
            "timestamp":       data.get("timestamp"),
        }
    except Exception:
        return None


async def realizar_analisis(symbol: str, price: float, history: list, volumes: list = None):
    price_bucket = int(price / max(price * 0.001, 1))
    cache_key    = f"ai:{symbol}:{price_bucket}"

    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                monitor_fallos.limpiar("redis")
                return json.loads(cached)
        except Exception as e:
            monitor_fallos.registrar("redis", f"get {cache_key}: {e}")

    news_data = obtener_noticias(symbol)
    news_details, avg_sentiment = analizar_titulares(news_data)

    # Fuentes sociales (en paralelo, no bloquean si fallan)
    try:
        fear_greed_data, reddit_data = await asyncio.gather(
            asyncio.to_thread(obtener_fear_greed),
            asyncio.to_thread(obtener_sentimiento_reddit, symbol),
            return_exceptions=True,
        )
        if isinstance(fear_greed_data, Exception):
            fear_greed_data = {"valor": 50, "clasificacion": "Neutral", "normalizado": 0.0}
        if isinstance(reddit_data, Exception):
            reddit_data = {"sentimiento": 0.0, "posts_analizados": 0, "clasificacion": "sin datos", "detalle": []}
    except Exception:
        fear_greed_data = {"valor": 50, "clasificacion": "Neutral", "normalizado": 0.0}
        reddit_data     = {"sentimiento": 0.0, "posts_analizados": 0, "clasificacion": "sin datos", "detalle": []}

    tech_score     = 0.0
    lstm_active    = False
    indicators     = {}
    predicted_next = 0.0
    regimen_info   = DetectorRegimen._regimen_neutro()

    if _has_ml and len(history) >= 20:
        try:
            import pandas as pd
            import numpy as np
            import app.modelos as modelos

            if not volumes or len(volumes) != len(history):
                volumes = [1000.0] * len(history)

            df = pd.DataFrame({'Close': history, 'Volume': volumes})
            df['RSI']  = IndicadoresTecnicos.rsi(df)
            df['MACD'], macd_sig = IndicadoresTecnicos.macd(df)
            bb_upper, bb_lower  = IndicadoresTecnicos.bollinger(df)
            df['StochRSI'] = IndicadoresTecnicos.stoch_rsi(df)
            ema9_s  = df['Close'].ewm(span=9,  adjust=False).mean()
            ema21_s = df['Close'].ewm(span=21, adjust=False).mean()
            df['EMA_cross'] = ((ema9_s - ema21_s) / (ema21_s + 1e-9) * 100).clip(-10, 10)
            sma20   = df['Close'].rolling(20).mean()
            std20   = df['Close'].rolling(20).std()
            bb_rng  = (std20 * 4).replace(0, 1e-9)
            df['BB_pos'] = ((df['Close'] - (sma20 - 2 * std20)) / bb_rng * 2 - 1).clip(-2, 2)
            sign_s  = df['Close'].diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
            obv_raw = (df['Volume'] * sign_s).cumsum()
            obv_mx  = obv_raw.abs().rolling(50, min_periods=1).max().replace(0, 1)
            df['OBV_norm'] = (obv_raw / obv_mx).clip(-1, 1)
            df['Momentum'] = df['Close'].pct_change(5).clip(-0.1, 0.1)
            df.bfill(inplace=True); df.fillna(0, inplace=True)

            rsi_val    = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
            macd_hist  = float((df['MACD'] - macd_sig).iloc[-1])
            ema_cross  = IndicadoresTecnicos.ema_cross(df)
            bb_pos     = IndicadoresTecnicos.bollinger_position(price, bb_upper, bb_lower)
            vol_spike  = IndicadoresTecnicos.volume_spike(volumes)
            stoch_rsi  = float(IndicadoresTecnicos.stoch_rsi(df).iloc[-1])
            atr_val    = IndicadoresTecnicos.atr(df)
            vwap_val   = IndicadoresTecnicos.vwap(df)
            obv_delta  = IndicadoresTecnicos.obv(df)

            regimen_info = DetectorRegimen.detectar(df, atr_val)
            pesos        = regimen_info["pesos"]

            indicators = {
                "rsi":            round(rsi_val, 1),
                "stoch_rsi":      round(stoch_rsi, 3),
                "macd_histogram": round(macd_hist, 4),
                "ema_cross":      round(ema_cross, 2),
                "bb_position":    round(bb_pos, 2),
                "atr":            round(atr_val, 6),
                "vwap":           round(vwap_val, 6),
                "obv_delta":      round(obv_delta, 4),
                "volume_spike":   vol_spike,
                "regimen":        regimen_info["regimen"],
                "adx":            regimen_info["adx"],
            }

            tech_signal = 0.0
            if rsi_val < 30:        tech_signal += 0.25 * pesos["rsi"]
            elif rsi_val > 70:      tech_signal -= 0.25 * pesos["rsi"]
            if stoch_rsi < 0.20:    tech_signal += 0.15 * pesos["stoch_rsi"]
            elif stoch_rsi > 0.80:  tech_signal -= 0.15 * pesos["stoch_rsi"]
            if macd_hist > 0:       tech_signal += 0.18 * pesos["macd"]
            elif macd_hist < 0:     tech_signal -= 0.18 * pesos["macd"]
            if ema_cross > 0:       tech_signal += 0.15 * pesos["ema_cross"]
            elif ema_cross < 0:     tech_signal -= 0.15 * pesos["ema_cross"]
            if bb_pos < -0.5:       tech_signal += 0.12 * pesos["bollinger"]
            elif bb_pos > 0.5:      tech_signal -= 0.12 * pesos["bollinger"]
            if vwap_val > 0:
                vwap_diff = (price - vwap_val) / (vwap_val + 1e-9)
                if vwap_diff < -0.005:   tech_signal += 0.10 * pesos["vwap"]
                elif vwap_diff > 0.005:  tech_signal -= 0.05 * pesos["vwap"]
            if obv_delta > 0.05:    tech_signal += 0.10 * pesos["obv"]
            elif obv_delta < -0.05: tech_signal -= 0.10 * pesos["obv"]
            if vol_spike and regimen_info["regimen"] != "VOLATILE":
                tech_signal *= 1.25

            if modelos.lstm_model and modelos.scaler and len(history) >= 60:
                _features_v3 = ['Close', 'Volume', 'RSI', 'MACD', 'StochRSI', 'EMA_cross', 'BB_pos', 'OBV_norm', 'Momentum']
                # Verificar que el modelo espera el número correcto de features
                expected_n = modelos.lstm_model.input_shape[-1] if hasattr(modelos.lstm_model, 'input_shape') else len(_features_v3)
                if expected_n != len(_features_v3):
                    logger.warning(f"Modelo con {expected_n} features, se esperan {len(_features_v3)} — saltando LSTM hasta reentrenamiento")
                    modelos.lstm_model = None  # forzar uso de sólo técnicos hasta que se reentrene
                data_matrix = df[_features_v3].values[-60:]
                scaled_data = modelos.scaler.transform(data_matrix)
                pred        = modelos.lstm_model.predict(np.array([scaled_data]), verbose=0)
                dummy       = np.zeros((1, len(_features_v3)))
                dummy[0, 0] = pred[0][0]
                p_val          = float(modelos.scaler.inverse_transform(dummy)[0][0])
                predicted_next = round(p_val, 2)
                lstm_score     = float(((p_val - price) / price) * 100)
                regimen_lstm   = regimen_info["regimen"]
                if regimen_lstm == "TRENDING":
                    tech_score = lstm_score * 0.55 + tech_signal * 0.45
                elif regimen_lstm == "RANGING":
                    tech_score = lstm_score * 0.25 + tech_signal * 0.75
                elif regimen_lstm == "VOLATILE":
                    tech_score = lstm_score * 0.20 + tech_signal * 0.80
                else:
                    tech_score = lstm_score * 0.40 + tech_signal * 0.60
                lstm_active = True
            else:
                tech_score = tech_signal

        except Exception as e:
            logger.debug(f"Error análisis técnico {symbol}: {e}")
            monitor_fallos.registrar("analisis_tecnico", f"{symbol}: {e}")

    # Multi-timeframe
    mtf, mtf_boost = {}, 0.0
    try:
        mtf = confluencia_multi_timeframe(symbol)
        if mtf.get("total", 0) >= 2:
            tech_score = tech_score * 0.55 + mtf["signal"] * 0.45
        ratio = mtf.get("agreement", 0) / max(mtf.get("total", 1), 1)
        if ratio >= 1.0:    mtf_boost = 18
        elif ratio >= 0.75: mtf_boost = 12
        elif ratio >= 0.5:  mtf_boost = 5
    except Exception as e:
        logger.debug(f"Error MTF {symbol}: {e}")

    # Ponderación final
    if lstm_active:
        combined = tech_score * 0.6 + avg_sentiment * 0.4
    elif indicators:
        combined = tech_score * 0.5 + avg_sentiment * 0.5
    else:
        combined = avg_sentiment

    # ── Puerta de multi-confirmación (issue #30) ──────────────────────────────
    # Solo COMPRAR si ≥4 indicadores técnicos apuntan alcistas simultáneamente
    confirmaciones_alcistas = 0
    if indicators:
        if indicators.get("rsi", 50) < 35:             confirmaciones_alcistas += 1
        if indicators.get("stoch_rsi", 0.5) < 0.25:   confirmaciones_alcistas += 1
        if indicators.get("macd_histogram", 0) > 0:    confirmaciones_alcistas += 1
        if indicators.get("ema_cross", 0) > 0:         confirmaciones_alcistas += 1
        if indicators.get("bb_position", 0) < -0.3:    confirmaciones_alcistas += 1
        if indicators.get("obv_delta", 0) > 0.05:      confirmaciones_alcistas += 1
        if lstm_active and predicted_next > price:      confirmaciones_alcistas += 1

    confirmaciones_bajistas = 0
    if indicators:
        if indicators.get("rsi", 50) > 65:             confirmaciones_bajistas += 1
        if indicators.get("stoch_rsi", 0.5) > 0.75:   confirmaciones_bajistas += 1
        if indicators.get("macd_histogram", 0) < 0:    confirmaciones_bajistas += 1
        if indicators.get("ema_cross", 0) < 0:         confirmaciones_bajistas += 1
        if indicators.get("bb_position", 0) > 0.3:     confirmaciones_bajistas += 1
        if indicators.get("obv_delta", 0) < -0.05:     confirmaciones_bajistas += 1
        if lstm_active and predicted_next < price:      confirmaciones_bajistas += 1

    umbral_confirmaciones = 4
    señal_compra_valida = combined > 0.10 and confirmaciones_alcistas >= umbral_confirmaciones
    señal_venta_valida  = combined < -0.10 and confirmaciones_bajistas >= umbral_confirmaciones

    signal = "MANTENER ⚖️"
    if señal_compra_valida:  signal = "COMPRAR 🚀"
    elif señal_venta_valida: signal = "VENDER 📉"

    regimen_actual = indicators.get("regimen", "RANGING")

    # ── Filtro de régimen (issue #32) ─────────────────────────────────────────
    # Solo emitir COMPRAR en régimen TRENDING; en otros regímenes la señal es ruido
    if signal == "COMPRAR 🚀" and regimen_actual not in ("TRENDING",):
        signal = "MANTENER ⚖️"
    base_max = 85 if lstm_active else 74 if indicators else 62
    if regimen_actual == "TRENDING":     base_max = min(base_max + 5, 91)
    elif regimen_actual == "VOLATILE":   base_max = max(base_max - 10, 52)
    elif regimen_actual == "TRANSITION": base_max = max(base_max - 5, 57)

    conf = int(min(base_max + mtf_boost, 96))
    conf = min(int(max(conf, abs(combined) * 45 + 50) + mtf_boost), 96)
    conf = MotorBacktest.aplicar_calibracion(symbol, conf)

    oversold = (indicators.get("rsi", 50) < 35 or
                indicators.get("bb_position", 0) < -0.4 or
                indicators.get("stoch_rsi", 0.5) < 0.25)
    entry_price = price if oversold else round(min(history[-5:] if len(history) >= 5 else history), 8)

    if lstm_active and predicted_next > price:
        target_price = predicted_next
    else:
        target_price = price * (1 + abs(tech_score) * 0.02 + 0.005)
    target_price = round(max(target_price, price * 1.002), 8)
    entry_price  = round(entry_price, 8)

    # ── Score de convicción unificado 0-100 ────────────────────────────────────
    # Cada componente normalizado a -1..+1, luego mapeado a 0..100
    lstm_component       = max(-1.0, min(1.0, tech_score / 5.0)) if lstm_active else 0.0
    sentiment_component  = max(-1.0, min(1.0, avg_sentiment * 2.0))
    rsi_val_raw          = indicators.get("rsi", 50.0) if indicators else 50.0
    rsi_component        = max(-1.0, min(1.0, (50.0 - rsi_val_raw) / 20.0)) if indicators else 0.0
    macd_component       = max(-1.0, min(1.0, indicators.get("macd_histogram", 0.0) * 20.0)) if indicators else 0.0
    _regime_map          = {"TRENDING": 0.4, "RANGING": 0.0, "VOLATILE": -0.4, "TRANSITION": -0.2}
    regime_component     = _regime_map.get(regimen_actual, 0.0)
    fear_greed_component = max(-1.0, min(1.0, float(fear_greed_data.get("normalizado", 0.0))))
    reddit_component     = max(-1.0, min(1.0, float(reddit_data.get("sentimiento", 0.0)) * 2.0))

    w_lstm       = 0.30 if lstm_active else 0.0
    w_finbert    = 0.15
    w_rsi        = 0.13 if indicators else 0.0
    w_macd       = 0.12 if indicators else 0.0
    w_regime     = 0.12 if indicators else 0.0
    w_fear_greed = 0.10
    w_reddit     = 0.08 if reddit_data.get("posts_analizados", 0) > 0 else 0.0
    w_total      = w_lstm + w_finbert + w_rsi + w_macd + w_regime + w_fear_greed + w_reddit or 0.25

    raw_conv = (
        lstm_component       * w_lstm       +
        sentiment_component  * w_finbert    +
        rsi_component        * w_rsi        +
        macd_component       * w_macd       +
        regime_component     * w_regime     +
        fear_greed_component * w_fear_greed +
        reddit_component     * w_reddit
    ) / w_total
    conviction_score = max(0, min(100, int(round((raw_conv + 1.0) * 50))))
    # Penalizar convicción si el régimen no es favorable para comprar
    if regimen_actual not in ("TRENDING",) and conviction_score > 49:
        conviction_score = min(conviction_score, 49)

    import math

    def _safe(v):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return 0.0
        if isinstance(v, dict):
            return {k: _safe(val) for k, val in v.items()}
        return v

    result = {
        "symbol":           symbol,
        "signal":           signal,
        "confidence":       f"{conf}%",
        "conviction_score": conviction_score,
        "tech_impact":      _safe(round(tech_score, 2)),
        "news_impact":      _safe(round(avg_sentiment, 2)),
        "news_details":     news_details,
        "fear_greed":       fear_greed_data,
        "reddit":           reddit_data,
        "backtest":         _obtener_resumen_backtest(symbol),
        "lstm_active":      lstm_active,
        "predicted_next":   _safe(predicted_next),
        "indicators":       _safe(indicators),
        "multi_timeframe":  _safe(mtf),
        "market_regime":    _safe(regimen_info) if indicators else {"regimen": "RANGING"},
        "entry_price":      _safe(entry_price),
        "target_price":     _safe(target_price),
    }

    if redis_client:
        try: redis_client.setex(cache_key, AI_CACHE_TTL, json.dumps(result))
        except Exception: pass

    _precios_recientes[symbol] = price
    buf = _buffer_predicciones.setdefault(symbol, [])
    buf.append({"conf": conf, "signal": signal, "price": price, "ts": time.time()})
    if len(buf) > 500:
        _buffer_predicciones[symbol] = buf[-500:]

    return result


