"""rutas/modelos_rutas.py — /retrain, /retrain/status"""
from fastapi import APIRouter, HTTPException
from app.reentrenamiento import gestor_reentrenamiento

router = APIRouter()


@router.post("/retrain")
async def retrain(simbolos: str = '', epochs: int = 5, desde_cero: bool = False):
    lista  = [s.strip().upper() for s in simbolos.split(',') if s.strip()] or None
    epochs = max(1, min(epochs, 20))
    ok     = gestor_reentrenamiento.lanzar(lista, epochs, desde_cero)
    if not ok:
        raise HTTPException(status_code=409, detail="Ya hay un reentrenamiento en curso")
    n = len(lista) if lista else "todos los pares USDT"
    return {"mensaje": "Reentrenamiento iniciado", "simbolos": lista or "todos",
            "epochs": epochs, "total": n}


@router.get("/retrain/status")
async def retrain_status():
    return gestor_reentrenamiento.estado_actual()
