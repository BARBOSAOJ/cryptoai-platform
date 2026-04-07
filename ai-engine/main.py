import os
import logging
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

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


# ─── Gestor de reentrenamiento LSTM ───────────────────────────────────────────

class GestorReentrenamiento:
    """
    Gestiona el ciclo de vida del modelo LSTM:
    fine-tuning periódico con datos recientes de Binance,
    guardado atómico y exposición del estado vía API.
    """

    RUTA_MODELO  = 'models/crypto_lstm_model_v2.h5'
    RUTA_SCALER  = 'models/scaler_v2.gz'
    SEQ_LEN      = 60          # ventana de entrada del LSTM
    FEATURES     = ['Close', 'Volume', 'RSI', 'MACD']
    INTERVALO_H  = 24          # horas entre reentrenamientos automáticos
    SIMBOLO_BASE = 'BTCUSDT'   # símbolo de referencia para el entrenamiento

    def __init__(self):
        self.estado: str               = 'inactivo'   # inactivo | entrenando | error
        self.ultimo_entrenamiento: Optional[str] = None
        self.metricas: dict            = {}
        self._lock                     = threading.Lock()
        self._executor                 = ThreadPoolExecutor(max_workers=1)

    # ── Construcción de arquitectura ──────────────────────────────────────────

    def _construir_arquitectura(self) -> 'tf.keras.Model':
        """Define la arquitectura LSTM v2: (SEQ_LEN, 4) → 1 precio."""
        if not _has_ml:
            raise RuntimeError("TensorFlow no disponible")
        modelo = tf.keras.Sequential([
            tf.keras.layers.LSTM(128, return_sequences=True,
                                 input_shape=(self.SEQ_LEN, len(self.FEATURES))),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.LSTM(64),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(32, activation='relu'),
            tf.keras.layers.Dense(1),
        ])
        modelo.compile(optimizer='adam', loss='mse', metrics=['mae'])
        return modelo

    # ── Preparación de datos ──────────────────────────────────────────────────

    def _preparar_datos(self, symbol: str, limit: int = 1000, interval: str = '1h'):
        """
        Descarga velas de Binance, calcula RSI y MACD,
        escala y construye secuencias (X, y) para el LSTM.
        Retorna (X, y, scaler_nuevo) o lanza excepción.
        """
        from sklearn.preprocessing import MinMaxScaler

        url  = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Binance devolvió {resp.status_code}")

        rows = resp.json()
        if len(rows) < self.SEQ_LEN + 30:
            raise RuntimeError(f"Datos insuficientes: {len(rows)} velas")

        df = pd.DataFrame(rows, columns=[
            'ts','open','high','low','close','vol',
            'close_ts','quote_vol','trades','taker_base','taker_quote','ignore'
        ])
        df['Close']  = df['close'].astype(float)
        df['Volume'] = df['vol'].astype(float)

        # Indicadores
        df['RSI']  = IndicadoresTecnicos.rsi(df)
        df['MACD'], macd_sig = IndicadoresTecnicos.macd(df)
        df.bfill(inplace=True)
        df.fillna(0, inplace=True)

        data = df[self.FEATURES].values

        scaler_nuevo = MinMaxScaler()
        data_scaled  = scaler_nuevo.fit_transform(data)

        X, y = [], []
        for i in range(self.SEQ_LEN, len(data_scaled)):
            X.append(data_scaled[i - self.SEQ_LEN:i])
            y.append(data_scaled[i, 0])   # Close normalizado

        return np.array(X), np.array(y), scaler_nuevo

    # ── Lógica de entrenamiento (ejecutada en hilo aparte) ────────────────────

    def _ejecutar_entrenamiento(self, symbol: str, epochs: int, desde_cero: bool):
        global lstm_model, scaler
        try:
            with self._lock:
                self.estado = 'entrenando'

            logger.info(f"Reentrenamiento iniciado — symbol={symbol} epochs={epochs} desde_cero={desde_cero}")
            X, y, scaler_nuevo = self._preparar_datos(symbol)

            split = int(len(X) * 0.85)
            X_train, X_val = X[:split], X[split:]
            y_train, y_val = y[:split], y[split:]

            if desde_cero or lstm_model is None:
                modelo = self._construir_arquitectura()
                logger.info("Arquitectura LSTM construida desde cero")
            else:
                modelo = lstm_model   # fine-tune sobre el modelo actual

            historia = modelo.fit(
                X_train, y_train,
                epochs=epochs,
                batch_size=32,
                validation_data=(X_val, y_val),
                verbose=0,
            )

            # Guardado atómico: primero a temporal, luego reemplazar
            ruta_tmp = self.RUTA_MODELO + '.tmp'
            modelo.save(ruta_tmp)
            os.replace(ruta_tmp, self.RUTA_MODELO)
            joblib.dump(scaler_nuevo, self.RUTA_SCALER)

            # Actualizar referencias globales
            lstm_model = modelo
            scaler     = scaler_nuevo

            metricas = {
                'loss_final':     round(float(historia.history['loss'][-1]), 6),
                'val_loss_final': round(float(historia.history['val_loss'][-1]), 6),
                'epochs':         epochs,
                'muestras':       len(X_train),
            }
            with self._lock:
                self.estado               = 'inactivo'
                self.ultimo_entrenamiento = datetime.utcnow().isoformat() + 'Z'
                self.metricas             = metricas

            logger.info(f"Reentrenamiento completado — {metricas}")

        except Exception as e:
            logger.error(f"Error en reentrenamiento: {e}")
            with self._lock:
                self.estado  = 'error'
                self.metricas = {'error': str(e)}

    # ── API pública ───────────────────────────────────────────────────────────

    def lanzar(self, symbol: str = SIMBOLO_BASE, epochs: int = 5, desde_cero: bool = False):
        """Lanza el entrenamiento en un hilo de fondo (no bloqueante)."""
        with self._lock:
            if self.estado == 'entrenando':
                return False   # ya hay uno en curso
        self._executor.submit(self._ejecutar_entrenamiento, symbol, epochs, desde_cero)
        return True

    def estado_actual(self) -> dict:
        with self._lock:
            return {
                'estado':               self.estado,
                'ultimo_entrenamiento': self.ultimo_entrenamiento,
                'metricas':             self.metricas,
                'lstm_cargado':         lstm_model is not None,
            }


