"""rutas/mercado.py — /analyze, /analyze-batch, /history, /candles, /multi-timeframe"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import List, Optional, Dict
import requests

from app.config import logger, BINANCE_KLINES
from app.analisis import realizar_analisis
from app.indicadores import obtener_velas_binance, confluencia_multi_timeframe_async

router = APIRouter()


class PeticionMercado(BaseModel):
    symbol: str
    price: float
    history: List[float]
    volumes: Optional[List[float]] = None

    @field_validator('symbol')
    @classmethod
    def symbol_ok(cls, v):
        v = v.strip().upper()
        if not v: raise ValueError('Símbolo vacío')
        return v

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


@router.post("/analyze")
async def analyze(request: PeticionMercado):
    return await realizar_analisis(
        request.symbol, request.price, request.history, request.volumes
    )


@router.post("/analyze-batch")
async def analyze_batch(request: PeticionLote):
    results = {}
    for symbol in request.symbols:
        symbol  = symbol.strip().upper()
        price   = request.prices.get(symbol, 1.0)
        history = (request.histories or {}).get(symbol, [])
        volumes = (request.volumes or {}).get(symbol, [])
        if price <= 0: continue
        try:
            results[symbol] = await realizar_analisis(symbol, price, history, volumes)
        except Exception as e:
            logger.warning(f"Error en batch para {symbol}: {e}")
    return results


@router.get("/history/{symbol}")
async def get_history(symbol: str, limit: int = 100, interval: str = "1m"):
    symbol = symbol.upper().strip()
    limit  = max(10, min(limit, 500))
    data   = obtener_velas_binance(symbol, limit=limit, interval=interval)
    if not data["prices"]:
        raise HTTPException(status_code=404, detail=f"Sin datos para {symbol}")
    return {"symbol": symbol, **data}


@router.get("/candles/{symbol}")
async def get_candles(symbol: str, interval: str = "1m", limit: int = 200):
    symbol = symbol.upper().strip()
    limit  = max(10, min(limit, 500))
    try:
        url  = f"{BINANCE_KLINES}?symbol={symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=8)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail=f"Sin datos para {symbol}")
        candles = [
            {"time": int(r[0]) // 1000, "open": float(r[1]),
             "high": float(r[2]), "low": float(r[3]),
             "close": float(r[4]), "volume": float(r[5])}
            for r in resp.json()
        ]
        return candles
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/multi-timeframe/{symbol}")
async def get_multi_timeframe(symbol: str):
    symbol = symbol.upper().strip()
    try:
        return await confluencia_multi_timeframe_async(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
