"""
chat.py — Router FastAPI para el chat de BT.
Delega toda la lógica de negocio en los módulos app.bt.*.
"""
import json
import asyncio
import re as _re
from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional

from app.config import logger
from app.bt.config   import BT_MODEL, SYSTEM_PROMPT
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
from app.bt.autonomo import (
    activar_autonomo, desactivar_autonomo, es_autonomo,
    evaluar_entrada, evaluar_salidas, registrar_decision, obtener_log_autonomo,
)
import httpx as _httpx

router = APIRouter(prefix="/chat")

# ── Domain guardrail ──────────────────────────────────────────────────────────
_FINANCE_KEYWORDS = {
    # ── Tickers ───────────────────────────────────────────────────────────────
    "btc", "eth", "sol", "bnb", "xrp", "ada", "dot", "link", "matic", "avax",
    "doge", "shib", "pepe", "trump", "ltc", "trx", "uni", "aave", "inj",
    "rndr", "render", "popcat", "floki", "atom", "near", "bonk", "wif",
    "arb", "op", "sui", "apt", "ton", "wld", "not", "ftm", "jup",
    # ── Nombres de activos ────────────────────────────────────────────────────
    "bitcoin", "ethereum", "solana", "binance", "coinbase", "ripple",
    "dogecoin", "cardano", "avalanche", "polkadot", "chainlink", "polygon",
    "litecoin", "cosmos", "tron", "uniswap", "injective", "arbitrum",
    "optimism", "aptos", "toncoin", "worldcoin", "notcoin", "fantom",
    "jupiter", "floki", "popcat", "bonk", "dogwifhat", "shiba",
    # ── Cripto general ────────────────────────────────────────────────────────
    "crypto", "cripto", "criptomoneda", "criptomonedas", "criptodivisas",
    "token", "tokens", "coin", "coins", "defi", "nft", "nfts", "blockchain",
    "altcoin", "altcoins", "staking", "wallet", "exchange", "memecoin",
    "memecoins", "halving", "pump", "dump", "rugpull", "airdrop",
    "whitepaper", "layer1", "layer2", "l1", "l2", "bridge", "liquidity",
    "tvl", "yield", "farming", "pool", "amm", "dex", "cex", "gas",
    # ── Preguntas de consejo e inversión ─────────────────────────────────────
    "invertir", "invertir en", "donde invertir", "cuanto invertir",
    "inversion", "inversión", "inversiones", "recomiendas", "recomienda",
    "recomendacion", "recomendación", "oportunidad", "oportunidades",
    "donde poner", "donde meter", "que comprar", "qué comprar",
    "merece la pena", "vale la pena", "conviene", "deberia", "debería",
    "mejor momento", "buen momento", "momento de", "es buen", "es malo",
    "invierto", "invierta", "invierteme", "cuanto poner", "cuanto meto",
    "cuanto arriesgo", "cuanto riesgo",
    # ── Mercado y precio ──────────────────────────────────────────────────────
    "mercado", "precio", "precios", "cotizacion", "cotizaciones", "valor",
    "señal", "senal", "compra", "comprar", "vende", "vender", "vendo",
    "subir", "bajar", "sube", "baja", "subida", "bajada", "alza", "caida",
    "caída", "rebote", "recuperacion", "recuperación", "maximos", "mínimos",
    "maximo", "minimo", "ath", "atl", "all time high", "resistencia maxima",
    # ── Cartera / posiciones ──────────────────────────────────────────────────
    "cartera", "portfolio", "posicion", "posición", "posiciones", "abrir",
    "cerrar", "saldo", "exposicion", "exposición", "patrimonio", "capital",
    "ganancia", "ganancias", "perdida", "pérdida", "perdidas", "beneficio",
    "beneficios", "p&l", "pnl", "rentabilidad", "rendimiento", "retorno",
    "roi", "profits", "losses",
    # ── Indicadores técnicos ──────────────────────────────────────────────────
    "rsi", "macd", "indicador", "indicadores", "analisis", "análisis",
    "soporte", "resistencia", "tendencia", "volumen", "liquidez",
    "bollinger", "ema", "sma", "atr", "obv", "divergencia", "cruce",
    "vela", "velas", "candlestick", "patron", "patrón", "hammer", "doji",
    "engulfing", "breakout", "breakdown", "rango", "canal", "cuña",
    "triangulo", "triángulo", "doble techo", "doble suelo", "fibonacci",
    "grafica", "gráfica", "chart", "grafico", "gráfico", "timeframe",
    # ── Trading y operativa ───────────────────────────────────────────────────
    "trading", "trader", "stop", "stoploss", "stop loss", "take profit",
    "entrada", "salida", "setup", "kelly", "riesgo", "conviction",
    "largo", "corto", "long", "short", "apalancamiento", "leverage",
    "futuros", "opciones", "perpetuo", "perp", "spot", "margen",
    "liquidacion", "liquidación", "funding", "open interest", "scalping",
    "daytrading", "swing", "hodl", "dca", "promedio", "acumular",
    "sizing", "posicion size", "ratio", "r/r", "riesgo beneficio",
    # ── Macro y mercados tradicionales ───────────────────────────────────────
    "inflacion", "inflación", "fed", "reserva federal", "tipos", "interes",
    "interés", "dolar", "dólar", "dxy", "euro", "libra", "yen",
    "oro", "plata", "petroleo", "petróleo", "materias primas",
    "bolsa", "acciones", "nasdaq", "sp500", "s&p", "dow jones",
    "bear market", "bull market", "recesion", "recesión", "qe", "qt",
    "liquidez", "m2", "curva de tipos", "bono", "bonos", "yields",
    # ── Sentimiento ───────────────────────────────────────────────────────────
    "fear", "greed", "miedo", "avaricia", "sentimiento", "bull", "bear",
    "correccion", "corrección", "fomo", "panico", "pánico", "capitulacion",
    "capitulación", "euforia", "optimismo", "pesimismo", "dominancia",
    "altseason", "temporada de alts", "dominance",
    # ── Preguntas de educación financiera ─────────────────────────────────────
    "que es", "qué es", "como funciona", "cómo funciona", "explica",
    "explícame", "diferencia entre", "para que sirve", "cuál es mejor",
    "cual es mejor", "ventajas", "desventajas", "riesgo de",
}
_OFFTOPIC_KEYWORDS = {
    "receta", "cocinar", "cocina", "pasta", "arroz", "pollo", "cena", "almuerzo",
    "fútbol", "baloncesto", "tenis", "partido", "gol", "deporte", "liga",
    "película", "serie", "netflix", "canción", "música", "artista", "concierto",
    "lluvia", "temperatura", "clima", "meteorología",
    "elecciones", "presidente", "gobierno", "ministro",
    "chiste", "broma",
    "amor", "novia", "novio", "relación", "pareja", "citas",
    "medicina", "síntoma", "enfermedad", "doctor", "pastilla",
    "poema", "redacción", "ensayo literario",
}


