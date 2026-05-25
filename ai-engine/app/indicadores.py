"""
indicadores.py — Indicadores técnicos, obtención de velas Binance y análisis MTF.
"""
import asyncio
import json
import requests
from app.config import logger, _has_ml, BINANCE_KLINES, TIMEFRAMES, TIMEFRAME_WEIGHTS, MTF_CACHE_TTL, redis_client


class IndicadoresTecnicos:
    """Todos los cálculos de indicadores técnicos agrupados como métodos estáticos."""

    @staticmethod
    def rsi(data, window: int = 14):
        if not _has_ml: return data['Close'] * 0
        delta = data['Close'].diff()
        gain  = delta.where(delta > 0, 0).ewm(alpha=1/window, adjust=False).mean()
        loss  = (-delta.where(delta < 0, 0)).ewm(alpha=1/window, adjust=False).mean()
        return 100 - (100 / (1 + gain / (loss + 1e-9)))

    @staticmethod
    def stoch_rsi(data, rsi_window: int = 14, stoch_window: int = 14):
        if not _has_ml: return data['Close'] * 0
        rsi     = IndicadoresTecnicos.rsi(data, rsi_window)
        rsi_min = rsi.rolling(stoch_window).min()
        rsi_max = rsi.rolling(stoch_window).max()
        return (rsi - rsi_min) / (rsi_max - rsi_min + 1e-9)

    @staticmethod
    def macd(data, short: int = 12, long: int = 26, signal: int = 9):
        if not _has_ml: return data['Close'] * 0, data['Close'] * 0
        s_ema = data['Close'].ewm(span=short,  adjust=False).mean()
        l_ema = data['Close'].ewm(span=long,   adjust=False).mean()
        macd  = s_ema - l_ema
        sig   = macd.ewm(span=signal, adjust=False).mean()
        return macd, sig

    @staticmethod
    def bollinger(data, window: int = 20, num_std: float = 2):
        if not _has_ml: return data['Close'] * 0, data['Close'] * 0
        sma = data['Close'].rolling(window).mean()
        std = data['Close'].rolling(window).std()
        return sma + num_std * std, sma - num_std * std

    @staticmethod
    def ema_cross(data, fast: int = 9, slow: int = 21) -> float:
        if not _has_ml: return 0.0
        ema_f = data['Close'].ewm(span=fast, adjust=False).mean()
        ema_s = data['Close'].ewm(span=slow, adjust=False).mean()
        return float(ema_f.iloc[-1] - ema_s.iloc[-1])

    @staticmethod
    def atr(data, window: int = 14) -> float:
        if not _has_ml or 'High' not in data.columns or 'Low' not in data.columns:
            std = data['Close'].rolling(window).std()
            return float(std.iloc[-1]) if not std.empty else 0.0
        import pandas as pd
        high, low, close_prev = data['High'], data['Low'], data['Close'].shift(1)
        tr = pd.concat([
            high - low,
            (high - close_prev).abs(),
            (low  - close_prev).abs()
        ], axis=1).max(axis=1)
        return float(tr.rolling(window).mean().iloc[-1])

    @staticmethod
    def vwap(data) -> float:
        if not _has_ml or 'Volume' not in data.columns: return 0.0
        try:
            tp      = data['Close']
            cum_vol = data['Volume'].cumsum()
            cum_tp  = (tp * data['Volume']).cumsum()
            return float((cum_tp / (cum_vol + 1e-9)).iloc[-1])
        except Exception:
            return 0.0

    @staticmethod
    def obv(data) -> float:
        if not _has_ml or 'Volume' not in data.columns: return 0.0
        try:
            import numpy as np
            direction = np.sign(data['Close'].diff().fillna(0))
            obv_vals  = (direction * data['Volume']).cumsum()
            if len(obv_vals) < 5: return 0.0
            recent = float(obv_vals.iloc[-1])
            prev   = float(obv_vals.iloc[-5])
            return round((recent - prev) / (abs(prev) + 1e-9), 4)
        except Exception:
            return 0.0

    @staticmethod
    def bollinger_position(price: float, upper, lower) -> float:
        try:
            u, l = float(upper.iloc[-1]), float(lower.iloc[-1])
            if price > u:  return 1.0
            if price < l: return -1.0
            mid = (u + l) / 2
            return (price - mid) / (u - mid + 1e-9)
        except Exception:
            return 0.0

    @staticmethod
    def volume_spike(volumes: list, window: int = 20) -> bool:
        if not _has_ml or len(volumes) < window + 1: return False
        try:
            import numpy as np
            arr = np.array(volumes)
            avg = arr[-window-1:-1].mean()
            return bool(arr[-1] > avg * 2.0)
        except Exception:
            return False


# ─── Velas Binance ────────────────────────────────────────────────────────────

def obtener_velas_binance(symbol: str, limit: int = 100, interval: str = "1m") -> dict:
    try:
        url  = f"{BINANCE_KLINES}?symbol={symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=8)
        if resp.status_code != 200:
            return {"prices": [], "volumes": []}
        prices, volumes = [], []
        for row in resp.json():
            try:
                prices.append(float(row[4]))
                volumes.append(float(row[5]))
            except Exception:
                pass
        return {"prices": prices, "volumes": volumes}
    except Exception as e:
        logger.debug(f"Error obteniendo klines de {symbol}: {e}")
        return {"prices": [], "volumes": []}


# ─── Análisis por timeframe ────────────────────────────────────────────────────

