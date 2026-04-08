"""rutas/riesgo.py — /risk/{symbol}, /backtest/{symbol}"""
import json
import requests
from fastapi import APIRouter, HTTPException
from app.config import logger, _has_ml, BINANCE_KLINES, redis_client
from app.indicadores import IndicadoresTecnicos
from app.regimen import DetectorRegimen
from app.calibracion import motor_backtest

router = APIRouter()


@router.get("/risk/{symbol}")
async def calcular_riesgo(symbol: str, price: float = 0.0, saldo: float = 1000.0):
    symbol = symbol.upper().strip()
    if price <= 0:
        raise HTTPException(status_code=400, detail="price debe ser > 0")
    if saldo <= 0:
        raise HTTPException(status_code=400, detail="saldo debe ser > 0")
    try:
        url  = f"{BINANCE_KLINES}?symbol={symbol}&interval=1h&limit=100"
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail=f"Sin datos para {symbol}")
        rows = resp.json()
        if len(rows) < 15:
            raise HTTPException(status_code=422, detail="Datos insuficientes para calcular ATR")
        if _has_ml:
            import pandas as pd
            df = pd.DataFrame(rows, columns=[
                'ts','open','high','low','close','vol',
                'close_ts','quote_vol','trades','taker_base','taker_quote','ignore'
            ])
            df['Close']  = df['close'].astype(float)
            df['High']   = df['high'].astype(float)
            df['Low']    = df['low'].astype(float)
            df['Volume'] = df['vol'].astype(float)
            atr_val      = IndicadoresTecnicos.atr(df, window=14)
            regimen      = DetectorRegimen.detectar(df, atr_val).get("regimen", "RANGING")
        else:
            highs  = [float(r[2]) for r in rows]
            lows   = [float(r[3]) for r in rows]
            atr_val = sum(h - l for h, l in zip(highs[-14:], lows[-14:])) / 14
            regimen = "RANGING"
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Error calculando riesgo para {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if atr_val <= 0:
        atr_val = price * 0.005

    return {
        "symbol":          symbol,
        "price":           price,
        "stop_loss":       round(price - 2.0 * atr_val, 8),
        "take_profit":     round(price + 3.0 * atr_val, 8),
        "atr":             round(atr_val, 6),
        "tamano_posicion": round((saldo * 0.01) / atr_val, 6) if atr_val > 0 else 0.0,
        "importe_riesgo":  round(saldo * 0.01, 4),
        "ratio_rb":        1.5,
        "regimen":         regimen,
    }


@router.post("/backtest/{symbol}")
async def backtest_lanzar(symbol: str):
    symbol = symbol.upper().strip()
    if not motor_backtest.lanzar(symbol):
        raise HTTPException(status_code=409, detail=f"Backtest ya en curso para {symbol}")
    return {"mensaje": f"Backtest iniciado para {symbol}", "symbol": symbol}


@router.get("/backtest/{symbol}")
async def backtest_resultado(symbol: str):
    symbol = symbol.upper().strip()
    estado = motor_backtest.estado(symbol)
    if estado.get("estado") == "ejecutando":
        return {"symbol": symbol, "estado": "ejecutando"}
    if estado.get("estado") == "error":
        raise HTTPException(status_code=500, detail=estado.get("error", "Error desconocido"))
    if estado.get("estado") == "completado":
        return estado["resultado"]
    if redis_client:
        try:
            cached = redis_client.get(f"backtest:{symbol}")
            if cached:
                return json.loads(cached)
        except Exception:
            pass
    raise HTTPException(status_code=404, detail=f"Sin datos de backtest para {symbol}. Lanza POST /backtest/{symbol}")