_NAV_RE = _re.compile(
    r"""
    \b(
      # ── mostrar / enseñar ─────────────────────────────────────────────────
      mu[eé]stra(?:me(?:lo|la|nos)?|lo|la|nos)?   # muéstrame, muestramelo, muestrala…
      |ens[eé][nñ]a(?:me(?:lo|la)?|lo|la|nos?)?   # enséñame, enséñamelo, enséñanos
      |ens[eé][nñ]amelo|ens[eé][nñ]amela

      # ── ver ───────────────────────────────────────────────────────────────
      |ver?lo|verla|verlo                          # verlo, verla
      |vamos\s+a\s+ver                             # vamos a ver
      |quiero\s+ver                                # quiero ver
      |d[eé]jame\s+ver                             # déjame ver
      |veamos|echemos\s+un\s+vistazo               # veamos, echemos un vistazo

      # ── mirar ─────────────────────────────────────────────────────────────
      |m[ií]ra(?:me(?:lo|la)?|lo|la)?             # míralo, míramelo, mira
      |[eé]chale?\s+un\s+ojo                       # échale un ojo
      |[eé]chamosle?\s+un\s+ojo

      # ── abrir ─────────────────────────────────────────────────────────────
      |abr(?:e(?:lo|la|me(?:lo|la)?)?|ir(?:lo|la)?) # abre, ábrelo, ábreme la, abrirlo
      |abre\s+(?:la\s+)?(?:gr[aá]fica|chart|gr[aá]fico|pantalla)

      # ── poner / cambiar ───────────────────────────────────────────────────
      |pon(?:me(?:\s+en)?(?:lo|la)?|lo|la)?       # pon, ponme, ponmelo, ponla
      |ponme\s+(?:en\s+)?(?:la\s+)?(?:gr[aá]fica|chart)
      |cambi[ao](?:\s+a)?                          # cambia, cambio a
      |cambiar\s+a                                 # cambiar a
      |switch(?:ea?)?(?:\s+a)?                     # switch, switchea a
      |pasa(?:me)?\s+a?                            # pasa a, pásame a

      # ── cargar / traer ────────────────────────────────────────────────────
      |carg(?:a(?:me(?:lo|la)?|lo|la)?|ar(?:lo|la)?)  # carga, cárgame, cárgala
      |carga\s+(?:la\s+)?(?:gr[aá]fica|chart)
      |tr[aá]e(?:me(?:lo|la)?|lo|la)?             # trae, tráeme, tráemelo
      |trae\s+(?:la\s+)?(?:gr[aá]fica|chart)

      # ── sacar / meter en pantalla ─────────────────────────────────────────
      |s[aá]ca(?:me(?:lo|la)?|lo|la)?             # saca, sácame, sácamelo
      |s[aá]ca\s+(?:la\s+)?(?:gr[aá]fica|chart)
      |pon(?:me)?\s+(?:en\s+)?pantalla             # pon en pantalla

      # ── ir a ──────────────────────────────────────────────────────────────
      |ir\s+a|ve\s+a|vete\s+a                      # ir a, ve a, vete a
      |llev[aá]me\s+a                              # llévame a

      # ── nouns solos (basta con mencionar gráfica+símbolo) ─────────────────
      |gr[aá]fic[ao]s?                             # gráfica, gráfico, gráficas
      |chart                                        # chart
      |velas?(?:\s+japonesas?)?                    # vela, velas japonesas
      |candel(?:a|as)?s?                           # candela, candelas
      |candle(?:stick)?s?                          # candle, candlestick
      |visualiza(?:r(?:lo|la)?|lo|la)?             # visualiza, visualizarlo
      |mostrar?(?:lo|la|me(?:lo|la)?)?             # mostrar, mostrarlo, mostrame
      |representar?                                 # representa

      # ── frases de demanda directa ─────────────────────────────────────────
      |d[aá]me\s+(?:la\s+)?(?:gr[aá]fica|chart|el\s+gr[aá]fico)
      |quiero\s+(?:la\s+)?(?:gr[aá]fica|el\s+chart|el\s+gr[aá]fico)
      |necesito\s+(?:la\s+)?(?:gr[aá]fica|el\s+chart)
    )\b
    """,
    _re.I | _re.X,
)