def analizar_senal_timeframe(prices: list, volumes: list = None) -> dict:
    if not _has_ml or len(prices) < 20:
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}
    try:
        import pandas as pd
        if not volumes or len(volumes) != len(prices):
            volumes = [1000.0] * len(prices)
        df = pd.DataFrame({'Close': prices, 'Volume': volumes})
        df['RSI']  = IndicadoresTecnicos.rsi(df)
        df['MACD'], macd_sig = IndicadoresTecnicos.macd(df)
        bb_upper, bb_lower   = IndicadoresTecnicos.bollinger(df)
        df.bfill(inplace=True); df.fillna(0, inplace=True)

        rsi_val   = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
        macd_hist = float((df['MACD'] - macd_sig).iloc[-1])
        ema_cross = IndicadoresTecnicos.ema_cross(df)
        bb_pos    = IndicadoresTecnicos.bollinger_position(prices[-1], bb_upper, bb_lower)
        stoch_rsi = float(IndicadoresTecnicos.stoch_rsi(df).iloc[-1])
        obv_delta = IndicadoresTecnicos.obv(df)

        signal = 0.0
        if rsi_val < 30:        signal += 0.25
        elif rsi_val > 70:      signal -= 0.25
        if stoch_rsi < 0.20:    signal += 0.12
        elif stoch_rsi > 0.80:  signal -= 0.12
        if macd_hist > 0:       signal += 0.18
        elif macd_hist < 0:     signal -= 0.18
        if ema_cross > 0:       signal += 0.15
        elif ema_cross < 0:     signal -= 0.15
        if bb_pos < -0.5:       signal += 0.12
        elif bb_pos > 0.5:      signal -= 0.12
        if obv_delta > 0.05:    signal += 0.08
        elif obv_delta < -0.05: signal -= 0.08

        trend = "BULLISH" if signal > 0.08 else "BEARISH" if signal < -0.08 else "NEUTRAL"
        return {
            "signal":    round(signal, 3), "rsi": round(rsi_val, 1), "trend": trend,
            "stoch_rsi": round(stoch_rsi, 3), "macd_hist": round(macd_hist, 6),
            "ema_cross": round(ema_cross, 4), "obv_delta": round(obv_delta, 4)
        }
    except Exception as e:
        logger.debug(f"Error analizando timeframe: {e}")
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}


def confluencia_multi_timeframe(symbol: str) -> dict:
    cache_key = f"mtf:{symbol}"
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    tf_results: dict = {}
    weighted_signal  = 0.0
    total_weight     = 0.0
    bullish_count    = 0
    bearish_count    = 0

    for tf in TIMEFRAMES:
        limit = 100 if tf in ("1m", "15m") else 60
        data  = obtener_velas_binance(symbol, limit=limit, interval=tf)
        if len(data["prices"]) < 20:
            continue
        result = analizar_senal_timeframe(data["prices"], data["volumes"])
        tf_results[tf] = result
        w = TIMEFRAME_WEIGHTS.get(tf, 0.25)
        weighted_signal += result["signal"] * w
        total_weight    += w
        if result["trend"] == "BULLISH":   bullish_count += 1
        elif result["trend"] == "BEARISH": bearish_count += 1

    if total_weight > 0:
        weighted_signal /= total_weight

    n          = len(tf_results)
    agreement  = max(bullish_count, bearish_count)
    confluence = round(agreement / n, 2) if n > 0 else 0.0
    dominant   = ("BULLISH" if bullish_count > bearish_count
                  else "BEARISH" if bearish_count > bullish_count else "NEUTRAL")

    mtf = {
        "signal":     round(weighted_signal, 3),
        "confluence": confluence,
        "timeframes": tf_results,
        "agreement":  agreement,
        "total":      n,
        "dominant":   dominant,
    }
    if redis_client:
        try: redis_client.setex(cache_key, MTF_CACHE_TTL, json.dumps(mtf))
        except Exception: pass
    return mtf


async def confluencia_multi_timeframe_async(symbol: str) -> dict:
    """Versión async: las 4 llamadas Binance se lanzan en paralelo con asyncio.gather."""
    cache_key = f"mtf:{symbol}"
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    async def _fetch_tf(tf):
        limit = 100 if tf in ("1m", "15m") else 60
        return tf, await asyncio.to_thread(obtener_velas_binance, symbol, limit=limit, interval=tf)

    raw = await asyncio.gather(*[_fetch_tf(tf) for tf in TIMEFRAMES], return_exceptions=True)

    tf_results: dict = {}
    weighted_signal  = 0.0
    total_weight     = 0.0
    bullish_count    = 0
    bearish_count    = 0

    for item in raw:
        if isinstance(item, Exception):
            continue
        tf, data = item
        if len(data["prices"]) < 20:
            continue
        result = analizar_senal_timeframe(data["prices"], data["volumes"])
        tf_results[tf] = result
        w = TIMEFRAME_WEIGHTS.get(tf, 0.25)
        weighted_signal += result["signal"] * w
        total_weight    += w
        if result["trend"] == "BULLISH":   bullish_count += 1
        elif result["trend"] == "BEARISH": bearish_count += 1

    if total_weight > 0:
        weighted_signal /= total_weight

    n          = len(tf_results)
    agreement  = max(bullish_count, bearish_count)
    confluence = round(agreement / n, 2) if n > 0 else 0.0
    dominant   = ("BULLISH" if bullish_count > bearish_count
                  else "BEARISH" if bearish_count > bullish_count else "NEUTRAL")

    mtf = {
        "signal":     round(weighted_signal, 3),
        "confluence": confluence,
        "timeframes": tf_results,
        "agreement":  agreement,
        "total":      n,
        "dominant":   dominant,
    }
    if redis_client:
        try: redis_client.setex(cache_key, MTF_CACHE_TTL, json.dumps(mtf))
        except Exception: pass
    return mtf
