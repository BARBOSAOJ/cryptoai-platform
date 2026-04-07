import os
import logging
import asyncio

os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('ai-engine')

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import List, Optional, Dict
import uvicorn
import requests
import redis
import json
import time

try:
    import tensorflow as tf
    import joblib
    import numpy as np
    import pandas as pd
    _has_ml = True
except ImportError:
    _has_ml = False
    logger.warning("TensorFlow/numpy/pandas no disponibles — LSTM desactivado")

try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    _has_nlp = True
except ImportError:
    _has_nlp = False
    logger.warning("Transformers/torch no disponibles — FinBERT desactivado")

app = FastAPI(title="Crypto AI Engine", version="3.0.0")

_allowed_origins = os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ─── Configuración ────────────────────────────────────────────────────────────

CRYPTO_PANIC_KEY  = os.getenv('CRYPTOPANIC_KEY', '')
CACHE_DURATION    = 300
NEWS_CACHE: dict  = {}
NEWS_CACHE_MAX    = 100
BINANCE_KLINES    = "https://api.binance.com/api/v3/klines"
WARM_SYMBOLS      = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "PEPEUSDT", "SHIBUSDT", "TRUMPUSDT"]

# ─── Redis ────────────────────────────────────────────────────────────────────

redis_client = None
try:
    redis_client = redis.Redis(
        host=os.getenv('REDIS_HOST', 'localhost'),
        port=int(os.getenv('REDIS_PORT', 6379)),
        db=0, decode_responses=True,
        socket_connect_timeout=2, socket_timeout=2
    )
    redis_client.ping()
    logger.info("Redis conectado correctamente")
except Exception as e:
    logger.warning(f"Redis no disponible: {e}")
    redis_client = None

AI_CACHE_TTL = 30

# ─── Modelos ──────────────────────────────────────────────────────────────────

tokenizer = sentiment_model = None
if _has_nlp:
    try:
        tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        sentiment_model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        logger.info("FinBERT cargado")
    except Exception as e:
        logger.warning(f"FinBERT no disponible: {e}")

lstm_model = scaler = None
if _has_ml:
    try:
        lstm_model = tf.keras.models.load_model('models/crypto_lstm_model_v2.h5')
        scaler = joblib.load('models/scaler_v2.gz')
        logger.info("LSTM cargado")
    except Exception as e:
        logger.warning(f"LSTM no disponible: {e}")


# ─── Esquemas ─────────────────────────────────────────────────────────────────

class MarketRequest(BaseModel):
    symbol: str
    price: float
    history: List[float]
    volumes: Optional[List[float]] = None

    @field_validator('symbol')
    @classmethod
    def symbol_ok(cls, v): return v.strip().upper() or (_ for _ in ()).throw(ValueError('Símbolo vacío'))

    @field_validator('price')
    @classmethod
    def price_positive(cls, v):
        if v <= 0: raise ValueError('Precio debe ser > 0')
        return v

class BatchRequest(BaseModel):
    symbols: List[str]
    prices: Dict[str, float]
    histories: Optional[Dict[str, List[float]]] = None
    volumes: Optional[Dict[str, List[float]]] = None


# ─── Multi-timeframe ──────────────────────────────────────────────────────────

TIMEFRAMES         = ["1m", "15m", "1h", "4h"]
TIMEFRAME_WEIGHTS  = {"1m": 0.15, "15m": 0.25, "1h": 0.35, "4h": 0.25}
MTF_CACHE_TTL      = 60   # segundos en Redis para datos MTF

# ─── Indicadores técnicos ─────────────────────────────────────────────────────

def calculate_rsi(data, window=14):
    if not _has_ml: return data['Close'] * 0
    delta = data['Close'].diff()
    gain = delta.where(delta > 0, 0).rolling(window=window).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))

def calculate_macd(data, short=12, long=26, signal=9):
    if not _has_ml: return data['Close'] * 0, data['Close'] * 0
    s_ema = data['Close'].ewm(span=short, adjust=False).mean()
    l_ema = data['Close'].ewm(span=long,  adjust=False).mean()
    macd  = s_ema - l_ema
    sig   = macd.ewm(span=signal, adjust=False).mean()
    return macd, sig

