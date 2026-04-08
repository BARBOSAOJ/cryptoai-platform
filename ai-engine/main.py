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
    SIMBOLOS_FIJOS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BNBUSDT', 'XRPUSDT']

    def __init__(self):
        self.estado: str               = 'inactivo'   # inactivo | entrenando | error
        self.ultimo_entrenamiento: Optional[str] = None
        self.metricas: dict            = {}
        self._lock                     = threading.Lock()
        self._executor                 = ThreadPoolExecutor(max_workers=1)

    # ── Obtención dinámica de símbolos ────────────────────────────────────────

    @staticmethod
    def obtener_todos_usdt(max_simbolos: int = 0) -> list:
        """
        Consulta Binance para obtener todos los pares USDT activos,
        ordenados de mayor a menor volumen en 24h.
        max_simbolos=0 significa sin límite (todos).
        """
        try:
            # 1. Símbolos activos de tipo SPOT con quote=USDT
            info = requests.get(
                "https://api.binance.com/api/v3/exchangeInfo", timeout=15
            ).json()
            activos = {
                s['symbol']
                for s in info.get('symbols', [])
                if s['status'] == 'TRADING'
                and s['quoteAsset'] == 'USDT'
                and s['isSpotTradingAllowed']
            }

            # 2. Ordenar por volumen 24h
            tickers = requests.get(
                "https://api.binance.com/api/v3/ticker/24hr", timeout=15
            ).json()
            ordenados = sorted(
                [t for t in tickers if t['symbol'] in activos],
                key=lambda t: float(t.get('quoteVolume', 0)),
                reverse=True,
            )
            simbolos = [t['symbol'] for t in ordenados]
            if max_simbolos > 0:
                simbolos = simbolos[:max_simbolos]
            logger.info(f"Símbolos USDT obtenidos de Binance: {len(simbolos)}")
            return simbolos
        except Exception as e:
            logger.warning(f"No se pudieron obtener símbolos de Binance: {e}. Usando lista fija.")
            return GestorReentrenamiento.SIMBOLOS_FIJOS

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

    def _preparar_datos_simbolo(self, symbol: str, scaler_fit, limit: int = 1000, interval: str = '1h'):
        """
        Descarga velas de un símbolo, calcula indicadores y construye
        secuencias (X, y) normalizadas con el scaler proporcionado.
        Retorna (X, y) o (None, None) si hay error.
        """
        try:
            url  = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
            resp = requests.get(url, timeout=15)
            if resp.status_code != 200:
                logger.warning(f"Binance {symbol} devolvió {resp.status_code}")
                return None, None

            rows = resp.json()
            if len(rows) < self.SEQ_LEN + 30:
                logger.warning(f"{symbol}: datos insuficientes ({len(rows)} velas)")
                return None, None

            df = pd.DataFrame(rows, columns=[
                'ts','open','high','low','close','vol',
                'close_ts','quote_vol','trades','taker_base','taker_quote','ignore'
            ])
            df['Close']  = df['close'].astype(float)
            df['Volume'] = df['vol'].astype(float)
            df['RSI']    = IndicadoresTecnicos.rsi(df)
            df['MACD'], _ = IndicadoresTecnicos.macd(df)
            df.bfill(inplace=True)
            df.fillna(0, inplace=True)

            # Normalizar cada símbolo por separado (precios muy distintos entre BTC y DOGE)
            data_scaled = scaler_fit.transform(
                df[self.FEATURES].values
            ) if hasattr(scaler_fit, 'scale_') else scaler_fit.fit_transform(
                df[self.FEATURES].values
            )

            X, y = [], []
            for i in range(self.SEQ_LEN, len(data_scaled)):
                X.append(data_scaled[i - self.SEQ_LEN:i])
                y.append(data_scaled[i, 0])
            return np.array(X), np.array(y)
        except Exception as e:
            logger.warning(f"Error preparando datos de {symbol}: {e}")
            return None, None

    def _preparar_datos_multi(self, simbolos: list, limit: int = 1000, interval: str = '1h'):
        """
        Descarga y combina datos de todos los símbolos en un único dataset.
        Cada símbolo se normaliza con su propio MinMaxScaler para que
        las magnitudes de precio no dominen el aprendizaje.
        Devuelve (X_total, y_total, scaler_btc).
        """
        from sklearn.preprocessing import MinMaxScaler

        X_total, y_total = [], []
        scaler_btc  = None
        ok, fallido = 0, 0
        total       = len(simbolos)

        for i, sym in enumerate(simbolos, 1):
            sc = MinMaxScaler()
            X, y = self._preparar_datos_simbolo(sym, sc, limit, interval)
            if X is None:
                fallido += 1
            else:
                X_total.append(X)
                y_total.append(y)
                if sym == 'BTCUSDT' or scaler_btc is None:
                    scaler_btc = sc
                ok += 1

            # Log de progreso cada 25 símbolos
            if i % 25 == 0 or i == total:
                logger.info(f"  Progreso: {i}/{total} — OK={ok} fallidos={fallido}")

            # Pausa de 120ms entre llamadas para respetar rate limit de Binance
            time.sleep(0.12)

        if not X_total:
            raise RuntimeError("Ningún símbolo devolvió datos válidos")

        logger.info(f"Dataset combinado: {ok} símbolos, {sum(len(x) for x in X_total)} secuencias totales")
        return np.concatenate(X_total), np.concatenate(y_total), scaler_btc

    # ── Lógica de entrenamiento (ejecutada en hilo aparte) ────────────────────

    def _ejecutar_entrenamiento(self, simbolos: list, epochs: int, desde_cero: bool):
        global lstm_model, scaler
        try:
            with self._lock:
                self.estado = 'entrenando'

            logger.info(f"Reentrenamiento iniciado — símbolos={simbolos} epochs={epochs} desde_cero={desde_cero}")
            X, y, scaler_nuevo = self._preparar_datos_multi(simbolos)

            # Mezclar secuencias para que el modelo no aprenda sesgo de orden
            indices = np.random.permutation(len(X))
            X, y = X[indices], y[indices]

            split = int(len(X) * 0.85)
            X_train, X_val = X[:split], X[split:]
            y_train, y_val = y[:split], y[split:]

            if desde_cero or lstm_model is None:
                modelo = self._construir_arquitectura()
                logger.info("Arquitectura LSTM construida desde cero")
            else:
                modelo = lstm_model

            historia = modelo.fit(
                X_train, y_train,
                epochs=epochs,
                batch_size=32,
                validation_data=(X_val, y_val),
                verbose=0,
            )

            ruta_tmp = self.RUTA_MODELO + '.tmp'
            modelo.save(ruta_tmp)
            os.replace(ruta_tmp, self.RUTA_MODELO)
            joblib.dump(scaler_nuevo, self.RUTA_SCALER)

            lstm_model = modelo
            scaler     = scaler_nuevo

            metricas = {
                'loss_final':     round(float(historia.history['loss'][-1]), 6),
                'val_loss_final': round(float(historia.history['val_loss'][-1]), 6),
                'epochs':         epochs,
                'muestras':       len(X_train),
                'simbolos':       simbolos,
            }
            with self._lock:
                self.estado               = 'inactivo'
                self.ultimo_entrenamiento = datetime.utcnow().isoformat() + 'Z'
                self.metricas             = metricas

            logger.info(f"Reentrenamiento completado — {metricas}")

        except Exception as e:
            logger.error(f"Error en reentrenamiento: {e}")
            with self._lock:
                self.estado   = 'error'
                self.metricas = {'error': str(e)}

    # ── API pública ───────────────────────────────────────────────────────────

    def lanzar(self, simbolos: list = None, epochs: int = 5, desde_cero: bool = False):
        """
        Lanza el entrenamiento en un hilo de fondo (no bloqueante).
        Si simbolos es None, obtiene dinámicamente todos los pares USDT activos.
        """
        with self._lock:
            if self.estado == 'entrenando':
                return False
        if simbolos is None:
            simbolos = self.obtener_todos_usdt()
        self._executor.submit(self._ejecutar_entrenamiento, simbolos, epochs, desde_cero)
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



