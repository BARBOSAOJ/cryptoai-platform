"""
main.py — Punto de entrada del AI Engine.
Inicializa FastAPI, registra routers y lanza tareas de fondo.
"""
import os
import asyncio
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─── Routers ──────────────────────────────────────────────────────────────────
from app.rutas.mercado       import router as router_mercado
from app.rutas.noticias      import router as router_noticias
from app.rutas.modelos_rutas import router as router_modelos
from app.rutas.riesgo        import router as router_riesgo
from app.rutas.sistema       import router as router_sistema
from app.rutas.chat          import router as router_chat

# ─── Tareas de fondo ──────────────────────────────────────────────────────────
from app.cache              import precalentar_cache
from app.calibracion        import _ciclo_calibracion_online, motor_backtest
from app.reentrenamiento    import _ciclo_reentrenamiento_automatico
from app.config             import WARM_SYMBOLS, redis_client, logger
from app.bt.historial       import evaluar_predicciones
from app.bt.alertas         import evaluar_y_publicar, obtener_usuarios_activos


async def _ciclo_alertas_bt():
    """Cada 5 min analiza el mercado y genera alertas proactivas para usuarios activos."""
    from app.analisis import realizar_analisis
    from app.indicadores import obtener_velas_binance
    await asyncio.sleep(60)
    while True:
        user_ids = obtener_usuarios_activos()
        if user_ids:
            for symbol in WARM_SYMBOLS:
                try:
                    data = obtener_velas_binance(symbol, limit=100)
                    if len(data["prices"]) >= 5:
                        analisis = await realizar_analisis(
                            symbol, data["prices"][-1],
                            data["prices"], data["volumes"]
                        )
                        evaluar_y_publicar(symbol, analisis, user_ids)
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.debug(f"Alertas BT {symbol}: {e}")
        await asyncio.sleep(300)


async def _ciclo_evaluacion_bt():
    """Cada 30 min compara las predicciones pendientes de BT con el precio real."""
    from app.indicadores import obtener_velas_binance
    await asyncio.sleep(300)
    while True:
        for symbol in WARM_SYMBOLS:
            try:
                data = obtener_velas_binance(symbol, limit=5)
                if data["prices"]:
                    evaluadas = evaluar_predicciones(symbol, data["prices"][-1])
                    if evaluadas:
                        aciertos = sum(1 for p in evaluadas if p["outcome"]["correcto"])
                        logger.info(f"BT evaluó {len(evaluadas)} predicciones de {symbol} "
                                    f"— {aciertos}/{len(evaluadas)} correctas")
            except Exception as e:
                logger.debug(f"BT evaluación {symbol}: {e}")
        await asyncio.sleep(1800)


async def _lanzar_backtests_iniciales():
    """Lanza el backtest histórico para símbolos sin calibración en Redis."""
    await asyncio.sleep(15)
    for symbol in WARM_SYMBOLS:
        if redis_client and redis_client.exists(f"calibration:{symbol}"):
            continue
        motor_backtest.lanzar(symbol)
        await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(precalentar_cache(WARM_SYMBOLS))
    asyncio.create_task(_ciclo_reentrenamiento_automatico())
    asyncio.create_task(_ciclo_calibracion_online())
    asyncio.create_task(_lanzar_backtests_iniciales())
    asyncio.create_task(_ciclo_evaluacion_bt())
    asyncio.create_task(_ciclo_alertas_bt())
    yield


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Crypto AI Engine", version="4.0.0", lifespan=lifespan)

_allowed_origins = os.getenv('CORS_ORIGINS', '*').split(',')
_origin_list = [o.strip() for o in _allowed_origins]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router_mercado)
app.include_router(router_noticias)
app.include_router(router_modelos)
app.include_router(router_riesgo)
app.include_router(router_sistema)
app.include_router(router_chat)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