gestor_reentrenamiento = GestorReentrenamiento()


async def _ciclo_reentrenamiento_automatico():
    """Lanza un reentrenamiento cada INTERVALO_H horas en segundo plano."""
    intervalo_s = GestorReentrenamiento.INTERVALO_H * 3600
    await asyncio.sleep(intervalo_s)   # primera vez: esperar un ciclo completo
    while True:
        logger.info("Reentrenamiento automático — iniciando ciclo periódico")
        gestor_reentrenamiento.lanzar()
        await asyncio.sleep(intervalo_s)


# ─── Esquemas ─────────────────────────────────────────────────────────────────

class PeticionMercado(BaseModel):
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

class PeticionLote(BaseModel):
    symbols: List[str]
    prices: Dict[str, float]
    histories: Optional[Dict[str, List[float]]] = None
    volumes: Optional[Dict[str, List[float]]] = None


# ─── Multi-timeframe ──────────────────────────────────────────────────────────

TIMEFRAMES         = ["1m", "15m", "1h", "4h"]
TIMEFRAME_WEIGHTS  = {"1m": 0.15, "15m": 0.25, "1h": 0.35, "4h": 0.25}
MTF_CACHE_TTL      = 60   # segundos en Redis para datos MTF

# ─── Indicadores técnicos ─────────────────────────────────────────────────────

