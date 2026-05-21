"""
ordenes.py — Ejecución de órdenes de trading vía market-service.
"""
import httpx
from app.config import logger

MARKET_SERVICE_URL = "http://localhost:8081"


async def ejecutar_orden(symbol: str, side: str, amount_usd: float, price: float,
                         signal: str, confidence: str, token: str) -> dict:
    size = round(amount_usd / price, 8)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{MARKET_SERVICE_URL}/portfolio/execute",
                json={
                    "symbol":     symbol,
                    "size":       size,
                    "price":      price,
                    "type":       side,
                    "signal":     signal,
                    "confidence": confidence,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        return {"status": resp.status_code, "data": resp.json()}
    except Exception as e:
        logger.error(f"Error ejecutando orden {side} {symbol}: {e}")
        return {"status": 500, "data": {"error": str(e)}}
