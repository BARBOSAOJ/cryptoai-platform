"""
reddit.py — Sentimiento de Reddit vía API pública (sin autenticación).
Reutiliza FinBERT de app.sentimiento para puntuar los títulos.
Caché de 5 min por símbolo.
"""
import time
import requests
from app.config import logger

_CACHE: dict = {}
_TTL = 300  # 5 min

# Subreddits más relevantes por símbolo
_SUBS = {
    "BTCUSDT":  ["Bitcoin", "CryptoCurrency"],
    "ETHUSDT":  ["ethereum", "CryptoCurrency"],
    "SOLUSDT":  ["solana", "CryptoCurrency"],
    "DOGEUSDT": ["dogecoin", "CryptoCurrency"],
    "XRPUSDT":  ["Ripple", "CryptoCurrency"],
    "BNBUSDT":  ["binance", "CryptoCurrency"],
    "ADAUSDT":  ["cardano", "CryptoCurrency"],
    "AVAXUSDT": ["Avax", "CryptoCurrency"],
}
_DEFAULT_SUBS = ["CryptoCurrency"]

# Palabras clave por símbolo para filtrar posts relevantes
_KEYWORDS = {
    "BTCUSDT":  ["bitcoin", "btc"],
    "ETHUSDT":  ["ethereum", "eth", "ether"],
    "SOLUSDT":  ["solana", "sol"],
    "DOGEUSDT": ["dogecoin", "doge"],
    "XRPUSDT":  ["xrp", "ripple"],
    "BNBUSDT":  ["bnb", "binance"],
    "ADAUSDT":  ["cardano", "ada"],
    "AVAXUSDT": ["avalanche", "avax"],
}


def _fetch_posts(subreddit: str, limit: int = 30) -> list:
    """Devuelve lista de (title, source) desde el hot del subreddit."""
    try:
        r = requests.get(
            f"https://www.reddit.com/r/{subreddit}/hot.json",
            params={"limit": limit},
            headers={"User-Agent": "crypto-ai-platform/1.0 (TFG research)"},
            timeout=6,
        )
        if r.status_code != 200:
            return []
        posts = r.json()["data"]["children"]
        return [
            (p["data"]["title"], f"reddit/r/{subreddit}")
            for p in posts
            if not p["data"].get("stickied")
        ]
    except Exception as e:
        logger.warning(f"Reddit r/{subreddit} no disponible: {e}")
        return []


def obtener_sentimiento_reddit(symbol: str) -> dict:
    """
    Devuelve {'sentimiento': -1..+1, 'posts_analizados': int,
              'clasificacion': str, 'detalle': list}
    """
    now = time.time()
    if symbol in _CACHE and now - _CACHE[symbol]["ts"] < _TTL:
        return _CACHE[symbol]["data"]

    subs = _SUBS.get(symbol, _DEFAULT_SUBS)
    keywords = _KEYWORDS.get(symbol, [symbol.replace("USDT", "").lower()])

    # Recopilar posts de todos los subreddits relevantes
    todos = []
    for sub in subs:
        todos.extend(_fetch_posts(sub, 30))

    # Filtrar por relevancia al símbolo en r/CryptoCurrency (ruido alto)
    def es_relevante(titulo: str, fuente: str) -> bool:
        if "CryptoCurrency" not in fuente:
            return True  # sub específico → siempre relevante
        tl = titulo.lower()
        return any(kw in tl for kw in keywords)

    filtrados = [(t, s) for t, s in todos if es_relevante(t, s)]

    if not filtrados:
        return {"sentimiento": 0.0, "posts_analizados": 0,
                "clasificacion": "sin datos", "detalle": []}

    # Análisis FinBERT (reutiliza el modelo ya cargado)
    try:
        from app.sentimiento import analizar_titulares
        detalle, promedio = analizar_titulares(filtrados[:25])
    except Exception as e:
        logger.warning(f"FinBERT Reddit error: {e}")
        detalle, promedio = [], 0.0

    clasificacion = (
        "muy positivo"  if promedio >  0.30 else
        "positivo"      if promedio >  0.08 else
        "muy negativo"  if promedio < -0.30 else
        "negativo"      if promedio < -0.08 else
        "neutral"
    )

    result = {
        "sentimiento":      round(float(promedio), 3),
        "posts_analizados": len(filtrados),
        "clasificacion":    clasificacion,
        "detalle":          detalle[:5],  # top 5 para el contexto de Gemma
    }
    _CACHE[symbol] = {"ts": now, "data": result}
    return result