class IndicadoresTecnicos:
    """Todos los cálculos de indicadores técnicos agrupados como métodos estáticos."""

    @staticmethod
    def rsi(data: 'pd.DataFrame', window: int = 14) -> 'pd.Series':
        if not _has_ml: return data['Close'] * 0
        delta = data['Close'].diff()
        gain  = delta.where(delta > 0, 0).rolling(window).mean()
        loss  = (-delta.where(delta < 0, 0)).rolling(window).mean()
        return 100 - (100 / (1 + gain / loss))

    @staticmethod
    def stoch_rsi(data: 'pd.DataFrame', rsi_window: int = 14, stoch_window: int = 14) -> 'pd.Series':
        """Stochastic RSI — más sensible que RSI clásico, ideal para crypto."""
        if not _has_ml: return data['Close'] * 0
        rsi  = IndicadoresTecnicos.rsi(data, rsi_window)
        rsi_min = rsi.rolling(stoch_window).min()
        rsi_max = rsi.rolling(stoch_window).max()
        return (rsi - rsi_min) / (rsi_max - rsi_min + 1e-9)

    @staticmethod
    def macd(data: 'pd.DataFrame', short: int = 12, long: int = 26, signal: int = 9):
        if not _has_ml: return data['Close'] * 0, data['Close'] * 0
        s_ema = data['Close'].ewm(span=short,  adjust=False).mean()
        l_ema = data['Close'].ewm(span=long,   adjust=False).mean()
        macd  = s_ema - l_ema
        sig   = macd.ewm(span=signal, adjust=False).mean()
        return macd, sig

    @staticmethod
    def bollinger(data: 'pd.DataFrame', window: int = 20, num_std: float = 2):
        if not _has_ml: return data['Close'] * 0, data['Close'] * 0
        sma = data['Close'].rolling(window).mean()
        std = data['Close'].rolling(window).std()
        return sma + num_std * std, sma - num_std * std

    @staticmethod
    def ema_cross(data: 'pd.DataFrame', fast: int = 9, slow: int = 21) -> float:
        if not _has_ml: return 0.0
        ema_f = data['Close'].ewm(span=fast, adjust=False).mean()
        ema_s = data['Close'].ewm(span=slow, adjust=False).mean()
        return float(ema_f.iloc[-1] - ema_s.iloc[-1])

    @staticmethod
    def atr(data: 'pd.DataFrame', window: int = 14) -> float:
        """Average True Range — mide volatilidad real del mercado."""
        if not _has_ml or 'High' not in data.columns or 'Low' not in data.columns:
            # Estimación con solo Close si no hay OHLC
            std = data['Close'].rolling(window).std()
            return float(std.iloc[-1]) if not std.empty else 0.0
        high, low, close_prev = data['High'], data['Low'], data['Close'].shift(1)
        tr = pd.concat([
            high - low,
            (high - close_prev).abs(),
            (low  - close_prev).abs()
        ], axis=1).max(axis=1)
        return float(tr.rolling(window).mean().iloc[-1])

    @staticmethod
    def vwap(data: 'pd.DataFrame') -> float:
        """Volume Weighted Average Price — precio de referencia institucional."""
        if not _has_ml or 'Volume' not in data.columns: return 0.0
        try:
            tp  = data['Close']  # typical price (simplificado con Close)
            cum_vol = data['Volume'].cumsum()
            cum_tp  = (tp * data['Volume']).cumsum()
            vwap_series = cum_tp / (cum_vol + 1e-9)
            return float(vwap_series.iloc[-1])
        except Exception:
            return 0.0

    @staticmethod
    def obv(data: 'pd.DataFrame') -> float:
        """On-Balance Volume — confirma tendencia con flujo de volumen."""
        if not _has_ml or 'Volume' not in data.columns: return 0.0
        try:
            direction = np.sign(data['Close'].diff().fillna(0))
            obv_vals  = (direction * data['Volume']).cumsum()
            # Normalizar: retorna el cambio relativo en las últimas 5 velas
            if len(obv_vals) < 5: return 0.0
            recent = float(obv_vals.iloc[-1])
            prev   = float(obv_vals.iloc[-5])
            return round((recent - prev) / (abs(prev) + 1e-9), 4)
        except Exception:
            return 0.0

    @staticmethod
    def bollinger_position(price: float, upper: 'pd.Series', lower: 'pd.Series') -> float:
        """Posición relativa dentro de las bandas: -1 (inferior) a +1 (superior)."""
        try:
            u, l = float(upper.iloc[-1]), float(lower.iloc[-1])
            if price > u:  return 1.0
            if price < l:  return -1.0
            mid = (u + l) / 2
            return (price - mid) / (u - mid + 1e-9)
        except Exception:
            return 0.0

    @staticmethod
    def volume_spike(volumes: list, window: int = 20) -> bool:
        if not _has_ml or len(volumes) < window + 1: return False
        try:
            arr = np.array(volumes)
            avg = arr[-window-1:-1].mean()
            return bool(arr[-1] > avg * 2.0)
        except Exception:
            return False



# ─── Análisis por timeframe individual ────────────────────────────────────────

def analizar_senal_timeframe(prices: list, volumes: list = None) -> dict:
    """Calcula señal técnica completa (RSI, StochRSI, MACD, EMA, BB, OBV) para un timeframe."""
    if not _has_ml or len(prices) < 20:
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}
    try:
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
        if rsi_val < 30:       signal += 0.25
        elif rsi_val > 70:     signal -= 0.25
        if stoch_rsi < 0.20:   signal += 0.12
        elif stoch_rsi > 0.80: signal -= 0.12
        if macd_hist > 0:      signal += 0.18
        elif macd_hist < 0:    signal -= 0.18
        if ema_cross > 0:      signal += 0.15
        elif ema_cross < 0:    signal -= 0.15
        if bb_pos < -0.5:      signal += 0.12
        elif bb_pos > 0.5:     signal -= 0.12
        if obv_delta > 0.05:   signal += 0.08
        elif obv_delta < -0.05: signal -= 0.08

        trend = "BULLISH" if signal > 0.08 else "BEARISH" if signal < -0.08 else "NEUTRAL"
        return {"signal": round(signal, 3), "rsi": round(rsi_val, 1), "trend": trend,
                "stoch_rsi": round(stoch_rsi, 3), "macd_hist": round(macd_hist, 6),
                "ema_cross": round(ema_cross, 4), "obv_delta": round(obv_delta, 4)}
    except Exception as e:
        logger.debug(f"Error analizando timeframe: {e}")
        return {"signal": 0.0, "rsi": 50.0, "trend": "NEUTRAL", "macd_hist": 0.0, "ema_cross": 0.0}


