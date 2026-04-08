"""
modelos.py — Carga y referencia global de los modelos ML (LSTM, scaler, FinBERT).
Centraliza el estado mutable para que reentrenamiento.py pueda actualizarlo
y analisis.py pueda leerlo sin importaciones circulares.
"""
from app.config import logger, _has_ml, _has_nlp

# ─── FinBERT ──────────────────────────────────────────────────────────────────

tokenizer = None
sentiment_model = None

if _has_nlp:
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        sentiment_model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        logger.info("FinBERT cargado")
    except Exception as e:
        logger.warning(f"FinBERT no disponible: {e}")

# ─── LSTM ─────────────────────────────────────────────────────────────────────

lstm_model = None
scaler = None

if _has_ml:
    try:
        import tensorflow as tf
        import joblib
        lstm_model = tf.keras.models.load_model('models/crypto_lstm_model_v3.h5')
        scaler = joblib.load('models/scaler_v3.gz')
        logger.info("LSTM cargado")
    except Exception as e:
        logger.warning(f"LSTM no disponible: {e}")
