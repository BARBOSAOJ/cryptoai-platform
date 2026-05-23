"""
chat.py — Router FastAPI para el chat de BT.
Delega toda la lógica de negocio en los módulos app.bt.*.
"""
import json
import asyncio
from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional

from app.config import logger
from app.bt.config   import SYSTEM_PROMPT, BT_MODEL
from app.bt.detectar import detectar_simbolos, detectar_intencion_trade
from app.bt.contexto import obtener_contexto_mercado, construir_track_record_contexto
from app.bt.ordenes  import ejecutar_orden
from app.bt.historial import obtener_track_record
from app.bt.alertas  import consumir_alerta
from app.bt.memoria  import (
    extraer_user_id, obtener_perfil, registrar_sesion,
    actualizar_perfil_desde_mensaje, obtener_turnos_sesion_anterior,
    guardar_turno, construir_contexto_memoria,
)

router = APIRouter(prefix="/chat")


class MensajeChat(BaseModel):
    mensaje: str
    historial: Optional[List[dict]] = []


@router.post("/stream")
async def chat_stream(
    body: MensajeChat,
    authorization: Optional[str] = Header(None),
):
    token   = authorization.replace("Bearer ", "").strip() if authorization else None
    user_id = extraer_user_id(token) if token else "anon"

    es_nueva_sesion = len(body.historial or []) == 0
    perfil = registrar_sesion(user_id) if es_nueva_sesion else obtener_perfil(user_id)

    simbolos = detectar_simbolos(body.mensaje)
    perfil   = actualizar_perfil_desde_mensaje(user_id, body.mensaje, simbolos)
    contexto, analisis_map = await obtener_contexto_mercado(simbolos)

    # Detectar y ejecutar intención de trade si el usuario está autenticado
    orden_resultado = None
    if token:
        intencion = detectar_intencion_trade(body.mensaje)
        if intencion:
            sym = intencion["symbol"]
            a   = analisis_map.get(sym)
            if a:
                resultado = await ejecutar_orden(
                    symbol=sym,
                    side=intencion["side"],
                    amount_usd=intencion["amount_usd"],
                    price=float(a["entry_price"]),
                    signal=a.get("signal", "MANTENER"),
                    confidence=a.get("confidence", "0%"),
                    token=token,
                )
                orden_resultado = {**intencion, "price": float(a["entry_price"]), "resultado": resultado}

    track_records = {sym: obtener_track_record(sym) for sym in analisis_map}

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    ctx_memoria = construir_contexto_memoria(user_id, perfil, es_nueva_sesion)
    if ctx_memoria:
        messages.append({"role": "system", "content": ctx_memoria})

    if es_nueva_sesion and user_id != "anon":
        for t in obtener_turnos_sesion_anterior(user_id, n=4):
            messages.append(t)

    for h in (body.historial or [])[-8:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})

    user_content = body.mensaje
    if contexto:
        user_content += f"\n\n[Datos de mercado obtenidos automáticamente:{contexto}]"

    user_content += construir_track_record_contexto(track_records)

    if orden_resultado:
        r      = orden_resultado["resultado"]
        status = r["status"]
        size   = round(orden_resultado["amount_usd"] / orden_resultado["price"], 8)
        tipo   = "Compra" if orden_resultado["side"] == "BUY" else "Venta"
        if status == 200:
            user_content += (
                f"\n\n[ORDEN EJECUTADA: {tipo} de {size} {orden_resultado['symbol']} "
                f"a ${orden_resultado['price']} — Total: ${orden_resultado['amount_usd']:.2f}]"
            )
        elif status == 402:
            user_content += "\n\n[ERROR EN ORDEN: Saldo insuficiente en la cartera virtual]"
        else:
            err = r["data"].get("error", "Error desconocido")
            user_content += f"\n\n[ERROR EN ORDEN: {err}]"

    messages.append({"role": "user", "content": user_content})
    guardar_turno(user_id, "user", body.mensaje)

    async def generate():
        respuesta_completa = []
        try:
            import ollama
            stream = ollama.chat(
                model=BT_MODEL,
                messages=messages,
                stream=True,
                options={"temperature": 0.35, "num_predict": 512},
            )
            for chunk in stream:
                content = chunk['message']['content']
                if content:
                    respuesta_completa.append(content)
                    yield f"data: {json.dumps({'content': content})}\n\n"
        except ImportError:
            yield f"data: {json.dumps({'content': 'Error: pip install ollama'})}\n\n"
        except Exception as e:
            logger.error(f"Error en chat stream: {e}")
            yield f"data: {json.dumps({'content': 'Error conectando con Ollama. ¿Está ejecutándose? Prueba: ollama serve'})}\n\n"
        finally:
            if respuesta_completa:
                guardar_turno(user_id, "assistant", "".join(respuesta_completa))
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/alertas")
async def stream_alertas(token: Optional[str] = Query(None)):
    """SSE: el cliente se suscribe y recibe alertas proactivas de BT en tiempo real."""
    user_id = extraer_user_id(token) if token else "anon"

    async def generate():
        while True:
            alerta = consumir_alerta(user_id)
            if alerta:
                yield f"data: {json.dumps(alerta)}\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(4)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