def calculate_bollinger(data, window=20, num_std=2):
    if not _has_ml: return data['Close'] * 0, data['Close'] * 0
    sma = data['Close'].rolling(window).mean()
    std = data['Close'].rolling(window).std()
    return sma + num_std * std, sma - num_std * std

def calculate_ema_cross(data, fast=9, slow=21):
    if not _has_ml: return 0.0
    ema_f = data['Close'].ewm(span=fast, adjust=False).mean()
    ema_s = data['Close'].ewm(span=slow, adjust=False).mean()
    return float(ema_f.iloc[-1] - ema_s.iloc[-1])

def bollinger_position(price, upper, lower):
    """Retorna: -1 bajo banda inferior, +1 sobre banda superior, 0 dentro"""
    try:
        u, l = float(upper.iloc[-1]), float(lower.iloc[-1])
        if price > u:  return 1.0
        if price < l:  return -1.0
        mid = (u + l) / 2
        return (price - mid) / (u - mid + 1e-9)
    except Exception:
        return 0.0

def volume_spike(volumes, window=20):
    if not _has_ml or len(volumes) < window + 1: return False
    try:
        arr = np.array(volumes)
        avg = arr[-window-1:-1].mean()
        return bool(arr[-1] > avg * 2.0)
    except Exception:
        return False


# ─── Análisis por timeframe individual ────────────────────────────────────────

def analyze_timeframe_signal(prices: list, volumes: list = None) -> dict:
    """Calcula señal técnica (RSI, MACD, EMA, BB) para un timeframe dado."""
    if not _has_ml or len(prices) < 20:
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}
    try:
        if not volumes or len(volumes) != len(prices):
            volumes = [1000.0] * len(prices)
        df = pd.DataFrame({'Close': prices, 'Volume': volumes})
        df['RSI']  = calculate_rsi(df)
        df['MACD'], macd_sig = calculate_macd(df)
        bb_upper, bb_lower   = calculate_bollinger(df)
        df.bfill(inplace=True); df.fillna(0, inplace=True)

        rsi_val   = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
        macd_hist = float((df['MACD'] - macd_sig).iloc[-1])
        ema_cross = calculate_ema_cross(df)
        bb_pos    = bollinger_position(prices[-1], bb_upper, bb_lower)

        signal = 0.0
        if rsi_val < 30:   signal += 0.30
        elif rsi_val > 70: signal -= 0.30
        if macd_hist > 0:  signal += 0.20
        elif macd_hist < 0: signal -= 0.20
        if ema_cross > 0:  signal += 0.20
        elif ema_cross < 0: signal -= 0.20
        if bb_pos < -0.5:  signal += 0.15
        elif bb_pos > 0.5: signal -= 0.15

        trend = "BULLISH" if signal > 0.08 else "BEARISH" if signal < -0.08 else "NEUTRAL"
        return {"signal": round(signal, 3), "rsi": round(rsi_val, 1), "trend": trend,
                "macd_hist": round(macd_hist, 6), "ema_cross": round(ema_cross, 4)}
    except Exception as e:
        logger.debug(f"Error analizando timeframe: {e}")
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}


