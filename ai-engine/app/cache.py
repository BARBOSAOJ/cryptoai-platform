"""
cache.py — Pre-calentamiento del caché de análisis al arranque del servidor.
"""
import asyncio
from app.config import logger
from app.indicadores import obtener_velas_binance
from app.analisis import realizar_analisis


async def precalentar_cache(symbols: list) -> None:
    logger.info(f"Pre-calentando caché para {symbols}...")
    for symbol in symbols:
        try:
            data = obtener_velas_binance(symbol, limit=100)
            if len(data["prices"]) >= 5:
                await realizar_analisis(symbol, data["prices"][-1], data["prices"], data["volumes"])
                logger.info(f"Pre-warm OK: {symbol}")
            await asyncio.sleep(0.3)
        except Exception as e:
            logger.debug(f"Pre-warm fallido para {symbol}: {e}")