def confluencia_multi_timeframe(symbol: str) -> dict:
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
        data  = obtener_velas_binance(symbol, limit=limit, interval=tf)
        if len(data["prices"]) < 20:
            continue
        result = analizar_senal_timeframe(data["prices"], data["volumes"])
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

def obtener_velas_binance(symbol: str, limit: int = 100, interval: str = "1m") -> dict:
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

def noticias_fallback(symbol):
    coin = symbol.replace("USDT", "")
    return [
        (f"Market monitoring active for {coin}.", "system"),
        (f"Volume analysis showing steady activity for {coin}.", "system"),
        (f"Waiting for new social sentiment signals.", "system")
    ]

def obtener_noticias(symbol):
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
        final = headlines or noticias_fallback(symbol)
    except Exception as e:
        logger.debug(f"Error noticias {coin}: {e}")
        final = noticias_fallback(symbol)
    _evict_news_cache()
    NEWS_CACHE[coin] = {"data": final, "time": now}
    return final

def analizar_titulares(raw_news):
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

async def realizar_analisis(symbol: str, price: float, history: list, volumes: list = None):
    price_bucket = int(price / max(price * 0.001, 1))
    cache_key = f"ai:{symbol}:{price_bucket}"

    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached: return json.loads(cached)
        except Exception: pass

    news_data = obtener_noticias(symbol)
    news_details, avg_sentiment = analizar_titulares(news_data)

    tech_score     = 0.0
    lstm_active    = False
    indicators     = {}
    predicted_next = 0.0

    if _has_ml and len(history) >= 20:
        try:
            if not volumes or len(volumes) != len(history):
                volumes = [1000.0] * len(history)

            df = pd.DataFrame({'Close': history, 'Volume': volumes})
            df['RSI']  = IndicadoresTecnicos.rsi(df)
            df['MACD'], macd_sig = IndicadoresTecnicos.macd(df)
            bb_upper, bb_lower  = IndicadoresTecnicos.bollinger(df)
            df.bfill(inplace=True)
            df.fillna(0, inplace=True)

            rsi_val    = float(df['RSI'].iloc[-1]) if not pd.isna(df['RSI'].iloc[-1]) else 50.0
            macd_hist  = float((df['MACD'] - macd_sig).iloc[-1])
            ema_cross  = IndicadoresTecnicos.ema_cross(df)
            bb_pos     = IndicadoresTecnicos.bollinger_position(price, bb_upper, bb_lower)
            vol_spike  = IndicadoresTecnicos.volume_spike(volumes)
            stoch_rsi  = float(IndicadoresTecnicos.stoch_rsi(df).iloc[-1])
            atr_val    = IndicadoresTecnicos.atr(df)
            vwap_val   = IndicadoresTecnicos.vwap(df)
            obv_delta  = IndicadoresTecnicos.obv(df)

            indicators = {
                "rsi":           round(rsi_val, 1),
                "stoch_rsi":     round(stoch_rsi, 3),
                "macd_histogram":round(macd_hist, 4),
                "ema_cross":     round(ema_cross, 2),
                "bb_position":   round(bb_pos, 2),
                "atr":           round(atr_val, 6),
                "vwap":          round(vwap_val, 6),
                "obv_delta":     round(obv_delta, 4),
                "volume_spike":  vol_spike,
            }

            tech_signal = 0.0
            # RSI clásico
            if rsi_val < 30:   tech_signal += 0.25
            elif rsi_val > 70: tech_signal -= 0.25
            # Stoch RSI (más sensible — pesos menores para evitar ruido)
            if stoch_rsi < 0.20:   tech_signal += 0.15
            elif stoch_rsi > 0.80: tech_signal -= 0.15
            # MACD
            if macd_hist > 0:  tech_signal += 0.18
            elif macd_hist < 0: tech_signal -= 0.18
            # EMA cross
            if ema_cross > 0:  tech_signal += 0.15
            elif ema_cross < 0: tech_signal -= 0.15
            # Bollinger
            if bb_pos < -0.5:  tech_signal += 0.12
            elif bb_pos > 0.5: tech_signal -= 0.12
            # VWAP — precio por encima/debajo del VWAP indica presión compradora/vendedora
            if vwap_val > 0:
                vwap_diff = (price - vwap_val) / (vwap_val + 1e-9)
                if vwap_diff < -0.005:  tech_signal += 0.10  # precio bajo VWAP = posible rebote
                elif vwap_diff > 0.005: tech_signal -= 0.05  # precio alto VWAP = posible rechazo
            # OBV — confirma o contradice la tendencia
            if obv_delta > 0.05:   tech_signal += 0.10
            elif obv_delta < -0.05: tech_signal -= 0.10
            # Amplificar con volumen anómalo
            if vol_spike: tech_signal *= 1.25

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
        mtf = confluencia_multi_timeframe(symbol)
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