def multi_timeframe_confluence(symbol: str) -> dict:
    """
    Descarga klines de 4 timeframes y calcula confluencia de señales.
    Devuelve señal ponderada y nivel de acuerdo entre timeframes (0-1).
    """
    cache_key = f"mtf:{symbol}"
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception: pass

    tf_results: dict = {}
    weighted_signal  = 0.0
    total_weight     = 0.0
    bullish_count    = 0
    bearish_count    = 0

    for tf in TIMEFRAMES:
        limit = 100 if tf in ("1m", "15m") else 60
        data  = fetch_binance_klines(symbol, limit=limit, interval=tf)
        if len(data["prices"]) < 20:
            continue
        result = analyze_timeframe_signal(data["prices"], data["volumes"])
        tf_results[tf] = result
        w = TIMEFRAME_WEIGHTS.get(tf, 0.25)
        weighted_signal += result["signal"] * w
        total_weight    += w
        if result["trend"] == "BULLISH":  bullish_count += 1
        elif result["trend"] == "BEARISH": bearish_count += 1

    if total_weight > 0:
        weighted_signal /= total_weight

    n          = len(tf_results)
    agreement  = max(bullish_count, bearish_count)
    confluence = round(agreement / n, 2) if n > 0 else 0.0
    dominant   = ("BULLISH" if bullish_count > bearish_count
                  else "BEARISH" if bearish_count > bullish_count else "NEUTRAL")

    mtf = {
        "signal":      round(weighted_signal, 3),
        "confluence":  confluence,
        "timeframes":  tf_results,
        "agreement":   agreement,
        "total":       n,
        "dominant":    dominant,
    }
    if redis_client:
        try: redis_client.setex(cache_key, MTF_CACHE_TTL, json.dumps(mtf))
        except Exception: pass
    return mtf


# ─── Historial de Binance (para pre-warm y endpoint /history) ─────────────────

def fetch_binance_klines(symbol: str, limit: int = 100, interval: str = "1m") -> dict:
    try:
        url = f"{BINANCE_KLINES}?symbol={symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=8)
        if resp.status_code != 200:
            return {"prices": [], "volumes": []}
        prices, volumes = [], []
        for row in resp.json():
            try:
                prices.append(float(row[4]))   # close
                volumes.append(float(row[5]))  # volume
            except Exception:
                pass
        return {"prices": prices, "volumes": volumes}
    except Exception as e:
        logger.debug(f"Error obteniendo klines de {symbol}: {e}")
        return {"prices": [], "volumes": []}


# ─── Noticias y sentimiento ───────────────────────────────────────────────────

def _evict_news_cache():
    if len(NEWS_CACHE) <= NEWS_CACHE_MAX: return
    now = time.time()
    expired = [k for k, v in NEWS_CACHE.items() if now - v["time"] > CACHE_DURATION]
    for k in expired: del NEWS_CACHE[k]
    if len(NEWS_CACHE) > NEWS_CACHE_MAX:
        oldest = sorted(NEWS_CACHE.items(), key=lambda x: x[1]["time"])
        for k, _ in oldest[:len(NEWS_CACHE) - NEWS_CACHE_MAX]: del NEWS_CACHE[k]

def get_fallback_news(symbol):
    coin = symbol.replace("USDT", "")
    return [
        (f"Market monitoring active for {coin}.", "system"),
        (f"Volume analysis showing steady activity for {coin}.", "system"),
        (f"Waiting for new social sentiment signals.", "system")
    ]

def fetch_real_news(symbol):
    coin = symbol.replace("USDT", "")
    now  = time.time()
    cached = NEWS_CACHE.get(coin)
    if cached and now - cached["time"] < CACHE_DURATION:
        return cached["data"]
    try:
        url = f"https://cryptopanic.com/api/v1/posts/?auth_token={CRYPTO_PANIC_KEY}&currencies={coin}&kind=news"
        resp = requests.get(url, timeout=5)
        headlines = []
        if resp.status_code == 200:
            for post in resp.json().get('results', [])[:3]:
                t = post.get('title', '')
                if len(t) > 5: headlines.append((t, post.get('domain', 'news')))
        if not headlines:
            g_url = f"https://cryptopanic.com/api/v1/posts/?auth_token={CRYPTO_PANIC_KEY}&kind=news"
            gr = requests.get(g_url, timeout=5)
            if gr.status_code == 200:
                for post in gr.json().get('results', [])[:3]:
                    t = post.get('title', '')
                    if len(t) > 5: headlines.append((t, post.get('domain', 'global_news')))
        final = headlines or get_fallback_news(symbol)
    except Exception as e:
        logger.debug(f"Error noticias {coin}: {e}")
        final = get_fallback_news(symbol)
    _evict_news_cache()
    NEWS_CACHE[coin] = {"data": final, "time": now}
    return final

