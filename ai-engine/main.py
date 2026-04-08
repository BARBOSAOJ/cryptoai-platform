"""
main.py — Punto de entrada del AI Engine.
Solo inicializa FastAPI, registra routers y lanza tareas de fondo.
"""
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─── Rutas ────────────────────────────────────────────────────────────────────
from app.rutas.mercado      import router as router_mercado
from app.rutas.noticias     import router as router_noticias
from app.rutas.modelos_rutas import router as router_modelos
from app.rutas.riesgo       import router as router_riesgo
from app.rutas.sistema      import router as router_sistema

# ─── Tareas de fondo ─────────────────────────────────────────────────────────
from app.analisis          import _precalentar_cache
from app.calibracion       import _ciclo_calibracion_online
from app.reentrenamiento   import _ciclo_reentrenamiento_automatico
from app.config            import WARM_SYMBOLS

import asyncio

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Crypto AI Engine", version="4.0.0")

_allowed_origins = os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(router_mercado)
app.include_router(router_noticias)
app.include_router(router_modelos)
app.include_router(router_riesgo)
app.include_router(router_sistema)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_precalentar_cache(WARM_SYMBOLS))
    asyncio.create_task(_ciclo_reentrenamiento_automatico())
    asyncio.create_task(_ciclo_calibracion_online())


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
