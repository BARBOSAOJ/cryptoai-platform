"""
historial.py — Track record en vivo de BT.
Guarda cada predicción emitida, la evalúa N horas después comparando con el
precio real, y expone el historial de aciertos/fallos por símbolo.
"""
import json
import time
import uuid
from app.config import logger, redis_client

HORIZONTE_H   = 4      # horas para evaluar la predicción
UMBRAL_PCT    = 0.005  # movimiento mínimo para considerar COMPRAR/VENDER correcto
MAX_HISTORIAL = 200    # predicciones máximas guardadas por símbolo
TTL_DIAS      = 7      # días que se conservan en Redis


def guardar_prediccion(symbol: str, signal: str, conviction: int,
                       price: float, confidence: str) -> None:
    """Registra una nueva predicción de BT para evaluarla más tarde."""
    if not redis_client:
        return
    pred = {
        "id":           str(uuid.uuid4())[:8],
        "symbol":       symbol,
        "signal":       signal,
        "conviction":   conviction,
        "confidence":   confidence,
        "price_at_rec": price,
        "timestamp":    time.time(),
        "evaluated":    False,
        "outcome":      None,
    }
    try:
        key = f"bt:historial:{symbol}"
        raw = redis_client.get(key)
        historial = json.loads(raw) if raw else []
        historial.append(pred)
        redis_client.setex(key, TTL_DIAS * 86400, json.dumps(historial[-MAX_HISTORIAL:]))
    except Exception as e:
        logger.warning(f"BT historial — error guardando: {e}")


def evaluar_predicciones(symbol: str, precio_actual: float) -> list:
    """
    Evalúa predicciones pendientes cuyo horizonte ya venció.
    Devuelve la lista de predicciones recién evaluadas.
    """
    if not redis_client:
        return []
    try:
        key = f"bt:historial:{symbol}"
        raw = redis_client.get(key)
        if not raw:
            return []
        historial = json.loads(raw)
        ahora = time.time()
        recien = []
        for pred in historial:
            if pred["evaluated"]:
                continue
            if ahora - pred["timestamp"] < HORIZONTE_H * 3600:
                continue
            mov = (precio_actual - pred["price_at_rec"]) / (pred["price_at_rec"] + 1e-9)
            sig = pred["signal"]
            if "COMPRAR" in sig:
                correcto = mov >= UMBRAL_PCT
            elif "VENDER" in sig:
                correcto = mov <= -UMBRAL_PCT
            else:  # MANTENER
                correcto = abs(mov) < 0.02
            pred["evaluated"] = True
            pred["outcome"] = {
                "correcto":       correcto,
                "movimiento_pct": round(mov * 100, 2),
                "precio_eval":    precio_actual,
                "ts_eval":        ahora,
            }
            recien.append(pred)
        if recien:
            redis_client.setex(key, TTL_DIAS * 86400, json.dumps(historial[-MAX_HISTORIAL:]))
        return recien
    except Exception as e:
        logger.warning(f"BT historial — error evaluando {symbol}: {e}")
        return []


def obtener_track_record(symbol: str) -> dict:
    """Track record de BT para un símbolo concreto."""
    if not redis_client:
        return {}
    try:
        raw = redis_client.get(f"bt:historial:{symbol}")
        if not raw:
            return {}
        historial = json.loads(raw)
        evaluadas = [p for p in historial if p["evaluated"]]
        if not evaluadas:
            return {"evaluadas": 0}
        correctas = sum(1 for p in evaluadas if p["outcome"]["correcto"])
        recientes = sorted(evaluadas, key=lambda x: x["timestamp"], reverse=True)[:5]
        return {
            "evaluadas":    len(evaluadas),
            "correctas":    correctas,
            "tasa_acierto": round(correctas / len(evaluadas) * 100, 1),
            "recientes": [
                {
                    "signal":         p["signal"],
                    "precio_entrada": p["price_at_rec"],
                    "movimiento_pct": p["outcome"]["movimiento_pct"],
                    "correcto":       p["outcome"]["correcto"],
                    "horas_atras":    round((time.time() - p["timestamp"]) / 3600, 1),
                }
                for p in recientes
            ],
        }
    except Exception as e:
        logger.warning(f"BT track record {symbol}: {e}")
        return {}


def obtener_track_record_global() -> dict:
    """Track record agregado de BT sobre todos los símbolos."""
    if not redis_client:
        return {}
    try:
        keys = redis_client.keys("bt:historial:*")
        total, correctas = 0, 0
        for key in keys:
            raw = redis_client.get(key)
            if not raw:
                continue
            evaluadas  = [p for p in json.loads(raw) if p["evaluated"]]
            total     += len(evaluadas)
            correctas += sum(1 for p in evaluadas if p["outcome"]["correcto"])
        if total == 0:
            return {"evaluadas": 0}
        return {
            "evaluadas":    total,
            "correctas":    correctas,
            "tasa_acierto": round(correctas / total * 100, 1),
        }
    except Exception as e:
        logger.warning(f"BT track record global: {e}")
        return {}