# ─── Detector de régimen de mercado ──────────────────────────────────────────

class DetectorRegimen:
    """
    Detecta si el mercado está en tendencia, lateral o volátil.
    Ajusta los pesos de los indicadores según el régimen para evitar
    señales falsas (ej: RSI en tendencia fuerte, MACD en mercado lateral).

    Regímenes:
      TRENDING   — movimiento direccional claro (ADX alto, R² alto)
      RANGING    — precio oscilando en rango (ADX bajo, baja volatilidad)
      VOLATILE   — movimientos bruscos sin dirección clara (ATR/precio alto)
      TRANSITION — zona intermedia entre regímenes
    """

    @staticmethod
    def adx(df: 'pd.DataFrame', window: int = 14) -> float:
        """
        Average Directional Index con datos OHLCV.
        Si solo hay Close, usa una aproximación basada en rangos de Close.
        """
        if not _has_ml: return 20.0
        try:
            if 'High' in df.columns and 'Low' in df.columns:
                high, low = df['High'], df['Low']
            else:
                # Aproximación: High/Low estimados con rolling max/min de Close
                high = df['Close'].rolling(3).max()
                low  = df['Close'].rolling(3).min()

            prev_close = df['Close'].shift(1)
            tr = pd.concat([
                high - low,
                (high - prev_close).abs(),
                (low  - prev_close).abs(),
            ], axis=1).max(axis=1)

            dm_pos = (high - high.shift(1)).clip(lower=0)
            dm_neg = (low.shift(1) - low).clip(lower=0)
            dm_pos = dm_pos.where(dm_pos > dm_neg, 0)
            dm_neg = dm_neg.where(dm_neg > dm_pos, 0)

            atr_s   = tr.ewm(span=window, adjust=False).mean()
            di_pos  = 100 * dm_pos.ewm(span=window, adjust=False).mean() / (atr_s + 1e-9)
            di_neg  = 100 * dm_neg.ewm(span=window, adjust=False).mean() / (atr_s + 1e-9)
            dx      = 100 * (di_pos - di_neg).abs() / (di_pos + di_neg + 1e-9)
            adx_val = float(dx.ewm(span=window, adjust=False).mean().iloc[-1])
            return round(adx_val, 2)
        except Exception:
            return 20.0

    @staticmethod
    def pendiente_lineal(precios: list, ventana: int = 20) -> float:
        """
        Pendiente normalizada de una regresión lineal sobre las últimas
        `ventana` velas. Positiva = tendencia alcista, negativa = bajista.
        Normalizada por el precio medio para ser comparable entre símbolos.
        """
        if not _has_ml or len(precios) < ventana: return 0.0
        try:
            y = np.array(precios[-ventana:], dtype=float)
            x = np.arange(ventana)
            coef  = np.polyfit(x, y, 1)
            slope = coef[0]
            return round(slope / (y.mean() + 1e-9), 6)   # normalizado
        except Exception:
            return 0.0

    @staticmethod
    def r_cuadrado(precios: list, ventana: int = 20) -> float:
        """
        R² de la regresión lineal: 1 = tendencia perfecta, 0 = ruido puro.
        Alto R² en precio = mercado tendencial.
        """
        if not _has_ml or len(precios) < ventana: return 0.0
        try:
            y    = np.array(precios[-ventana:], dtype=float)
            x    = np.arange(ventana)
            coef = np.polyfit(x, y, 1)
            y_hat = np.polyval(coef, x)
            ss_res = ((y - y_hat) ** 2).sum()
            ss_tot = ((y - y.mean()) ** 2).sum()
            return round(1 - ss_res / (ss_tot + 1e-9), 4)
        except Exception:
            return 0.0

    @classmethod
    def detectar(cls, df: 'pd.DataFrame', atr_val: float = 0.0) -> dict:
        """
        Analiza el régimen actual y devuelve:
          - regimen:    TRENDING | RANGING | VOLATILE | TRANSITION
          - adx:        valor ADX
          - r2:         R² de la tendencia
          - pendiente:  slope normalizada
          - confianza:  0-1 (qué tan clara es la clasificación)
          - pesos:      dict con factores multiplicadores por indicador
        """
        if not _has_ml or len(df) < 20:
            return cls._regimen_neutro()

        precios  = df['Close'].tolist()
        adx_val  = cls.adx(df)
        r2       = cls.r_cuadrado(precios)
        pendiente = cls.pendiente_lineal(precios)

        # Volatilidad relativa: ATR como % del precio actual
        precio_actual = float(df['Close'].iloc[-1])
        vol_relativa  = atr_val / (precio_actual + 1e-9) if atr_val > 0 else 0.0

        # ── Clasificación ──────────────────────────────────────────────────────
        if vol_relativa > 0.04:                            # ATR > 4% del precio
            regimen    = "VOLATILE"
            confianza  = min(1.0, vol_relativa / 0.06)
            pesos      = cls._pesos_volatil()
        elif adx_val > 25 and r2 > 0.6:                   # Tendencia clara
            regimen    = "TRENDING"
            confianza  = min(1.0, (adx_val - 25) / 30 * 0.5 + r2 * 0.5)
            pesos      = cls._pesos_tendencia(pendiente)
        elif adx_val < 20 and r2 < 0.4:                   # Mercado lateral
            regimen    = "RANGING"
            confianza  = min(1.0, (20 - adx_val) / 20 * 0.5 + (0.4 - r2) / 0.4 * 0.5)
            pesos      = cls._pesos_lateral()
        else:                                               # Transición entre regímenes
            regimen    = "TRANSITION"
            confianza  = 0.4
            pesos      = cls._pesos_neutros()

        return {
            "regimen":    regimen,
            "adx":        adx_val,
            "r2":         r2,
            "pendiente":  pendiente,
            "confianza":  round(confianza, 2),
            "pesos":      pesos,
        }

    # ── Tablas de pesos por régimen ────────────────────────────────────────────

    @staticmethod
    def _pesos_tendencia(pendiente: float) -> dict:
        """En tendencia: priorizar indicadores de momentum, reducir osciladores."""
        return {
            "rsi":       0.6,   # RSI menos útil en tendencia fuerte
            "stoch_rsi": 0.5,
            "macd":      1.4,   # MACD destaca tendencias
            "ema_cross": 1.4,
            "bollinger": 0.7,
            "vwap":      1.2,
            "obv":       1.3,
        }

    @staticmethod
    def _pesos_lateral() -> dict:
        """En lateral: priorizar osciladores de reversión, ignorar momentum."""
        return {
            "rsi":       1.5,   # RSI muy útil en rangos
            "stoch_rsi": 1.4,
            "macd":      0.6,   # MACD da falsas señales en lateral
            "ema_cross": 0.5,
            "bollinger": 1.5,   # Bollinger ideal para rangos
            "vwap":      1.2,
            "obv":       0.8,
        }

    @staticmethod
    def _pesos_volatil() -> dict:
        """En volatilidad extrema: reducir todos los pesos, señal poco fiable."""
        return {
            "rsi":       0.5,
            "stoch_rsi": 0.5,
            "macd":      0.5,
            "ema_cross": 0.5,
            "bollinger": 0.6,
            "vwap":      0.7,
            "obv":       0.5,
        }

    @staticmethod
    def _pesos_neutros() -> dict:
        return {"rsi": 1.0, "stoch_rsi": 1.0, "macd": 1.0,
                "ema_cross": 1.0, "bollinger": 1.0, "vwap": 1.0, "obv": 1.0}

    @staticmethod
    def _regimen_neutro() -> dict:
        return {"regimen": "RANGING", "adx": 20.0, "r2": 0.0,
                "pendiente": 0.0, "confianza": 0.0,
                "pesos": DetectorRegimen._pesos_neutros()}


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
    regimen_info   = DetectorRegimen._regimen_neutro()

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

            # ── Detección de régimen de mercado ───────────────────────────────
            regimen_info = DetectorRegimen.detectar(df, atr_val)
            pesos        = regimen_info["pesos"]
            indicators["regimen"] = regimen_info["regimen"]
            indicators["adx"]     = regimen_info["adx"]

            tech_signal = 0.0
            # RSI clásico (peso ajustado por régimen)
            if rsi_val < 30:   tech_signal += 0.25 * pesos["rsi"]
            elif rsi_val > 70: tech_signal -= 0.25 * pesos["rsi"]
            # Stoch RSI
            if stoch_rsi < 0.20:   tech_signal += 0.15 * pesos["stoch_rsi"]
            elif stoch_rsi > 0.80: tech_signal -= 0.15 * pesos["stoch_rsi"]
            # MACD
            if macd_hist > 0:   tech_signal += 0.18 * pesos["macd"]
            elif macd_hist < 0: tech_signal -= 0.18 * pesos["macd"]
            # EMA cross
            if ema_cross > 0:   tech_signal += 0.15 * pesos["ema_cross"]
            elif ema_cross < 0: tech_signal -= 0.15 * pesos["ema_cross"]
            # Bollinger
            if bb_pos < -0.5:  tech_signal += 0.12 * pesos["bollinger"]
            elif bb_pos > 0.5: tech_signal -= 0.12 * pesos["bollinger"]
            # VWAP
            if vwap_val > 0:
                vwap_diff = (price - vwap_val) / (vwap_val + 1e-9)
                if vwap_diff < -0.005:  tech_signal += 0.10 * pesos["vwap"]
                elif vwap_diff > 0.005: tech_signal -= 0.05 * pesos["vwap"]
            # OBV
            if obv_delta > 0.05:   tech_signal += 0.10 * pesos["obv"]
            elif obv_delta < -0.05: tech_signal -= 0.10 * pesos["obv"]
            # Amplificar con volumen anómalo (solo si no estamos en régimen volátil)
            if vol_spike and regimen_info["regimen"] != "VOLATILE":
                tech_signal *= 1.25

            if lstm_model and scaler and len(history) >= 60:
                data_matrix = df[['Close', 'Volume', 'RSI', 'MACD']].values[-60:]
                scaled_data = scaler.transform(data_matrix)
                pred = lstm_model.predict(np.array([scaled_data]), verbose=0)
                dummy = np.zeros((1, 4))
                dummy[0, 0] = pred[0][0]
                p_val = float(scaler.inverse_transform(dummy)[0][0])
                predicted_next = round(p_val, 2)
                lstm_score = float(((p_val - price) / price) * 100)

                # Ponderación LSTM ajustada por régimen:
                # TRENDING   → LSTM captura bien el momentum, más peso
                # RANGING    → osciladores más fiables, menos peso LSTM
                # VOLATILE   → señal poco confiable, mínimo peso LSTM
                # TRANSITION → peso estándar
                regimen_lstm = regimen_info["regimen"]
                if regimen_lstm == "TRENDING":
                    tech_score = lstm_score * 0.55 + tech_signal * 0.45
                elif regimen_lstm == "RANGING":
                    tech_score = lstm_score * 0.25 + tech_signal * 0.75
                elif regimen_lstm == "VOLATILE":
                    tech_score = lstm_score * 0.20 + tech_signal * 0.80
                else:  # TRANSITION
                    tech_score = lstm_score * 0.40 + tech_signal * 0.60
                lstm_active = True
            else:
                tech_score = tech_signal

        except Exception as e:
            logger.debug(f"Error análisis técnico {symbol}: {e}")

    # ── Multi-timeframe ────────────────────────────────────────────────────────
    mtf = {}
    mtf_boost = 0.0
    try:
        mtf = confluencia_multi_timeframe(symbol)
        if mtf.get("total", 0) >= 2:
            tech_score = tech_score * 0.55 + mtf["signal"] * 0.45
        agreement = mtf.get("agreement", 0)
        total_tf  = mtf.get("total", 0)
        if total_tf > 0:
            ratio = agreement / total_tf
            if ratio >= 1.0:    mtf_boost = 18
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
    if combined > 0.10:    signal = "COMPRAR 🚀"
    elif combined < -0.10: signal = "VENDER 📉"

    # ── Confianza con ajuste por régimen ──────────────────────────────────────
    regimen_actual = indicators.get("regimen", "RANGING")
    base_max = 85 if lstm_active else 74 if indicators else 62

    # TRENDING clara con confluencia MTF puede subir más
    # VOLATILE reduce el techo para no dar señales falsas de alta confianza
    if regimen_actual == "TRENDING":    base_max = min(base_max + 5, 91)
    elif regimen_actual == "VOLATILE":  base_max = max(base_max - 10, 52)
    elif regimen_actual == "TRANSITION": base_max = max(base_max - 5, 57)

    conf = int(min(base_max + mtf_boost, 96))
    conf = min(int(max(conf, abs(combined) * 45 + 50) + mtf_boost), 96)

    # Aplicar calibración isotónica si existe en Redis para este símbolo
    conf = MotorBacktest.aplicar_calibracion(symbol, conf)

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
        "market_regime":  regimen_info if indicators else {"regimen": "RANGING"},
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