def analyze_headlines(raw_news):
    if not raw_news or not sentiment_model: return [], 0.0
    try:
        titles = [item[0] for item in raw_news]
        inputs = tokenizer(titles, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = sentiment_model(**inputs)
        scores = torch.nn.functional.softmax(outputs.logits, dim=-1).numpy()
        results, total = [], 0.0
        for i, (title, source) in enumerate(raw_news):
            val = float(scores[i, 0] - scores[i, 1])
            label = "BULLISH" if val > 0.1 else "BEARISH" if val < -0.1 else "NEUTRAL"
            results.append({"title": title, "source": source, "impact": round(val, 2), "label": label})
            total += val
        return results, total / len(results)
    except Exception as e:
        logger.warning(f"Error sentimiento: {e}")
        return [], 0.0


# ─── Análisis principal ───────────────────────────────────────────────────────

async def perform_analysis(symbol: str, price: float, history: list, volumes: list = None):
    price_bucket = int(price / max(price * 0.001, 1))
    cache_key = f"ai:{symbol}:{price_bucket}"

    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached: return json.loads(cached)
        except Exception: pass

    news_data = fetch_real_news(symbol)
    news_details, avg_sentiment = analyze_headlines(news_data)

    tech_score     = 0.0
    lstm_active    = False
    indicators     = {}
    predicted_next = 0.0

    if _has_ml and len(history) >= 20:
        try:
            if not volumes or len(volumes) != len(history):
                volumes = [1000.0] * len(history)

            df = pd.DataFrame({'Close': history, 'Volume': volumes})
            df['RSI']  = calculate_rsi(df)
            df['MACD'], macd_sig = calculate_macd(df)
            bb_upper, bb_lower  = calculate_bollinger(df)
            df.bfill(inplace=True)
            df.fillna(0, inplace=True)

            rsi_val   = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
            macd_hist = float((df['MACD'] - macd_sig).iloc[-1])
            ema_cross = calculate_ema_cross(df)
            bb_pos    = bollinger_position(price, bb_upper, bb_lower)
            vol_spike = volume_spike(volumes)

            indicators = {
                "rsi": round(rsi_val, 1),
                "macd_histogram": round(macd_hist, 4),
                "ema_cross": round(ema_cross, 2),
                "bb_position": round(bb_pos, 2),
                "volume_spike": vol_spike
            }

            tech_signal = 0.0
            if rsi_val < 30:   tech_signal += 0.30
            elif rsi_val > 70: tech_signal -= 0.30
            if macd_hist > 0:  tech_signal += 0.20
            elif macd_hist < 0: tech_signal -= 0.20
            if ema_cross > 0:  tech_signal += 0.20
            elif ema_cross < 0: tech_signal -= 0.20
            if bb_pos < -0.5:  tech_signal += 0.15
            elif bb_pos > 0.5: tech_signal -= 0.15
            if vol_spike:      tech_signal *= 1.3

            if lstm_model and scaler and len(history) >= 60:
                data_matrix = df[['Close', 'Volume', 'RSI', 'MACD']].values[-60:]
                scaled_data = scaler.transform(data_matrix)
                pred = lstm_model.predict(np.array([scaled_data]), verbose=0)
                dummy = np.zeros((1, 4))
                dummy[0, 0] = pred[0][0]
                p_val = float(scaler.inverse_transform(dummy)[0][0])
                predicted_next = round(p_val, 2)
                lstm_score = float(((p_val - price) / price) * 100)
                tech_score = lstm_score * 0.4 + tech_signal * 0.6
                lstm_active = True
            else:
                tech_score = tech_signal

        except Exception as e:
            logger.debug(f"Error análisis técnico {symbol}: {e}")

    # ── Multi-timeframe confluence ─────────────────────────────────────────────
    mtf = {}
    mtf_boost = 0.0
    try:
        mtf = multi_timeframe_confluence(symbol)
        # Blendear señal MTF (ponderada por timeframes mayores) con tech_score
        if mtf.get("total", 0) >= 2:
            tech_score = tech_score * 0.55 + mtf["signal"] * 0.45
        # Boost de confianza según confluencia:
        # 4/4 acuerdan → +18 pts | 3/4 → +12 pts | 2/4 → +5 pts
        agreement = mtf.get("agreement", 0)
        total_tf  = mtf.get("total", 0)
        if total_tf > 0:
            ratio = agreement / total_tf
            if ratio >= 1.0:   mtf_boost = 18
            elif ratio >= 0.75: mtf_boost = 12
            elif ratio >= 0.5:  mtf_boost = 5
    except Exception as e:
        logger.debug(f"Error MTF {symbol}: {e}")

    # ── Ponderación final ──────────────────────────────────────────────────────
    if lstm_active:
        combined = tech_score * 0.6 + avg_sentiment * 0.4
    elif indicators:
        combined = tech_score * 0.5 + avg_sentiment * 0.5
    else:
        combined = avg_sentiment

    signal = "MANTENER ⚖️"
    if combined > 0.10:   signal = "COMPRAR 🚀"
    elif combined < -0.10: signal = "VENDER 📉"

    # Confianza base + boost MTF (techo 96 para no parecer 100% automático)
    base_max = 85 if lstm_active else 74 if indicators else 62
    conf = int(min(base_max + mtf_boost, 96))
    conf = max(conf, int(min(base_max, max(45, abs(combined) * 45 + 50))))
    # Asegurar que el boost MTF se aplica por encima del base
    conf = min(int(max(conf, abs(combined) * 45 + 50) + mtf_boost), 96)

    result = {
        "symbol":         symbol,
        "signal":         signal,
        "confidence":     f"{conf}%",
        "tech_impact":    round(tech_score, 2),
        "news_impact":    round(avg_sentiment, 2),
        "news_details":   news_details,
        "lstm_active":    lstm_active,
        "predicted_next": predicted_next,
        "indicators":     indicators,
        "multi_timeframe": mtf,
    }

    if redis_client:
        try: redis_client.setex(cache_key, AI_CACHE_TTL, json.dumps(result))
        except Exception: pass

    return result


# ─── Pre-warm al arrancar ─────────────────────────────────────────────────────

async def _pre_warm_cache(symbols: list):
    logger.info(f"Pre-calentando caché para {symbols}...")
    for symbol in symbols:
        try:
            data = fetch_binance_klines(symbol, limit=100)
            if len(data["prices"]) >= 5:
                tick = data["prices"][-1]
                await perform_analysis(symbol, tick, data["prices"], data["volumes"])
                logger.info(f"Pre-warm OK: {symbol}")
            await asyncio.sleep(0.3)  # respetar rate limit Binance
        except Exception as e:
            logger.debug(f"Pre-warm fallido para {symbol}: {e}")

@app.on_event("startup")
async def startup_pre_warm():
    asyncio.create_task(_pre_warm_cache(WARM_SYMBOLS))


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(request: MarketRequest):
    return await perform_analysis(
        request.symbol, request.price, request.history, request.volumes
    )

@app.post("/analyze-batch")
async def analyze_batch(request: BatchRequest):
    """Analiza múltiples símbolos en una sola llamada."""
    results = {}
    for symbol in request.symbols:
        symbol = symbol.strip().upper()
        price   = request.prices.get(symbol, 1.0)
        history = (request.histories or {}).get(symbol, [])
        volumes = (request.volumes  or {}).get(symbol, [])
        if price <= 0: continue
        try:
            results[symbol] = await perform_analysis(symbol, price, history, volumes)
        except Exception as e:
            logger.warning(f"Error en batch para {symbol}: {e}")
    return results

@app.get("/history/{symbol}")
async def get_history(symbol: str, limit: int = 100, interval: str = "1m"):
    """Obtiene historial de velas de Binance directamente."""
    symbol = symbol.upper().strip()
    limit  = max(10, min(limit, 500))
    data   = fetch_binance_klines(symbol, limit=limit, interval=interval)
    if not data["prices"]:
        raise HTTPException(status_code=404, detail=f"Sin datos para {symbol}")
    return {"symbol": symbol, **data}

@app.get("/candles/{symbol}")
async def get_candles(symbol: str, interval: str = "1m", limit: int = 200):
    """Devuelve velas OHLCV completas para cualquier intervalo (para el gráfico)."""
    symbol = symbol.upper().strip()
    limit  = max(10, min(limit, 500))
    try:
        url  = f"{BINANCE_KLINES}?symbol={symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=8)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail=f"Sin datos para {symbol}")
        candles = []
        for row in resp.json():
            candles.append({
                "time":   int(row[0]) // 1000,
                "open":   float(row[1]),
                "high":   float(row[2]),
                "low":    float(row[3]),
                "close":  float(row[4]),
                "volume": float(row[5]),
            })
        return candles
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/news")
async def get_news(symbols: str = "BTC,ETH,SOL,DOGE,PEPE", limit: int = 20):
    """Feed de noticias multi-símbolo con análisis de sentimiento."""
    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    all_news = []
    seen_titles = set()

    for coin in symbol_list[:8]:  # máximo 8 para respetar rate limits
        symbol = coin + "USDT" if not coin.endswith("USDT") else coin
        try:
            news_data = fetch_real_news(symbol)
            details, _ = analyze_headlines(news_data)
            for item in details:
                if item["title"] not in seen_titles:
                    seen_titles.add(item["title"])
                    item["symbol"] = coin
                    all_news.append(item)
        except Exception: pass

    all_news.sort(key=lambda x: abs(x.get("impact", 0)), reverse=True)
    return all_news[:limit]

@app.get("/trending-radar")
async def get_trending_radar():
    memes = ["PEPEUSDT", "DOGEUSDT", "SHIBUSDT", "WIFUSDT", "BONKUSDT", "TRUMPUSDT"]
    results = []
    for m in memes:
        try:
            # Intentar usar historial real si está en caché
            cached_key = f"ai:{m}:"
            news_data = fetch_real_news(m)
            news_details, avg_sentiment = analyze_headlines(news_data)
            sentiment_label = "BULLISH" if avg_sentiment > 0.05 else "BEARISH" if avg_sentiment < -0.05 else "NEUTRAL"
            conf = int(min(75, max(40, abs(avg_sentiment) * 50 + 45)))
            results.append({
                "symbol":      m,
                "signal":      "COMPRAR 🚀" if avg_sentiment > 0.1 else "VENDER 📉" if avg_sentiment < -0.1 else "MANTENER ⚖️",
                "sentiment":   sentiment_label,
                "confidence":  conf,
                "tech_impact": 0.0,
                "news_impact": round(avg_sentiment, 2),
                "alert":       "HIGH" if conf > 65 else "MEDIUM",
                "lstm_active": False,
                "news_details": news_details[:2]
            })
        except Exception as e:
            logger.warning(f"Error trending-radar {m}: {e}")
            results.append({"symbol": m, "signal": "MANTENER ⚖️", "sentiment": "NEUTRAL",
                            "confidence": 45, "tech_impact": 0.0, "news_impact": 0.0,
                            "alert": "MEDIUM", "lstm_active": False, "news_details": []})
    return results

@app.get("/multi-timeframe/{symbol}")
async def get_multi_timeframe(symbol: str):
    """Devuelve el análisis de confluencia multi-timeframe para un símbolo."""
    symbol = symbol.upper().strip()
    try:
        mtf = multi_timeframe_confluence(symbol)
        return mtf
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "redis":        redis_client is not None,
        "lstm":         lstm_model is not None,
        "finbert":      sentiment_model is not None,
        "news_api":     bool(CRYPTO_PANIC_KEY),
        "news_cache":   len(NEWS_CACHE),
        "models_ready": lstm_model is not None or sentiment_model is not None
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
