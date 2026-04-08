"""rutas/sistema.py — /health, /quote"""
import json
import requests
from fastapi import APIRouter, HTTPException
from app.config import logger, CRYPTO_PANIC_KEY, NEWS_CACHE, redis_client
from app.monitor import monitor_fallos
from app.reentrenamiento import gestor_reentrenamiento
import app.modelos as modelos

router = APIRouter()


@router.get("/health")
async def health():
    estado_retrain = gestor_reentrenamiento.estado_actual()
    fallos         = monitor_fallos.estado()
    degradado      = monitor_fallos.degradado()
    redis_ok       = False
    if redis_client:
        try:
            redis_client.ping()
            redis_ok = True
            monitor_fallos.limpiar("redis")
        except Exception as e:
            monitor_fallos.registrar("redis", f"ping: {e}")
    return {
        "status":          "degradado" if degradado else "ok",
        "redis":           redis_ok,
        "lstm":            modelos.lstm_model is not None,
        "finbert":         modelos.sentiment_model is not None,
        "news_api":        bool(CRYPTO_PANIC_KEY),
        "news_cache":      len(NEWS_CACHE),
        "models_ready":    modelos.lstm_model is not None or modelos.sentiment_model is not None,
        "reentrenamiento": estado_retrain,
        "fallos":          fallos,
        "degradado":       degradado,
    }


@router.get("/quote/{symbol}")
async def quote_activo(symbol: str):
    sym       = symbol.strip().upper()
    cache_key = f"quote:{sym}"
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass
    try:
        url  = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=2d"
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
        resp.raise_for_status()
        data = resp.json()
        result_node = data.get("chart", {}).get("result", [])
        if not result_node:
            raise HTTPException(status_code=404, detail=f"Símbolo '{sym}' no encontrado")
        meta     = result_node[0].get("meta", {})
        price    = meta.get("regularMarketPrice") or meta.get("previousClose", 0)
        prev     = meta.get("chartPreviousClose") or meta.get("previousClose", price)
        change   = ((price - prev) / prev * 100) if prev and prev != 0 else 0
        result   = {
            "symbol": sym, "name": meta.get("longName") or meta.get("shortName") or sym,
            "price": round(price, 4), "change": round(change, 2),
            "currency": meta.get("currency", "USD"),
            "type": meta.get("instrumentType", "EQUITY"), "source": "yahoo"
        }
        if redis_client:
            try: redis_client.setex(cache_key, 60, json.dumps(result))
            except Exception: pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultando Yahoo Finance: {e}")