# ─── Motor de Backtesting ─────────────────────────────────────────────────────

class MotorBacktest:
    """
    Calibra la confianza del modelo contra precisión histórica real.

    Flujo:
      1. Descarga 6 meses de velas 1h de Binance (paginada).
      2. Ventana deslizante de 60 velas cada 6h → simula la señal técnica.
      3. Verifica si acertó 24 velas después.
      4. Aplica regresión isotónica para calibrar las probabilidades.
      5. Guarda curva y mapa en Redis (TTL 24h).
    """

    CALIBRACION_TTL = 3600 * 24   # 24 horas
    HORIZONTE       = 24           # velas 1h a futuro para verificar
    STEP            = 6            # velas entre simulaciones (cada 6h)
    MESES           = 6

    def __init__(self):
        self._estados: dict        = {}   # symbol → estado
        self._lock                 = threading.Lock()
        self._executor             = ThreadPoolExecutor(max_workers=2)

    # ── Descarga paginada ─────────────────────────────────────────────────────

    @staticmethod
    def _descargar_historial(symbol: str, meses: int = 6) -> list:
        end_ms   = int(time.time() * 1000)
        start_ms = end_ms - meses * 30 * 24 * 3600 * 1000
        all_rows = []
        cur      = start_ms
        while cur < end_ms:
            url = (f"https://api.binance.com/api/v3/klines"
                   f"?symbol={symbol}&interval=1h&limit=1000"
                   f"&startTime={cur}&endTime={end_ms}")
            try:
                resp = requests.get(url, timeout=15)
                if resp.status_code != 200:
                    break
                rows = resp.json()
                if not rows:
                    break
                all_rows.extend(rows)
                cur = int(rows[-1][6]) + 1   # close_time del último + 1ms
                if len(rows) < 1000:
                    break
                time.sleep(0.15)
            except Exception as e:
                logger.warning(f"Backtest descarga {symbol}: {e}")
                break
        return all_rows

    # ── Señal técnica (misma lógica que realizar_analisis, sin LSTM/news) ─────

    @staticmethod
    def _senal_tecnica(df_win: 'pd.DataFrame', precio: float) -> tuple:
        """Devuelve (pred_dir, raw_conf) con pred_dir en {-1, 0, 1}."""
        try:
            rsi_val   = float(df_win['RSI'].iloc[-1])
            stoch_rsi = float(IndicadoresTecnicos.stoch_rsi(df_win).iloc[-1])
            macd_s    = df_win['MACD'].ewm(span=9, adjust=False).mean()
            macd_hist = float((df_win['MACD'] - macd_s).iloc[-1])
            ema_cross = IndicadoresTecnicos.ema_cross(df_win)
            bb_up, bb_lo = IndicadoresTecnicos.bollinger(df_win)
            bb_pos    = IndicadoresTecnicos.bollinger_position(precio, bb_up, bb_lo)
            atr_val   = IndicadoresTecnicos.atr(df_win)

            regimen = DetectorRegimen.detectar(df_win, atr_val)
            pesos   = regimen["pesos"]
            reg_nom = regimen["regimen"]

            sig = 0.0
            if rsi_val < 30:         sig += 0.25 * pesos["rsi"]
            elif rsi_val > 70:       sig -= 0.25 * pesos["rsi"]
            if stoch_rsi < 0.20:     sig += 0.15 * pesos["stoch_rsi"]
            elif stoch_rsi > 0.80:   sig -= 0.15 * pesos["stoch_rsi"]
            if macd_hist > 0:        sig += 0.18 * pesos["macd"]
            elif macd_hist < 0:      sig -= 0.18 * pesos["macd"]
            if ema_cross > 0:        sig += 0.15 * pesos["ema_cross"]
            elif ema_cross < 0:      sig -= 0.15 * pesos["ema_cross"]
            if bb_pos < -0.5:        sig += 0.12 * pesos["bollinger"]
            elif bb_pos > 0.5:       sig -= 0.12 * pesos["bollinger"]

            pred_dir = 1 if sig > 0.08 else (-1 if sig < -0.08 else 0)

            base_max = 74
            if reg_nom == "TRENDING":    base_max = min(base_max + 5, 91)
            elif reg_nom == "VOLATILE":  base_max = max(base_max - 10, 52)
            elif reg_nom == "TRANSITION": base_max = max(base_max - 5, 57)
            raw_conf = min(int(max(base_max, abs(sig) * 45 + 50)), 96)

            return pred_dir, raw_conf
        except Exception:
            return 0, 60

    # ── Ejecución en hilo ─────────────────────────────────────────────────────

    def _ejecutar(self, symbol: str):
        with self._lock:
            self._estados[symbol] = {"estado": "ejecutando", "inicio": datetime.utcnow().isoformat() + "Z"}

        try:
            rows = self._descargar_historial(symbol, self.MESES)
            if len(rows) < 200:
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
            df_full.bfill(inplace=True)
            df_full.fillna(0, inplace=True)

            n = len(df_full)
            SEQ = 60
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
                raise ValueError(f"Muestras insuficientes para calibrar: {len(raw_confs)}")

            # ── Métricas globales ──────────────────────────────────────────────
            total    = len(correct_labels)
            accuracy = round(sum(correct_labels) / total, 4)

            buys  = [(c, l) for c, l, s in zip(raw_confs, correct_labels, signals_list) if s ==  1]
            sells = [(c, l) for c, l, s in zip(raw_confs, correct_labels, signals_list) if s == -1]
            tp = sum(1 for _, l in buys  if l == 1)
            fp = sum(1 for _, l in buys  if l == 0)
            fn = sum(1 for _, l in sells if l == 0)
            precision = round(tp / (tp + fp + 1e-9), 4)
            recall    = round(tp / (tp + fn + 1e-9), 4)

            buy_returns = [0.01 if l == 1 else -0.01 for _, l in buys]
            if buy_returns:
                r_arr  = np.array(buy_returns)
                sharpe = float(r_arr.mean() / (r_arr.std() + 1e-9) * np.sqrt(252))
            else:
                sharpe = 0.0

            # ── Calibración isotónica ──────────────────────────────────────────
            from sklearn.isotonic import IsotonicRegression
            X_cal = np.array(raw_confs, dtype=float) / 100.0
            y_cal = np.array(correct_labels, dtype=float)
            iso   = IsotonicRegression(out_of_bounds='clip')
            iso.fit(X_cal, y_cal)

            # Mapa de calibración: raw conf → calibrado (0-100)
            calibration_map = {
                str(c): round(float(iso.predict([c / 100.0])[0]) * 100, 1)
                for c in range(50, 97)
            }

            # Curva por buckets de 10 puntos
            buckets: dict = {}
            for conf, correct in zip(raw_confs, correct_labels):
                bkt = (conf // 10) * 10
                if bkt not in buckets:
                    buckets[bkt] = {"total": 0, "correct": 0}
                buckets[bkt]["total"]   += 1
                buckets[bkt]["correct"] += correct

            calibration_curve = {
                bkt: {
                    "predicha": bkt,
                    "real": round(d["correct"] / d["total"] * 100, 1),
                    "muestras": d["total"],
                }
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

    # ── API pública ───────────────────────────────────────────────────────────

    def lanzar(self, symbol: str) -> bool:
        with self._lock:
            estado = self._estados.get(symbol, {}).get("estado")
        if estado == "ejecutando":
            return False
        self._executor.submit(self._ejecutar, symbol)
        return True

    def estado(self, symbol: str) -> dict:
        with self._lock:
            return self._estados.get(symbol, {"estado": "no_iniciado"})

    @staticmethod
    def aplicar_calibracion(symbol: str, raw_conf: int) -> int:
        """Aplica la calibración isotónica guardada en Redis. Devuelve raw_conf si no hay datos."""
        if not redis_client:
            return raw_conf
        try:
            cal_json = redis_client.get(f"calibration:{symbol}")
            if not cal_json:
                return raw_conf
            cal_map = json.loads(cal_json)
            calibrado = cal_map.get(str(raw_conf))
            return int(round(float(calibrado))) if calibrado is not None else raw_conf
        except Exception:
            return raw_conf


motor_backtest = MotorBacktest()


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
    simbolos:   str  = '',
    epochs:     int  = 5,
    desde_cero: bool = False,
):
    """
    Lanza el reentrenamiento del LSTM en segundo plano.
    - simbolos: lista separada por comas; vacío = todos los pares USDT activos de Binance
    - epochs: épocas de fine-tuning (default 5)
    - desde_cero: reconstruir arquitectura completa (default false)
    """
    lista = [s.strip().upper() for s in simbolos.split(',') if s.strip()] or None
    epochs = max(1, min(epochs, 20))
    ok = gestor_reentrenamiento.lanzar(lista, epochs, desde_cero)
    if not ok:
        raise HTTPException(status_code=409, detail="Ya hay un reentrenamiento en curso")
    n = len(lista) if lista else "todos los pares USDT"
    return {"mensaje": "Reentrenamiento iniciado", "simbolos": lista or "todos", "epochs": epochs, "total": n}

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

@app.post("/backtest/{symbol}")
async def backtest_lanzar(symbol: str):
    """Lanza el backtesting histórico en segundo plano para un símbolo."""
    symbol = symbol.upper().strip()
    ok = motor_backtest.lanzar(symbol)
    if not ok:
        raise HTTPException(status_code=409, detail=f"Backtest ya en curso para {symbol}")
    return {"mensaje": f"Backtest iniciado para {symbol}", "symbol": symbol}

@app.get("/backtest/{symbol}")
async def backtest_resultado(symbol: str):
    """
    Devuelve métricas de backtesting.
    Orden de prioridad: estado en memoria → Redis → 404.
    """
    symbol = symbol.upper().strip()
    estado = motor_backtest.estado(symbol)

    if estado.get("estado") == "ejecutando":
        return {"symbol": symbol, "estado": "ejecutando"}
    if estado.get("estado") == "error":
        raise HTTPException(status_code=500, detail=estado.get("error", "Error desconocido"))
    if estado.get("estado") == "completado":
        return estado["resultado"]

    # Buscar en Redis (backtest anterior a este proceso)
    if redis_client:
        try:
            cached = redis_client.get(f"backtest:{symbol}")
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    raise HTTPException(status_code=404, detail=f"Sin datos de backtest para {symbol}. Lanza POST /backtest/{symbol}")

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
