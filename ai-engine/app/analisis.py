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
                data_matrix = df[['Close', 'Volume', 'RSI', 'MACD']].values[-60:]
                scaled_data = modelos.scaler.transform(data_matrix)
                pred        = modelos.lstm_model.predict(np.array([scaled_data]), verbose=0)
                dummy       = np.zeros((1, 4))
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

    signal = "MANTENER ⚖️"
    if combined > 0.10:    signal = "COMPRAR 🚀"
    elif combined < -0.10: signal = "VENDER 📉"

    regimen_actual = indicators.get("regimen", "RANGING")
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

    result = {
        "symbol":          symbol,
        "signal":          signal,
        "confidence":      f"{conf}%",
        "tech_impact":     round(tech_score, 2),
        "news_impact":     round(avg_sentiment, 2),
        "news_details":    news_details,
        "lstm_active":     lstm_active,
        "predicted_next":  predicted_next,
        "indicators":      indicators,
        "multi_timeframe": mtf,
        "market_regime":   regimen_info if indicators else {"regimen": "RANGING"},
        "entry_price":     entry_price,
        "target_price":    target_price,
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


async def _precalentar_cache(symbols: list):
    logger.info(f"Pre-calentando caché para {symbols}...")
    for symbol in symbols:
        try:
            data = obtener_velas_binance(symbol, limit=100)
            if len(data["prices"]) >= 5:
                await realizar_analisis(symbol, data["prices"][-1], data["prices"], data["volumes"])
                logger.info(f"Pre-warm OK: {symbol}")
            await asyncio.sleep(0.3)
        except Exception as e:
            logger.debug(f"Pre-warm fallido para {symbol}: {e}")