async def _precalentar_cache(symbols: list):
    logger.info(f"Pre-calentando caché para {symbols}...")
    for symbol in symbols:
        try:
            data = obtener_velas_binance(symbol, limit=100)
            if len(data["prices"]) >= 5:
                tick = data["prices"][-1]
                await realizar_analisis(symbol, tick, data["prices"], data["volumes"])
                logger.info(f"Pre-warm OK: {symbol}")
            await asyncio.sleep(0.3)  # respetar rate limit Binance
        except Exception as e:
            logger.debug(f"Pre-warm fallido para {symbol}: {e}")

@app.on_event("startup")
async def startup_pre_warm():
    asyncio.create_task(_precalentar_cache(WARM_SYMBOLS))
    asyncio.create_task(_ciclo_reentrenamiento_automatico())


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(request: PeticionMercado):
    return await realizar_analisis(
        request.symbol, request.price, request.history, request.volumes
    )

@app.post("/analyze-batch")
async def analyze_batch(request: PeticionLote):
    """Analiza múltiples símbolos en una sola llamada."""
    results = {}
    for symbol in request.symbols:
        symbol = symbol.strip().upper()
        price   = request.prices.get(symbol, 1.0)
        history = (request.histories or {}).get(symbol, [])
        volumes = (request.volumes  or {}).get(symbol, [])
        if price <= 0: continue
        try:
            results[symbol] = await realizar_analisis(symbol, price, history, volumes)
        except Exception as e:
            logger.warning(f"Error en batch para {symbol}: {e}")
    return results

@app.get("/history/{symbol}")
async def get_history(symbol: str, limit: int = 100, interval: str = "1m"):
    """Obtiene historial de velas de Binance directamente."""
    symbol = symbol.upper().strip()
    limit  = max(10, min(limit, 500))
    data   = obtener_velas_binance(symbol, limit=limit, interval=interval)
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
            news_data = obtener_noticias(symbol)
            details, _ = analizar_titulares(news_data)
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
            news_data = obtener_noticias(m)
            news_details, avg_sentiment = analizar_titulares(news_data)
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

@app.post("/retrain")
async def retrain(
    symbol:     str  = GestorReentrenamiento.SIMBOLO_BASE,
    epochs:     int  = 5,
    desde_cero: bool = False,
):
    """
    Lanza el reentrenamiento del LSTM en segundo plano.
    - symbol: símbolo de Binance para obtener datos (default BTCUSDT)
    - epochs: épocas de fine-tuning (default 5)
    - desde_cero: reconstruir arquitectura completa (default false)
    """
    symbol = symbol.upper().strip()
    epochs = max(1, min(epochs, 20))
    ok = gestor_reentrenamiento.lanzar(symbol, epochs, desde_cero)
    if not ok:
        raise HTTPException(status_code=409, detail="Ya hay un reentrenamiento en curso")
    return {"mensaje": "Reentrenamiento iniciado", "symbol": symbol, "epochs": epochs}

@app.get("/retrain/status")
async def retrain_status():
    """Estado actual del gestor de reentrenamiento."""
    return gestor_reentrenamiento.estado_actual()

@app.get("/multi-timeframe/{symbol}")
async def get_multi_timeframe(symbol: str):
    """Devuelve el análisis de confluencia multi-timeframe para un símbolo."""
    symbol = symbol.upper().strip()
    try:
        mtf = confluencia_multi_timeframe(symbol)
        return mtf
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    estado_retrain = gestor_reentrenamiento.estado_actual()
    return {
        "status":               "ok",
        "redis":                redis_client is not None,
        "lstm":                 lstm_model is not None,
        "finbert":              sentiment_model is not None,
        "news_api":             bool(CRYPTO_PANIC_KEY),
        "news_cache":           len(NEWS_CACHE),
        "models_ready":         lstm_model is not None or sentiment_model is not None,
        "reentrenamiento":      estado_retrain,
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
