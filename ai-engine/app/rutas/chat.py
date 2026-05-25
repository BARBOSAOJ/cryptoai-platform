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
from app.bt.config   import BT_MODEL
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
from app.bt.cartera import (
    obtener_estado_cartera, calcular_riesgo, construir_contexto_cartera,
)
from app.bt.calibracion import calcular_calibracion, obtener_calibracion_por_simbolo
from app.bt.historial import obtener_track_record_global

router = APIRouter(prefix="/chat")

# ── Domain guardrail ──────────────────────────────────────────────────────────
_FINANCE_KEYWORDS = {
    "btc", "eth", "sol", "bnb", "xrp", "ada", "dot", "link", "matic", "avax",
    "doge", "shib", "pepe", "trump",
    "bitcoin", "ethereum", "solana", "crypto", "token", "defi", "nft", "blockchain",
    "binance", "coinbase", "altcoin", "staking", "wallet",
    "mercado", "precio", "señal", "compra", "vende", "vendo", "invierto", "invert",
    "cartera", "portfolio", "posición", "posiciones", "saldo", "exposición",
    "rsi", "macd", "indicador", "análisis", "trading", "trader", "stop", "entrada",
    "kelly", "riesgo", "conviction", "soporte", "resistencia", "tendencia",
    "inflación", "fed", "tipos", "dólar", "euro", "oro", "bolsa", "nasdaq",
    "fear", "greed", "sentimiento", "bull", "bear", "corrección", "rebote",
    "largo", "corto", "breakout", "volumen", "liquidez", "apalancamiento",
    "patrimonio", "ganancia", "pérdida", "p&l", "rentabilidad",
}
_OFFTOPIC_KEYWORDS = {
    "receta", "cocinar", "cocina", "pasta", "arroz", "pollo", "cena", "almuerzo",
    "fútbol", "baloncesto", "tenis", "partido", "gol", "deporte", "liga",
    "película", "serie", "netflix", "canción", "música", "artista", "concierto",
    "tiempo", "lluvia", "temperatura", "clima", "meteorología",
    "política", "elecciones", "presidente", "gobierno", "ministro",
    "chiste", "broma", "historia corta", "cuéntame un",
    "amor", "novia", "novio", "relación", "pareja", "citas",
    "medicina", "síntoma", "enfermedad", "doctor", "pastilla",
    "traducción", "traduce al", "en inglés", "en francés",
    "poema", "redacción", "ensayo literario",
}


def _es_consulta_financiera(mensaje: str) -> bool:
    lower = mensaje.lower()
    if any(k in lower for k in _FINANCE_KEYWORDS):
        return True
    if any(k in lower for k in _OFFTOPIC_KEYWORDS):
        return False
    return True  # benefit of the doubt (saludos, preguntas ambiguas, etc.)


class MensajeChat(BaseModel):
    mensaje: str
    historial: Optional[List[dict]] = []


