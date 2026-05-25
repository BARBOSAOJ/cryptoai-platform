"""
config.py — Configuración global, Redis, constantes y estado compartido.
Sin dependencias de otros módulos de la app.
"""
import os
import time
import logging
import threading
import json

from dotenv import load_dotenv
load_dotenv()

# ─── Logger ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('ai-engine')

# ─── Constantes ───────────────────────────────────────────────────────────────

CRYPTO_PANIC_KEY  = os.getenv('CRYPTOPANIC_KEY', '')
CACHE_DURATION    = 300
NEWS_CACHE_MAX    = 100
BINANCE_KLINES    = "https://api.binance.com/api/v3/klines"
AI_CACHE_TTL      = 90
MTF_CACHE_TTL     = 120
WARM_SYMBOLS      = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "PEPEUSDT", "SHIBUSDT", "TRUMPUSDT"]
TIMEFRAMES        = ["1m", "15m", "1h", "4h"]
TIMEFRAME_WEIGHTS = {"1m": 0.15, "15m": 0.25, "1h": 0.35, "4h": 0.25}

# ─── Flags de disponibilidad de librerías ML ──────────────────────────────────

os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('HF_HUB_OFFLINE', '1')

_has_ml = False
_has_nlp = False

try:
    import tensorflow  # noqa: F401
    import joblib      # noqa: F401
    import numpy       # noqa: F401
    import pandas      # noqa: F401
    _has_ml = True
except ImportError:
    logger.warning("TensorFlow/numpy/pandas no disponibles — LSTM desactivado")

try:
    import transformers  # noqa: F401
    import torch         # noqa: F401
    _has_nlp = True
except ImportError:
    logger.warning("Transformers/torch no disponibles — FinBERT desactivado")

# ─── Redis ────────────────────────────────────────────────────────────────────

redis_client = None
try:
    import redis as _redis_lib
    redis_client = _redis_lib.Redis(
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

# ─── Caché de noticias (en memoria) ───────────────────────────────────────────

NEWS_CACHE: dict = {}

# ─── Buffers para calibración online ─────────────────────────────────────────
# { symbol: [ {conf, signal, price, ts}, ... ] }
_precios_recientes: dict = {}
_buffer_predicciones: dict = {}