_AUTONOMO_ON_RE  = _re.compile(
    r'\b(activa|activar|enciende|encender|modo\s+autonomo|opera\s+solo|operar\s+solo|'
    r'bt\s+autonomo|modo\s+auto|auto\s+trading|autotrading)\b', _re.I
)
_AUTONOMO_OFF_RE = _re.compile(
    r'\b(desactiva|desactivar|apaga|apagar|para|detener|modo\s+manual|'
    r'manual|stop\s+auto|deja\s+de\s+operar)\b', _re.I
)
_AUTONOMO_STATUS_RE = _re.compile(
    r'\b(estado|status|como\s+vas|cuanto\s+llevas|operaciones\s+auto)\b', _re.I
)


# Detecta preguntas de tipo "dónde/qué/cuánto invertir" sin símbolo específico
_CONSEJO_RE = _re.compile(
    r'\b('
    r'donde\s+(invertir|poner|meter|comprar)|'
    r'qu[eé]\s+(comprar|invertir|recomiendas?)|'
    r'cu[aá]l\s+(es\s+mejor|recomiendas?|comprar[ií]as?)|'
    r'mejor\s+(opci[oó]n|activo|cripto|inversi[oó]n|setup|oportunidad)|'
    r'oportunidades?\s+(ahora|hoy|del?\s+mercado)|'
    r'qu[eé]\s+(est[aá]\s+bien|tiene\s+buen|tiene\s+mejor)|'
    r'c[oó]mo\s+invierto|'
    r'd[oó]nde\s+invierto|'
    r'recomiendas?\s+invertir|'
    r'cu[aá]nto\s+(invierto|pongo|meto|arriesgo)|'
    r'cu[aá]l\s+tiene\s+(mejor|m[aá]s)\s+(setup|conviction|señal|momentum)|'
    r'qu[eé]\s+(activos?|criptos?|monedas?)\s+(comprar[ií]as?|recomiendas?)|'
    r'mejor\s+momento\s+para|'
    r'vale\s+la\s+pena\s+invertir|'
    r'merece\s+la\s+pena'
    r')\b',
    _re.I
)

