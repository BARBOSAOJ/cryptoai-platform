"""
rag.py — Retrieval-Augmented Generation con memoria de mercado para BT.

Cada análisis emitido se almacena como un vector de indicadores normalizados.
Cuando BT analiza una nueva situación, recupera las K más similares del pasado
(por similitud coseno) junto con sus resultados reales. Esto permite al sistema
contextualizar sus recomendaciones con experiencia propia acumulada.

Contribución académica: adaptive market memory via RAG sobre señales propias.
"""
import json
import math
import time
import uuid
from app.config import logger, redis_client

MAX_ENTRADAS = 500   # entradas máximas por símbolo en el índice
TTL_DIAS     = 30    # días de retención
TOP_K        = 3     # situaciones similares a recuperar


# ─── Extracción y normalización de features ───────────────────────────────────

def _extraer_features(analisis: dict) -> list[float]:
    """
    Convierte un análisis de mercado en un vector normalizado de 7 dimensiones:
    [rsi, macd_norm, adx, bb_pos, stoch_rsi, fear_greed, conviction]
    Todos los valores en [0, 1].
    """
    ind  = analisis.get("indicators", {})
    fg   = analisis.get("fear_greed", {})

    def safe(v, default=0.5):
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    rsi       = safe(ind.get("rsi"),       50.0) / 100.0
    # MACD histogram: normalización sigmoide para manejar valores negativos
    macd_raw  = safe(ind.get("macd_histogram"), 0.0)
    macd      = 1.0 / (1.0 + math.exp(-macd_raw * 10))
    adx       = min(safe(ind.get("adx"), 20.0), 100.0) / 100.0
    bb_pos    = safe(ind.get("bb_position"), 0.5)
    stoch     = safe(ind.get("stoch_rsi"),   0.5)
    fg_val    = safe(fg.get("valor"),        50.0) / 100.0
    conviction = safe(analisis.get("conviction_score"), 50.0) / 100.0

    return [rsi, macd, adx, bb_pos, stoch, fg_val, conviction]


def _coseno(a: list[float], b: list[float]) -> float:
    dot  = sum(x * y for x, y in zip(a, b))
    na   = math.sqrt(sum(x * x for x in a))
    nb   = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


# ─── Almacenamiento ───────────────────────────────────────────────────────────

def guardar_en_rag(symbol: str, analisis: dict) -> None:
    """
    Almacena el análisis actual en el índice RAG del símbolo.
    El campo 'outcome' se rellena más tarde por evaluar_predicciones().
    """
    if not redis_client:
        return
    try:
        features = _extraer_features(analisis)
        entrada = {
            "id":         str(uuid.uuid4())[:8],
            "ts":         time.time(),
            "signal":     analisis.get("signal", ""),
            "conviction": analisis.get("conviction_score", 0),
            "price":      float(analisis.get("entry_price", 0)),
            "features":   features,
            "outcome":    None,   # se actualiza en actualizar_outcome_rag()
        }
        key = f"bt:rag:{symbol}"
        raw = redis_client.get(key)
        indice = json.loads(raw) if raw else []
        indice.append(entrada)
        redis_client.setex(key, TTL_DIAS * 86400, json.dumps(indice[-MAX_ENTRADAS:]))
    except Exception as e:
        logger.warning(f"BT RAG — error guardando {symbol}: {e}")


def actualizar_outcome_rag(symbol: str, precio_actual: float) -> None:
    """
    Rellena el outcome de entradas cuyo horizonte (4h) ya venció.
    Llamado desde evaluar_predicciones() cuando llega un nuevo precio.
    """
    if not redis_client:
        return
    HORIZONTE = 4 * 3600
    UMBRAL    = 0.005
    try:
        key = f"bt:rag:{symbol}"
        raw = redis_client.get(key)
        if not raw:
            return
        indice   = json.loads(raw)
        ahora    = time.time()
        modified = False
        for entrada in indice:
            if entrada.get("outcome") is not None:
                continue
            if ahora - entrada["ts"] < HORIZONTE:
                continue
            mov = (precio_actual - entrada["price"]) / (entrada["price"] + 1e-9)
            sig = entrada["signal"]
            if "COMPRAR" in sig:
                correcto = mov >= UMBRAL
            elif "VENDER" in sig:
                correcto = mov <= -UMBRAL
            else:
                correcto = abs(mov) < 0.02
            entrada["outcome"] = {"correcto": correcto, "mov_pct": round(mov * 100, 2)}
            modified = True
        if modified:
            redis_client.setex(key, TTL_DIAS * 86400, json.dumps(indice))
    except Exception as e:
        logger.warning(f"BT RAG — error actualizando outcomes {symbol}: {e}")


# ─── Recuperación ─────────────────────────────────────────────────────────────

def buscar_similares(analisis_actual: dict, symbol: str, top_k: int = TOP_K) -> list[dict]:
    """
    Recupera las TOP_K situaciones más similares del índice RAG para el símbolo.
    Solo devuelve entradas con outcome conocido (evaluadas).
    """
    if not redis_client:
        return []
    try:
        key = f"bt:rag:{symbol}"
        raw = redis_client.get(key)
        if not raw:
            return []
        indice   = json.loads(raw)
        con_out  = [e for e in indice if e.get("outcome") is not None]
        if not con_out:
            return []
        query    = _extraer_features(analisis_actual)
        scored   = [(e, _coseno(query, e["features"])) for e in con_out]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [e for e, _ in scored[:top_k]]
    except Exception as e:
        logger.warning(f"BT RAG — error buscando similares {symbol}: {e}")
        return []


def construir_contexto_rag(similares: list[dict], symbol: str) -> str:
    """Genera el bloque de texto con situaciones pasadas similares para el LLM."""
    if not similares:
        return ""
    coin = symbol.replace("USDT", "")
    lineas = [f"[MEMORIA DE MERCADO — {coin}: situaciones pasadas similares a la actual]"]
    for s in similares:
        out    = s["outcome"]
        signo  = "✓" if out["correcto"] else "✗"
        hace_h = round((time.time() - s["ts"]) / 3600, 1)
        lineas.append(
            f"  {signo} Hace {hace_h}h emití {s['signal']} (conviction {s['conviction']}) "
            f"a ${s['price']} → resultado: {out['mov_pct']:+.2f}%"
        )
    aciertos = sum(1 for s in similares if s["outcome"]["correcto"])
    lineas.append(f"  Tasa de acierto en situaciones análogas: {aciertos}/{len(similares)}")
    return "\n".join(lineas)
