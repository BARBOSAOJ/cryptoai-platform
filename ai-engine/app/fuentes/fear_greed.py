"""
fear_greed.py — Índice Fear & Greed de alternative.me.
Actualización diaria; caché de 10 min para no saturar la API.
"""
import time
import requests
from app.config import logger

_CACHE: dict = {"ts": 0.0, "data": None}
_TTL = 600  # 10 min


def obtener_fear_greed() -> dict:
    """Devuelve {'valor': 0-100, 'clasificacion': str, 'normalizado': -1..+1}"""
    now = time.time()
    if _CACHE["data"] and now - _CACHE["ts"] < _TTL:
        return _CACHE["data"]
    try:
        r = requests.get(
            "https://api.alternative.me/fng/?limit=1",
            timeout=5,
        )
        item = r.json()["data"][0]
        valor = int(item["value"])
        result = {
            "valor": valor,
            "clasificacion": item["value_classification"],
            # Mapeo lineal 0-100 → -1..+1 (50 = neutral)
            "normalizado": round((valor - 50) / 50, 3),
        }
        _CACHE["ts"] = now
        _CACHE["data"] = result
        return result
    except Exception as e:
        logger.warning(f"Fear & Greed no disponible: {e}")
        return {"valor": 50, "clasificacion": "Neutral", "normalizado": 0.0}