def _detectar_comando_autonomo(mensaje: str) -> str | None:
    if _AUTONOMO_ON_RE.search(mensaje):  return "activar"
    if _AUTONOMO_OFF_RE.search(mensaje): return "desactivar"
    if _AUTONOMO_STATUS_RE.search(mensaje) and _re.search(r'\bbt\b|\bautonomo\b', mensaje, _re.I):
        return "estado"
    return None


def _accion_ui(mensaje: str, simbolos: list) -> dict | None:
    """Si el mensaje pide ver un activo en el chart, devuelve el evento de acción UI."""
    from app.bt.detectar import _normalizar
    if simbolos and _NAV_RE.search(_normalizar(mensaje)):
        return {"action": "change_symbol", "symbol": simbolos[0]}
    return None


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

    # Auto-fetch top símbolos cuando la pregunta es de tipo consejo sin símbolo concreto
    if not simbolos and _CONSEJO_RE.search(body.mensaje):
        simbolos = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

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

            # ── Acción UI (cambia símbolo en el chart si procede) ─────────────
            ui_action = _accion_ui(body.mensaje, simbolos)
            if ui_action:
                yield f"data: {json.dumps(ui_action)}\n\n"

            # ── Comandos de modo autónomo ─────────────────────────────────────
            cmd_autonomo = _detectar_comando_autonomo(body.mensaje)
            if cmd_autonomo and token:
                if cmd_autonomo == "activar":
                    activar_autonomo(user_id)
                    resp = "Modo autónomo activado. Voy a monitorizar el mercado y operar cuando vea señales sólidas (conviction ≥ 72). Te notificaré cada operación."
                elif cmd_autonomo == "desactivar":
                    desactivar_autonomo(user_id)
                    resp = "Modo autónomo desactivado. Solo opero cuando me lo pidas explícitamente."
                elif cmd_autonomo == "estado":
                    activo = es_autonomo(user_id)
                    log    = obtener_log_autonomo(user_id)
                    ops    = len(log)
                    resp   = f"Modo autónomo: {'ACTIVO ✓' if activo else 'INACTIVO'}. {ops} operaciones autónomas registradas."
                yield f"data: {json.dumps({'content': resp})}\n\n"
                guardar_turno(user_id, "user",      body.mensaje)
                guardar_turno(user_id, "assistant", resp)
                yield "data: [DONE]\n\n"
                return

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
                    sym = intencion["symbol"]
                    a   = analisis_map.get(sym)

                    # Cierre de posición completa (sin monto especificado)
                    if intencion.get("full_position"):
                        posicion_actual = next(
                            (p for p in datos_stats.get("positions", []) if p.get("symbol") == sym), None
                        )
                        if posicion_actual:
                            precio_actual = float(a["entry_price"]) if a else posicion_actual.get("currentPrice", 0)
                            amount_total  = posicion_actual.get("quantity", 0) * precio_actual
                            intencion["amount_usd"] = amount_total
                        else:
                            intencion = None  # no hay posición que cerrar

                    if intencion:
                        if not intencion.get("amount_usd") and riesgo.get("max_posicion", 0) > 0:
                            intencion["amount_usd"] = riesgo["max_posicion"]
                        if a and intencion.get("amount_usd", 0) > 0:
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
            if ui_action and analisis_map:
                llm_instruccion = "Ya cambiaste el gráfico al activo pedido. Confirma en una frase e incluye el dato más relevante del mercado ahora mismo."
            elif analisis_map:
                llm_instruccion = "Añade UNA línea: tu lectura del mercado y el nivel o acción concreta a vigilar."
            else:
                llm_instruccion = (
                    "Responde con criterio propio y números concretos. "
                    "NUNCA uses frases como 'no puedo dar consejos', 'consulta un profesional' o 'depende'. "
                    "Da tu recomendación directamente. Máximo 3 líneas."
                )

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "system", "content": "Sin markdown. Sin bullets. Sin disclaimers. " + llm_instruccion},
            ]

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


@router.get("/autonomo/estado")
async def autonomo_estado(authorization: Optional[str] = Header(None)):
    """Estado del modo autónomo y log de operaciones recientes."""
    token   = authorization.replace("Bearer ", "").strip() if authorization else None
    user_id = extraer_user_id(token) if token else "anon"
    return {
        "activo": es_autonomo(user_id),
        "log":    obtener_log_autonomo(user_id),
    }


