"""
calibracion.py — Calibración automática del conviction score de BT.

Agrupa las predicciones evaluadas por rango de conviction y calcula la
precisión real en cada bucket. Una IA bien calibrada tiene accuracy ~= conviction.
Si conviction 80 → accuracy 80%, el sistema está perfectamente calibrado.

Contribución académica: evaluación probabilística de la señal de trading propia.
"""
import json
from app.config import logger, redis_client

BUCKETS = [
    (0,  50,  "Bajo (0-50)"),
    (50, 70,  "Moderado (50-70)"),
    (70, 85,  "Alto (70-85)"),
    (85, 101, "Muy alto (85-100)"),
]


def calcular_calibracion(symbol: str | None = None) -> list[dict]:
    """
    Calcula métricas de calibración agrupadas por bucket de conviction.
    Si symbol=None, agrega sobre todos los símbolos.
    Devuelve lista de dicts con: rango, señales, correctas, accuracy, confianza_media.
    """
    if not redis_client:
        return []
    try:
        if symbol:
            keys = [f"bt:historial:{symbol}"]
        else:
            keys = [k.decode() if isinstance(k, bytes) else k
                    for k in redis_client.keys("bt:historial:*")]

        todas: list[dict] = []
        for key in keys:
            raw = redis_client.get(key)
            if not raw:
                continue
            todas.extend(p for p in json.loads(raw) if p.get("evaluated"))

        if not todas:
            return []

        resultado = []
        for lo, hi, label in BUCKETS:
            bucket = [p for p in todas if lo <= p.get("conviction", 0) < hi]
            if not bucket:
                continue
            correctas = sum(1 for p in bucket if p["outcome"]["correcto"])
            accuracy  = round(correctas / len(bucket) * 100, 1)
            conv_media = round(sum(p["conviction"] for p in bucket) / len(bucket), 1)
            resultado.append({
                "rango":        label,
                "lo":           lo,
                "hi":           hi,
                "señales":      len(bucket),
                "correctas":    correctas,
                "accuracy":     accuracy,
                "conv_media":   conv_media,
                # Diferencia entre conviction media y accuracy real:
                # positivo = sobreconfiado, negativo = conservador
                "calibracion_error": round(conv_media - accuracy, 1),
            })

        return resultado

    except Exception as e:
        logger.warning(f"BT calibración — error: {e}")
        return []


def resumen_calibracion_texto() -> str:
    """Genera un resumen textual de la calibración para incluir en el contexto de BT."""
    buckets = calcular_calibracion()
    if not buckets:
        return ""
    lineas = ["[CALIBRACIÓN DEL SISTEMA BT]"]
    for b in buckets:
        err = b["calibracion_error"]
        estado = "bien calibrado" if abs(err) < 5 else ("sobreconfiado" if err > 0 else "conservador")
        lineas.append(
            f"  Conviction {b['rango']}: {b['accuracy']}% accuracy "
            f"en {b['señales']} señales ({estado})"
        )
    return "\n".join(lineas)


def obtener_calibracion_por_simbolo() -> dict[str, list[dict]]:
    """Devuelve calibración desglosada por símbolo. Usado por el endpoint REST."""
    if not redis_client:
        return {}
    try:
        keys = [k.decode() if isinstance(k, bytes) else k
                for k in redis_client.keys("bt:historial:*")]
        resultado = {}
        for key in keys:
            symbol = key.replace("bt:historial:", "")
            cal    = calcular_calibracion(symbol)
            if cal:
                resultado[symbol] = cal
        return resultado
    except Exception as e:
        logger.warning(f"BT calibración por símbolo: {e}")
        return {}