@router.post("/stream")
async def chat_stream(
    body: MensajeChat,
    authorization: Optional[str] = Header(None),
):
    # Solo operaciones rápidas en el handler — el preprocessing pesado va dentro
    # del generator para que el cliente reciba el HTTP 200 en milisegundos.
    token   = authorization.replace("Bearer ", "").strip() if authorization else None
    user_id = extraer_user_id(token) if token else "anon"

    es_nueva_sesion = not body.historial
    perfil   = registrar_sesion(user_id) if es_nueva_sesion else obtener_perfil(user_id)
    simbolos = detectar_simbolos(body.mensaje)
    perfil   = actualizar_perfil_desde_mensaje(user_id, body.mensaje, simbolos)

    _PALABRAS_CARTERA = {
        "cartera", "portfolio", "posición", "posiciones", "saldo", "libre",
        "exposición", "perdida", "ganancia", "p&l", "patrimonio", "btc", "eth",
        "compra", "vende", "operar", "invierto", "kelly", "riesgo",
    }
    _PALABRAS_PANICO = {
        "crash", "se hunde", "hundiendo", "pánico", "todo baja", "vendo todo",
        "salgo", "catástrofe", "colapso", "desplome", "urgente", "ayuda",
    }
    _PALABRAS_FOMO = {
        "cohete", "despegar", "ath", "todo sube", "perdiendo el tren",
        "ya subió", "compro ahora", "entro ya", "antes que siga subiendo",
    }
    _msg_lower = body.mensaje.lower()
    necesita_cartera = bool(simbolos) or any(p in _msg_lower for p in _PALABRAS_CARTERA)

    if any(p in _msg_lower for p in _PALABRAS_PANICO):
        estado_emocional = "[ESTADO DEL USUARIO: posible pánico. Responde primero con calma y datos fríos antes del análisis.]"
    elif any(p in _msg_lower for p in _PALABRAS_FOMO):
        estado_emocional = "[ESTADO DEL USUARIO: posible FOMO. Evalúa si la relación riesgo/recompensa sigue siendo válida y dilo con datos.]"
    else:
        estado_emocional = ""

    async def generate():
        respuesta_completa: list[str] = []
        try:
            import ollama

            # ── Ping inmediato — cliente sabe que BT está activo ──────────────
            yield f"data: {json.dumps({'ping': True})}\n\n"

            # ── Guardrail de dominio ──────────────────────────────────────────
            if not _es_consulta_financiera(body.mensaje):
                respuesta = "Eso no es mi departamento. ¿Qué quieres revisar en el mercado hoy?"
                yield f"data: {json.dumps({'content': respuesta})}\n\n"
                guardar_turno(user_id, "user", body.mensaje)
                guardar_turno(user_id, "assistant", respuesta)
                yield "data: [DONE]\n\n"
                return

            # ── Preprocessing en paralelo (dentro del stream) ─────────────────
            if necesita_cartera and token:
                (contexto, analisis_map), (datos_cartera, datos_stats) = await asyncio.gather(
                    obtener_contexto_mercado(simbolos),
                    obtener_estado_cartera(token),
                )
                riesgo      = calcular_riesgo(datos_cartera, datos_stats, perfil.get("riesgo"))
                ctx_cartera = construir_contexto_cartera(datos_cartera, datos_stats, riesgo)
            else:
                contexto, analisis_map = await obtener_contexto_mercado(simbolos)
                datos_cartera = datos_stats = {}
                riesgo = {}
                ctx_cartera = ""

            # ── Orden de trading si se detecta intención ──────────────────────
            orden_resultado = None
            if token:
                intencion = detectar_intencion_trade(body.mensaje)
                if intencion:
                    if not intencion.get("amount_usd") and riesgo.get("max_posicion", 0) > 0:
                        intencion["amount_usd"] = riesgo["max_posicion"]
                    sym = intencion["symbol"]
                    a   = analisis_map.get(sym)
                    if a:
                        resultado = await ejecutar_orden(
                            symbol=sym, side=intencion["side"],
                            amount_usd=intencion["amount_usd"],
                            price=float(a["entry_price"]),
                            signal=a.get("signal", "MANTENER"),
                            confidence=a.get("confidence", "0%"),
                            token=token,
                        )
                        orden_resultado = {**intencion, "price": float(a["entry_price"]), "resultado": resultado}

            # ── Cabecera determinista (cuando hay datos de mercado) ───────────
            # Las líneas de símbolo·precio·señal·conviction se construyen
            # directamente desde el análisis para garantizar formato consistente.
            # El LLM solo añade la lectura y la acción concreta.
            track_records = {sym: obtener_track_record(sym) for sym in analisis_map}
            header_lines: list[str] = []
            if analisis_map:
                for sym in list(analisis_map.keys())[:3]:
                    a   = analisis_map[sym]
                    ind = a.get("indicators", {})
                    rsi = ind.get("rsi")
                    rsi_str = f" · RSI {rsi:.1f}" if rsi is not None else ""
                    header_lines.append(
                        f"{sym} ${float(a['entry_price']):,.2f} · {a['signal']} · "
                        f"Conviction {a['conviction_score']}/100{rsi_str}"
                    )
                # F&G del primer símbolo disponible
                first_a = next(iter(analisis_map.values()))
                fg = first_a.get("fear_greed", {})
                fg_val = fg.get("valor")
                if fg_val is not None:
                    header_lines.append(f"F&G {int(fg_val)}/100 ({fg.get('clasificacion', '')})")

                header_text = "\n".join(header_lines)
                respuesta_completa.append(header_text + "\n")
                yield f"data: {json.dumps({'content': header_text + chr(10)})}\n\n"

            # ── Construcción de mensajes para el LLM ──────────────────────────
            messages = [{"role": "system", "content": (
                "Sin markdown. Sin bullets. Sin saludos. Responde en español. "
                + ("Añade UNA línea: tu lectura del mercado y el nivel o acción concreta a vigilar."
                   if analisis_map else
                   "Para saludos o preguntas generales: responde en una sola línea, directo.")
            )}]

            ctx_memoria = construir_contexto_memoria(user_id, perfil, es_nueva_sesion)
            if ctx_memoria:
                messages.append({"role": "system", "content": ctx_memoria})
            if ctx_cartera:
                messages.append({"role": "system", "content": ctx_cartera})
            if estado_emocional:
                messages.append({"role": "system", "content": estado_emocional})

            if es_nueva_sesion and user_id != "anon":
                for t in obtener_turnos_sesion_anterior(user_id, n=4):
                    messages.append(t)

            for h in (body.historial or [])[-8:]:
                if h.get("role") in ("user", "assistant") and h.get("content"):
                    messages.append({"role": h["role"], "content": h["content"]})

            user_content = body.mensaje
            if contexto:
                user_content += f"\n\n[Datos de mercado:{contexto}]"
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
                    user_content += "\n\n[ERROR EN ORDEN: Saldo insuficiente]"
                else:
                    user_content += f"\n\n[ERROR EN ORDEN: {r['data'].get('error', 'Error desconocido')}]"

            messages.append({"role": "user", "content": user_content})
            guardar_turno(user_id, "user", body.mensaje)

            # ── Stream LLM (solo comentario/análisis, cabecera ya enviada) ────
            stream = await ollama.AsyncClient().chat(
                model=BT_MODEL,
                messages=messages,
                stream=True,
                options={"temperature": 0.35, "num_predict": 120, "num_ctx": 2048, "stop": ["\n\n\n"]},
            )
            async for chunk in stream:
                content = chunk["message"]["content"]
                if content:
                    respuesta_completa.append(content)
                    yield f"data: {json.dumps({'content': content})}\n\n"

        except ImportError:
            yield f"data: {json.dumps({'content': 'Error: pip install ollama'})}\n\n"
        except Exception as e:
            logger.error(f"Error en chat stream: {e}")
            yield f"data: {json.dumps({'content': 'Error conectando con Ollama. ¿Está ejecutándose?'})}\n\n"
        finally:
            if respuesta_completa:
                guardar_turno(user_id, "assistant", "".join(respuesta_completa))
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/inicio")
async def chat_inicio(authorization: Optional[str] = Header(None)):
    """Briefing proactivo de apertura — saludo personalizado + estado del mercado, sin LLM."""
    token   = authorization.replace("Bearer ", "").strip() if authorization else None
    user_id = extraer_user_id(token) if token else "anon"

    async def generate():
        try:
            yield f"data: {json.dumps({'ping': True})}\n\n"

            perfil = obtener_perfil(user_id)
            nombre = (perfil.get("nombre", "") or "").strip() if perfil else ""
            saludo_nombre = f", {nombre}" if nombre else ""

            _, analisis_map = await obtener_contexto_mercado(["BTCUSDT", "ETHUSDT", "SOLUSDT"])

            lineas_datos: list[str] = []
            señales: list[str]      = []
            convictions: list[int]  = []

            for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
                a = analisis_map.get(sym)
                if not a:
                    continue
                ind     = a.get("indicators", {})
                rsi     = ind.get("rsi")
                rsi_str = f" · RSI {rsi:.0f}" if rsi is not None else ""
                lineas_datos.append(
                    f"{sym} ${float(a['entry_price']):,.2f} · {a['signal']} · "
                    f"Conviction {a['conviction_score']}/100{rsi_str}"
                )
                señales.append(a["signal"])
                convictions.append(int(a["conviction_score"]))

            # Fear & Greed
            btc    = analisis_map.get("BTCUSDT")
            fg_val = btc.get("fear_greed", {}).get("valor")        if btc else None
            fg_cls = btc.get("fear_greed", {}).get("clasificacion", "") if btc else ""
            fg_nota = ""
            if fg_val is not None:
                fg_int = int(fg_val)
                if fg_int <= 25:
                    fg_nota = f" F&G {fg_int}/100 — zona de capitulación."
                elif fg_int >= 75:
                    fg_nota = f" F&G {fg_int}/100 — euforia, riesgo de reversión."
                else:
                    fg_nota = f" F&G {fg_int}/100 ({fg_cls})."

            # Tono general del mercado
            avg_conv    = sum(convictions) / len(convictions) if convictions else 50
            buy_count   = sum(1 for s in señales if "COMPRAR" in s or "COMPRA" in s)
            sell_count  = sum(1 for s in señales if "VENDER" in s or "VENTA" in s)
            max_buy_conv = max(
                (c for s, c in zip(señales, convictions) if "COMPRAR" in s or "COMPRA" in s),
                default=0,
            )

            if buy_count >= 2 and avg_conv >= 60:
                tono_intro = "mercado abierto para invertir"
                conclusion = f"{buy_count} de {len(señales)} activos con señal de compra y conviction sólida. Momento operativo."
            elif sell_count >= 2:
                tono_intro = "mercado bajo presión"
                conclusion = "Señales bajistas dominantes. Evita entradas largas hasta confirmación."
            elif buy_count >= 1 and max_buy_conv >= 60:
                tono_intro = "oportunidades selectivas"
                conclusion = "Hay setup en activos concretos. Revisa los que muestran COMPRAR antes de entrar."
            elif sell_count == 0 and avg_conv >= 50:
                tono_intro = "mercado en espera"
                conclusion = "Sin señal clara aún. Espera confirmación de volumen o ruptura de nivel."
            else:
                tono_intro = "mercado sin dirección"
                conclusion = "Sin setup operativo. Mantén posiciones o reduce exposición."

            intro    = f"Buenas{saludo_nombre}. {tono_intro.capitalize()} —{fg_nota}"
            briefing = "\n".join([intro] + lineas_datos + [conclusion])

            yield f"data: {json.dumps({'content': briefing})}\n\n"

            if user_id != "anon":
                guardar_turno(user_id, "assistant", briefing)

        except Exception as e:
            logger.error(f"Error en chat inicio: {e}")
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/rendimiento")
async def rendimiento_bt():
    """
    Devuelve el rendimiento completo de BT: track record global, calibración
    por bucket de conviction y desglose por símbolo.
    """
    global_tr  = obtener_track_record_global()
    calibracion = calcular_calibracion()
    por_simbolo = obtener_calibracion_por_simbolo()
    return {
        "track_record_global": global_tr,
        "calibracion":         calibracion,
        "por_simbolo":         por_simbolo,
    }


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