@router.post("/autonomo/ciclo")
async def autonomo_ciclo(authorization: Optional[str] = Header(None)):
    """
    Ejecuta un ciclo autónomo para el usuario: evalúa entradas y salidas.
    Llamado desde el frontend cada N minutos cuando el modo está activo.
    """
    token   = authorization.replace("Bearer ", "").strip() if authorization else None
    user_id = extraer_user_id(token) if token else "anon"

    if not token or not es_autonomo(user_id):
        return {"operaciones": [], "mensaje": "modo autónomo no activo"}

    from app.analisis import realizar_analisis
    from app.indicadores import obtener_velas_binance
    from app.config import redis_client
    import time as _time

    def _push_alerta(uid: str, mensaje: str, urgencia: int = 2):
        if not redis_client:
            return
        import json as _json
        payload = _json.dumps({"mensaje": mensaje, "urgencia": urgencia, "ts": _time.time()})
        redis_client.rpush(f"bt:alertas:{uid}", payload)
        redis_client.expire(f"bt:alertas:{uid}", 7200)

    SIMBOLOS_WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT"]
    operaciones: list[dict] = []

    try:
        cartera, stats = await obtener_estado_cartera(token)
        if not cartera:
            return {"operaciones": [], "mensaje": "no se pudo obtener cartera"}

        analisis_map: dict = {}
        for sym in SIMBOLOS_WATCH:
            try:
                data = obtener_velas_binance(sym, limit=60)
                if len(data["prices"]) >= 5:
                    a = await realizar_analisis(sym, data["prices"][-1], data["prices"], data["volumes"])
                    analisis_map[sym] = a
            except Exception:
                pass

        # ── Evaluar salidas ────────────────────────────────────────────────────
        posiciones = stats.get("positions", [])
        salidas = evaluar_salidas(posiciones, analisis_map)
        for sym, precio, razon in salidas:
            pos = next((p for p in posiciones if p.get("symbol") == sym), None)
            if not pos:
                continue
            amount_usd = pos.get("quantity", 0) * precio
            resultado  = await ejecutar_orden(
                symbol=sym, side="SELL", amount_usd=amount_usd,
                price=precio, signal="BT_AUTO_SALIDA", confidence="auto",
                token=token,
            )
            if resultado["status"] == 200:
                registrar_decision(user_id, "SELL", sym, amount_usd, razon)
                _push_alerta(user_id, f"BT cerró {sym.replace('USDT','')} — {razon}")
                operaciones.append({"tipo": "SELL", "symbol": sym, "amount": amount_usd, "razon": razon})

        # ── Evaluar entradas ───────────────────────────────────────────────────
        # Refresca cartera tras posibles ventas
        cartera, stats = await obtener_estado_cartera(token)
        for sym, a in analisis_map.items():
            abrir, amount, razon = evaluar_entrada(sym, a, cartera, stats)
            if not abrir:
                continue
            resultado = await ejecutar_orden(
                symbol=sym, side="BUY", amount_usd=amount,
                price=float(a["entry_price"]), signal=a.get("signal", ""),
                confidence=a.get("confidence", "0%"), token=token,
            )
            if resultado["status"] == 200:
                registrar_decision(user_id, "BUY", sym, amount, razon)
                _push_alerta(user_id, f"BT abrió {sym.replace('USDT','')} — {razon}")
                operaciones.append({"tipo": "BUY", "symbol": sym, "amount": amount, "razon": razon})

    except Exception as e:
        logger.error(f"Error ciclo autónomo {user_id}: {e}")

    return {"operaciones": operaciones, "mensaje": f"{len(operaciones)} operaciones ejecutadas"}


@router.get("/alertas")
async def stream_alertas(token: Optional[str] = Query(None)):
    """SSE: el cliente se suscribe y recibe alertas proactivas de BT en tiempo real."""
    user_id = extraer_user_id(token) if token else "anon"

    async def generate():
        yield ": connected\n\n"  # primer chunk garantiza que los CORS headers se envíen
        while True:
            try:
                alerta = consumir_alerta(user_id)
                if alerta:
                    yield f"data: {json.dumps(alerta)}\n\n"
                else:
                    yield ": heartbeat\n\n"
            except Exception:
                yield ": heartbeat\n\n"
            await asyncio.sleep(4)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
