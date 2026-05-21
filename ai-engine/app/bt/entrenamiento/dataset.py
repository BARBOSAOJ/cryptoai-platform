"""
dataset.py — Generador de dataset sintético para fine-tuning de BT.

Genera ejemplos de conversación (system / user / assistant) que enseñan
al modelo la personalidad de BT, el vocabulario de indicadores técnicos
y la lógica de conviction score.

Uso:
    python -m app.bt.entrenamiento.dataset          # imprime estadísticas
    python -m app.bt.entrenamiento.dataset --save   # guarda bt_dataset.jsonl
"""
import json
import random
import argparse
from pathlib import Path
from app.bt.config import SYSTEM_PROMPT

random.seed(42)

# ─── Activos ──────────────────────────────────────────────────────────────────

ACTIVOS = [
    ("Bitcoin",   "BTC",  "BTCUSDT",  lambda: round(random.uniform(55000, 100000), 0)),
    ("Ethereum",  "ETH",  "ETHUSDT",  lambda: round(random.uniform(2500,   6000),  0)),
    ("Solana",    "SOL",  "SOLUSDT",  lambda: round(random.uniform(120,    300),   1)),
    ("BNB",       "BNB",  "BNBUSDT",  lambda: round(random.uniform(450,    800),   0)),
    ("XRP",       "XRP",  "XRPUSDT",  lambda: round(random.uniform(0.4,    2.0),   3)),
    ("Dogecoin",  "DOGE", "DOGEUSDT", lambda: round(random.uniform(0.06,   0.40),  4)),
    ("Avalanche", "AVAX", "AVAXUSDT", lambda: round(random.uniform(20,     60),    2)),
    ("Chainlink", "LINK", "LINKUSDT", lambda: round(random.uniform(10,     30),    2)),
]


def _activo():
    a = random.choice(ACTIVOS)
    return {"nombre": a[0], "ticker": a[1], "symbol": a[2], "precio": a[3]()}


def _indicadores_bullish():
    return {
        "rsi":            round(random.uniform(22, 34), 1),
        "stoch_rsi":      round(random.uniform(0.03, 0.18), 2),
        "macd_histogram": round(random.uniform(0.001, 0.015), 4),
        "ema_cross":      round(random.uniform(0.3, 1.5), 2),
        "bb_position":    round(random.uniform(-1.2, -0.5), 2),
        "obv_delta":      round(random.uniform(0.06, 0.18), 3),
        "adx":            round(random.uniform(28, 55), 1),
        "regimen":        "TRENDING",
        "fear_greed":     random.randint(10, 28),
        "fg_label":       random.choice(["Extreme Fear", "Fear"]),
        "reddit":         round(random.uniform(0.3, 0.7), 2),
        "reddit_label":   random.choice(["positivo moderado", "positivo"]),
    }


def _indicadores_bearish():
    return {
        "rsi":            round(random.uniform(68, 82), 1),
        "stoch_rsi":      round(random.uniform(0.82, 0.97), 2),
        "macd_histogram": round(random.uniform(-0.015, -0.001), 4),
        "ema_cross":      round(random.uniform(-1.5, -0.3), 2),
        "bb_position":    round(random.uniform(0.5, 1.2), 2),
        "obv_delta":      round(random.uniform(-0.18, -0.06), 3),
        "adx":            round(random.uniform(28, 55), 1),
        "regimen":        "TRENDING",
        "fear_greed":     random.randint(72, 90),
        "fg_label":       random.choice(["Greed", "Extreme Greed"]),
        "reddit":         round(random.uniform(-0.6, -0.2), 2),
        "reddit_label":   random.choice(["negativo moderado", "negativo"]),
    }


def _indicadores_neutral():
    return {
        "rsi":            round(random.uniform(42, 58), 1),
        "stoch_rsi":      round(random.uniform(0.35, 0.65), 2),
        "macd_histogram": round(random.uniform(-0.003, 0.003), 4),
        "ema_cross":      round(random.uniform(-0.2, 0.2), 2),
        "bb_position":    round(random.uniform(-0.3, 0.3), 2),
        "obv_delta":      round(random.uniform(-0.04, 0.04), 3),
        "adx":            round(random.uniform(12, 22), 1),
        "regimen":        random.choice(["RANGING", "TRANSITION"]),
        "fear_greed":     random.randint(35, 65),
        "fg_label":       "Neutral",
        "reddit":         round(random.uniform(-0.15, 0.15), 2),
        "reddit_label":   "neutro",
    }


# ─── Bloque de contexto de mercado (imita lo que envía obtener_contexto_mercado) ──

def _bloque_mercado(activo: dict, ind: dict, conviction: int, signal: str,
                    lstm_pred: float, confidence: int) -> str:
    return (
        f"\n--- ANÁLISIS EN TIEMPO REAL: {activo['symbol']} ---\n"
        f"Precio: ${activo['precio']} | Señal IA: {signal} | Confianza: {confidence}%\n"
        f"Conviction Score: {conviction}/100 | LSTM activo: Sí\n"
        f"Predicción próxima vela: ${lstm_pred}\n"
        f"Régimen: {ind['regimen']} | ADX: {ind['adx']}\n"
        f"RSI: {ind['rsi']} | StochRSI: {ind['stoch_rsi']} | MACD hist: {ind['macd_histogram']}\n"
        f"EMA cross: {ind['ema_cross']} | BB pos: {ind['bb_position']}\n"
        f"Fear & Greed: {ind['fear_greed']}/100 ({ind['fg_label']})\n"
        f"Reddit: {ind['reddit_label']} (score {ind['reddit']})\n"
    )


# ─── Generadores de respuesta por escenario ────────────────────────────────────

def _resp_comprar(activo: dict, ind: dict, conv: int, lstm_pred: float) -> str:
    diff_pct = round((lstm_pred - activo["precio"]) / activo["precio"] * 100, 1)
    rsi_coment = random.choice([
        f"RSI en {ind['rsi']} — zona de sobreventa clara.",
        f"RSI a {ind['rsi']}, el mercado lo está dejando tirado.",
        f"Con RSI en {ind['rsi']} hay muy poco espacio para más caída.",
    ])
    regime_coment = random.choice([
        "El régimen TRENDING con ADX elevado confirma que la tendencia tiene fuerza.",
        f"ADX en {ind['adx']} — la tendencia no es un espejismo.",
        "Régimen TRENDING: los indicadores de momentum apuntan todos en la misma dirección.",
    ])
    fg_coment = random.choice([
        f"El Fear & Greed a {ind['fear_greed']} ({ind['fg_label']}) es señal contraria clásica — comprar cuando otros tienen miedo.",
        f"Fear & Greed en {ind['fear_greed']}. El mercado está asustado, que es exactamente cuando hay oportunidad.",
        f"Con miedo extremo en {ind['fear_greed']}/100, el precio descuenta escenarios peores de lo que probablemente ocurra.",
    ])
    lstm_coment = random.choice([
        f"El LSTM proyecta ${lstm_pred} en la próxima vela, un {diff_pct}% al alza.",
        f"El modelo de predicción apunta a ${lstm_pred} — diferencial de {diff_pct}%.",
        f"LSTM estima ${lstm_pred}, lo que daría un movimiento del {diff_pct}% si se cumple.",
    ])
    return (
        f"{activo['nombre']} presenta una de las mejores configuraciones técnicas del momento. "
        f"Conviction de {conv}/100 — recomendación directa: **COMPRAR**.\n\n"
        f"{rsi_coment} {regime_coment}\n\n"
        f"{fg_coment} {lstm_coment}"
    )


def _resp_vender(activo: dict, ind: dict, conv: int) -> str:
    rsi_coment = random.choice([
        f"RSI en {ind['rsi']} — sobrecompra técnica evidente.",
        f"Con RSI a {ind['rsi']}, el activo está caro en términos de momentum.",
        f"RSI rozando {ind['rsi']}: el rally ha consumido gran parte del impulso.",
    ])
    macd_coment = random.choice([
        "El histograma MACD negativo indica que los alcistas están perdiendo fuerza.",
        f"MACD hist en {ind['macd_histogram']}: la presión vendedora va ganando terreno.",
        "El MACD lleva varios períodos divergiendo a la baja.",
    ])
    fg_coment = random.choice([
        f"Fear & Greed en {ind['fear_greed']} ({ind['fg_label']}). Cuando todos son codiciosos es momento de ser cauteloso.",
        f"El índice de codicia en {ind['fear_greed']} históricamente precede correcciones.",
        f"Con F&G a {ind['fear_greed']}, estamos en territorio de euforia — zona de riesgo.",
    ])
    return (
        f"Los datos apuntan a una corrección en {activo['nombre']}. Conviction {conv}/100 — señal de **VENDER**.\n\n"
        f"{rsi_coment} {macd_coment}\n\n"
        f"{fg_coment}"
    )


def _resp_mantener_rango(activo: dict, ind: dict, conv: int) -> str:
    opciones = [
        (
            f"Las señales en {activo['nombre']} se contradicen entre sí. Conviction {conv}/100 — no hay edge claro.\n\n"
            f"RSI en {ind['rsi']} y MACD prácticamente plano ({ind['macd_histogram']}): el mercado no sabe hacia dónde ir. "
            f"El régimen {ind['regimen']} con ADX bajo ({ind['adx']}) confirma que no hay tendencia que seguir. "
            f"Operar en estas condiciones es básicamente apostar, no analizar."
        ),
        (
            f"Con {activo['nombre']} en {ind['regimen']} y ADX de {ind['adx']}, no hay tendencia que explotar. "
            f"Conviction {conv}/100 — insuficiente para recomendar entrada.\n\n"
            f"RSI en zona neutral ({ind['rsi']}), MACD sin dirección clara. El Fear & Greed en {ind['fear_greed']} "
            f"tampoco da señal contraria útil. Aquí la paciencia vale más que una orden."
        ),
        (
            f"Conviction de {conv}/100 — por debajo del umbral operativo. **Mantener** o esperar entrada.\n\n"
            f"El mercado de {activo['nombre']} está en {ind['regimen']}: ADX {ind['adx']}, RSI {ind['rsi']}, "
            f"histograma MACD {ind['macd_histogram']}. No hay confluencia suficiente. "
            f"Un mercado en rango se puede operar, pero con estrategia diferente — los breakouts aquí son con frecuencia trampas."
        ),
    ]
    return random.choice(opciones)


def _resp_conviction_baja(activo: dict, ind: dict, conv: int) -> str:
    return random.choice([
        (
            f"Conviction de {conv}/100 — demasiado bajo para recomendar operación. Los datos de {activo['nombre']} "
            f"no ofrecen una lectura limpia ahora mismo.\n\n"
            f"RSI en {ind['rsi']}, MACD ambiguo, régimen {ind['regimen']} con ADX {ind['adx']}. "
            f"Con esto sólo se puede decir que el mercado está indeciso, lo cual no es una tesis de trading."
        ),
        (
            f"Los indicadores de {activo['nombre']} no generan señal accionable. Conviction {conv}/100.\n\n"
            f"Cuando los datos no son conclusivos, la posición correcta es no tener posición. "
            f"Fear & Greed en {ind['fear_greed']} ({ind['fg_label']}) tampoco añade claridad en este contexto. "
            f"Esperar a que los indicadores se alineen es una estrategia legítima."
        ),
    ])


def _resp_trade_compra(activo: dict, size: float, total: float, ind: dict, alineado: bool) -> str:
    if alineado:
        return random.choice([
            (
                f"Compra ejecutada: {size} {activo['ticker']} a ${activo['precio']} — total ${total:.2f}.\n\n"
                f"Operación respaldada por los datos: RSI en {ind['rsi']}, régimen TRENDING y conviction alto. "
                f"La entrada está justificada técnicamente."
            ),
            (
                f"Orden de compra procesada. {size} {activo['ticker']} a ${activo['precio']} (${total:.2f}).\n\n"
                f"Los indicadores acompañan: RSI {ind['rsi']}, MACD positivo, Fear & Greed en zona de miedo ({ind['fear_greed']}). "
                f"Si la tesis falla, el stop debería estar por debajo del soporte más próximo."
            ),
        ])
    else:
        return random.choice([
            (
                f"Compra ejecutada: {size} {activo['ticker']} a ${activo['precio']} (${total:.2f}).\n\n"
                f"Dicho esto: la señal técnica actual no es de compra. RSI en {ind['rsi']}, régimen {ind['regimen']}. "
                f"Si tienes un motivo específico para esta entrada que los indicadores no capturan, perfecto. "
                f"Si no, ten en cuenta que estás operando contra el análisis."
            ),
            (
                f"Orden ejecutada — {size} {activo['ticker']} a ${activo['precio']} (${total:.2f}).\n\n"
                f"Te lo digo directamente: los datos no respaldan esta compra ahora mismo. "
                f"Conviction por debajo del umbral y régimen {ind['regimen']}. La decisión es tuya, pero que conste."
            ),
        ])


def _resp_trade_venta(activo: dict, size: float, total: float) -> str:
    return random.choice([
        f"Venta procesada: {size} {activo['ticker']} a ${activo['precio']} — ${total:.2f} liberados.",
        f"Orden de venta ejecutada. {size} {activo['ticker']} a ${activo['precio']} (${total:.2f}).",
        f"Vendidos {size} {activo['ticker']} a ${activo['precio']}. Total: ${total:.2f}.",
    ])


def _resp_comparacion(a1: dict, ind1: dict, conv1: int, sig1: str,
                      a2: dict, ind2: dict, conv2: int, sig2: str) -> str:
    ganador = a1 if conv1 > conv2 else a2
    perdedor = a2 if conv1 > conv2 else a1
    g_ind = ind1 if conv1 > conv2 else ind2
    g_conv = conv1 if conv1 > conv2 else conv2
    p_conv = conv2 if conv1 > conv2 else conv1
    return (
        f"Comparando {a1['nombre']} (conviction {conv1}/100, {sig1.split()[0]}) "
        f"vs {a2['nombre']} (conviction {conv2}/100, {sig2.split()[0]}).\n\n"
        f"**{ganador['nombre']} tiene mejor configuración técnica ahora mismo.** "
        f"RSI en {g_ind['rsi']}, régimen {g_ind['regimen']}, ADX {g_ind['adx']}. "
        f"Conviction de {g_conv}/100 frente a {p_conv}/100 de {perdedor['nombre']}. "
        f"Si tuvieras que elegir uno, {ganador['ticker']} tiene más respaldo en los datos."
    )


def _resp_fear_greed_extremo(fg: int, label: str) -> str:
    if fg <= 20:
        return random.choice([
            (
                f"Fear & Greed en {fg}/100 — {label}. Históricamente, los fondos de mercado coinciden con estos niveles.\n\n"
                f"Eso no significa comprar ciegamente: necesitas ver confirmación técnica (RSI en sobreventa, MACD dando la vuelta). "
                f"Pero sí es momento de tener el radar encendido. El mercado está vendiendo por pánico, no por análisis."
            ),
            (
                f"El índice Fear & Greed acaba de entrar en {label} ({fg}/100). Esta es la zona en la que históricamente "
                f"los inversores a largo plazo han encontrado las mejores entradas.\n\n"
                f"No es señal de compra automática — espera confluencia técnica. Pero el contexto de sentimiento es favorable."
            ),
        ])
    else:
        return random.choice([
            (
                f"Fear & Greed en {fg}/100 — {label}. El mercado está eufórico.\n\n"
                f"La euforia no crea techos por sí sola, pero sí reduce el margen de error. "
                f"En estos niveles, las correcciones son más probables y más dolorosas. "
                f"Si tienes posiciones abiertas, puede ser buen momento para revisar stops."
            ),
            (
                f"Con Fear & Greed a {fg}/100 ({label}), el consenso del mercado es alcista — lo cual es exactamente "
                f"cuando hay que ser más crítico.\n\n"
                f"Los datos técnicos mandan sobre el sentimiento, pero este nivel de euforia pide cautela adicional "
                f"antes de abrir posiciones nuevas."
            ),
        ])


# ─── Construcción de ejemplos ─────────────────────────────────────────────────

def _ejemplo(pregunta: str, contexto_mercado: str, respuesta: str) -> dict:
    """Formatea un ejemplo como lista de mensajes para fine-tuning de chat."""
    user_content = pregunta
    if contexto_mercado:
        user_content += f"\n\n[Datos de mercado obtenidos automáticamente:{contexto_mercado}]"
    return {
        "messages": [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": user_content},
            {"role": "assistant", "content": respuesta},
        ]
    }


def _gen_analisis_compra() -> dict:
    a = _activo()
    ind = _indicadores_bullish()
    conv = random.randint(72, 88)
    signal = "COMPRAR 🚀"
    lstm_pred = round(a["precio"] * random.uniform(1.005, 1.025), 2)
    pregunta = random.choice([
        f"analiza {a['nombre'].lower()}",
        f"¿cómo está {a['ticker']} ahora mismo?",
        f"dame un análisis de {a['nombre']}",
        f"¿qué piensas de {a['ticker']}?",
        f"¿hay oportunidad en {a['nombre']}?",
    ])
    contexto = _bloque_mercado(a, ind, conv, signal, lstm_pred, conv)
    resp = _resp_comprar(a, ind, conv, lstm_pred)
    return _ejemplo(pregunta, contexto, resp)


def _gen_analisis_venta() -> dict:
    a = _activo()
    ind = _indicadores_bearish()
    conv = random.randint(70, 85)
    signal = "VENDER 📉"
    lstm_pred = round(a["precio"] * random.uniform(0.975, 0.995), 2)
    pregunta = random.choice([
        f"analiza {a['nombre'].lower()}",
        f"¿debo vender {a['ticker']}?",
        f"¿qué señal tiene {a['nombre']}?",
        f"¿está {a['ticker']} sobrecomprado?",
    ])
    contexto = _bloque_mercado(a, ind, conv, signal, lstm_pred, conv)
    resp = _resp_vender(a, ind, conv)
    return _ejemplo(pregunta, contexto, resp)


def _gen_analisis_mantener() -> dict:
    a = _activo()
    ind = _indicadores_neutral()
    conv = random.randint(40, 55)
    signal = "MANTENER ⚖️"
    lstm_pred = round(a["precio"] * random.uniform(0.998, 1.003), 2)
    pregunta = random.choice([
        f"¿qué hago con {a['ticker']}?",
        f"análisis de {a['nombre']}",
        f"¿entro o espero en {a['nombre']}?",
        f"¿hay señal en {a['ticker']}?",
    ])
    contexto = _bloque_mercado(a, ind, conv, signal, lstm_pred, conv)
    resp = _resp_mantener_rango(a, ind, conv)
    return _ejemplo(pregunta, contexto, resp)


def _gen_conviction_baja() -> dict:
    a = _activo()
    ind = _indicadores_neutral()
    ind["adx"] = round(random.uniform(8, 15), 1)
    conv = random.randint(18, 38)
    signal = "MANTENER ⚖️"
    lstm_pred = a["precio"]
    pregunta = random.choice([
        f"¿merece la pena operar {a['ticker']} hoy?",
        f"¿hay algo interesante en {a['nombre']}?",
        f"dame tu opinión sobre {a['ticker']}",
    ])
    contexto = _bloque_mercado(a, ind, conv, signal, lstm_pred, conv)
    resp = _resp_conviction_baja(a, ind, conv)
    return _ejemplo(pregunta, contexto, resp)


def _gen_trade_compra() -> dict:
    a = _activo()
    alineado = random.random() > 0.35
    ind = _indicadores_bullish() if alineado else _indicadores_neutral()
    conv = random.randint(70, 85) if alineado else random.randint(30, 50)
    signal = "COMPRAR 🚀" if alineado else "MANTENER ⚖️"
    lstm_pred = round(a["precio"] * (1.01 if alineado else 1.0), 2)
    total = random.choice([50, 100, 200, 500, 1000])
    size = round(total / a["precio"], 8)
    pregunta = random.choice([
        f"compra {total}$ de {a['nombre'].lower()}",
        f"invierte {total} dólares en {a['ticker']}",
        f"compra {total} usd en {a['nombre'].lower()}",
        f"pon {total}€ en {a['ticker']}",
    ])
    orden_ctx = (
        f"\n\n[ORDEN EJECUTADA: Compra de {size} {a['symbol']} "
        f"a ${a['precio']} — Total: ${total:.2f}]"
    )
    contexto = _bloque_mercado(a, ind, conv, signal, lstm_pred, conv) + orden_ctx
    resp = _resp_trade_compra(a, size, total, ind, alineado)
    return _ejemplo(pregunta, contexto, resp)


def _gen_trade_venta() -> dict:
    a = _activo()
    total = random.choice([50, 100, 200, 500, 1000])
    size = round(total / a["precio"], 8)
    pregunta = random.choice([
        f"vende {total}$ de {a['nombre'].lower()}",
        f"cierra {total} usd de {a['ticker']}",
        f"vende {size} {a['ticker']}",
    ])
    orden_ctx = (
        f"\n\n[ORDEN EJECUTADA: Venta de {size} {a['symbol']} "
        f"a ${a['precio']} — Total: ${total:.2f}]"
    )
    resp = _resp_trade_venta(a, size, total)
    return _ejemplo(pregunta, orden_ctx, resp)


def _gen_comparacion() -> dict:
    a1, a2 = random.sample(ACTIVOS, 2)
    act1 = {"nombre": a1[0], "ticker": a1[1], "symbol": a1[2], "precio": a1[3]()}
    act2 = {"nombre": a2[0], "ticker": a2[1], "symbol": a2[2], "precio": a2[3]()}
    ind1 = random.choice([_indicadores_bullish, _indicadores_bearish, _indicadores_neutral])()
    ind2 = random.choice([_indicadores_bullish, _indicadores_bearish, _indicadores_neutral])()
    conv1 = random.randint(30, 85)
    conv2 = random.randint(30, 85)
    sig1 = random.choice(["COMPRAR 🚀", "MANTENER ⚖️", "VENDER 📉"])
    sig2 = random.choice(["COMPRAR 🚀", "MANTENER ⚖️", "VENDER 📉"])
    lstm1 = round(act1["precio"] * 1.01, 2)
    lstm2 = round(act2["precio"] * 1.01, 2)
    pregunta = random.choice([
        f"compara {act1['ticker']} y {act2['ticker']}",
        f"¿cuál tiene mejor señal, {act1['nombre']} o {act2['nombre']}?",
        f"¿{act1['ticker']} o {act2['ticker']}, cuál eliges?",
        f"dame un análisis de {act1['nombre']} y {act2['nombre']}",
    ])
    ctx  = _bloque_mercado(act1, ind1, conv1, sig1, lstm1, conv1)
    ctx += _bloque_mercado(act2, ind2, conv2, sig2, lstm2, conv2)
    resp = _resp_comparacion(act1, ind1, conv1, sig1, act2, ind2, conv2, sig2)
    return _ejemplo(pregunta, ctx, resp)


def _gen_fear_greed() -> dict:
    extremo = random.choice(["bajo", "alto"])
    if extremo == "bajo":
        fg = random.randint(5, 20)
        label = random.choice(["Extreme Fear", "Fear"])
    else:
        fg = random.randint(80, 95)
        label = random.choice(["Extreme Greed", "Greed"])
    pregunta = random.choice([
        "¿qué indica el Fear & Greed hoy?",
        f"el Fear & Greed está en {fg}, ¿qué significa?",
        "¿cómo está el sentimiento del mercado?",
        "¿el mercado tiene miedo o codicia ahora mismo?",
    ])
    resp = _resp_fear_greed_extremo(fg, label)
    return _ejemplo(pregunta, "", resp)


def _gen_perfil_riesgo() -> dict:
    perfiles = [
        ("conservador", "prefiero no arriesgar mucho", "conservador"),
        ("agresivo",     "no me importa el riesgo, quiero rendimiento", "agresivo"),
        ("moderado",     "estoy buscando un equilibrio entre riesgo y retorno", "moderado"),
    ]
    tipo, descripcion, label = random.choice(perfiles)
    activo_nombre = random.choice([a[0] for a in ACTIVOS])
    pregunta = random.choice([
        f"soy inversor {tipo}, ¿me recomiendas operar ahora?",
        f"{descripcion}. ¿qué hago con {activo_nombre}?",
        f"tengo perfil {tipo}, ¿debo entrar en cripto?",
    ])
    respuestas_conservador = [
        "Perfil conservador detectado. En crypto, eso significa exposición limitada y stop loss estricto. "
        "Si los indicadores no muestran señal clara (conviction >70), lo más coherente con tu perfil es no operar. "
        "El mercado siempre tiene otra oportunidad; el capital perdido no siempre vuelve.",
    ]
    respuestas_agresivo = [
        "Perfil agresivo: asumes más riesgo a cambio de mayor potencial. "
        "En ese caso puedes considerar entradas con conviction desde 60/100, aunque aumentas la tasa de fallos. "
        "Gestiona el tamaño de posición para que ninguna operación individual sea fatal para la cartera.",
    ]
    respuestas_moderado = [
        "Perfil moderado — la mayoría de los inversores racionales están aquí. "
        "Operaciones con conviction >65/100 y régimen TRENDING, stop loss definido antes de entrar. "
        "No es glamuroso, pero es sostenible.",
    ]
    mapa = {"conservador": respuestas_conservador, "agresivo": respuestas_agresivo, "moderado": respuestas_moderado}
    resp = random.choice(mapa[label])
    return _ejemplo(pregunta, "", resp)


def _gen_track_record() -> dict:
    a = _activo()
    evaluadas = random.randint(5, 40)
    aciertos  = random.randint(int(evaluadas * 0.55), evaluadas)
    tasa      = round(aciertos / evaluadas * 100, 1)
    pregunta  = random.choice([
        f"¿cuántas predicciones ha acertado BT sobre {a['ticker']}?",
        f"¿qué track record tienes en {a['nombre']}?",
        f"¿cómo vas de aciertos en {a['ticker']}?",
    ])
    ctx = (
        f"\n[TRACK RECORD BT — {a['symbol']}: "
        f"{tasa}% de acierto en {evaluadas} predicciones evaluadas]"
    )
    resp = random.choice([
        f"En {a['nombre']}: {aciertos} de {evaluadas} predicciones correctas ({tasa}%). "
        f"{'Resultado sólido.' if tasa >= 60 else 'Por encima del azar, pero con margen de mejora.'}",
        f"{tasa}% de acierto en {evaluadas} predicciones sobre {a['ticker']}. "
        f"{'El modelo está en forma.' if tasa >= 65 else 'Datos suficientes para evaluar, aunque el tamaño de muestra es pequeño.'} "
        f"Cada predicción evalúa si el precio se movió en la dirección esperada en un horizonte de 4 horas.",
    ])
    return _ejemplo(pregunta, ctx, resp)


# ─── API pública ──────────────────────────────────────────────────────────────

_GENERADORES = [
    (_gen_analisis_compra,  0.18),
    (_gen_analisis_venta,   0.14),
    (_gen_analisis_mantener,0.16),
    (_gen_conviction_baja,  0.08),
    (_gen_trade_compra,     0.14),
    (_gen_trade_venta,      0.06),
    (_gen_comparacion,      0.10),
    (_gen_fear_greed,       0.06),
    (_gen_perfil_riesgo,    0.04),
    (_gen_track_record,     0.04),
]


def generar_dataset(n: int = 800) -> list[dict]:
    """Devuelve una lista de n ejemplos de entrenamiento en formato chat."""
    fns, pesos = zip(*_GENERADORES)
    elegidos   = random.choices(fns, weights=pesos, k=n)
    dataset    = []
    for fn in elegidos:
        try:
            dataset.append(fn())
        except Exception:
            pass
    random.shuffle(dataset)
    return dataset


def guardar_dataset(ruta: str = "bt_dataset.jsonl", n: int = 800) -> None:
    datos = generar_dataset(n)
    with open(ruta, "w", encoding="utf-8") as f:
        for ej in datos:
            f.write(json.dumps(ej, ensure_ascii=False) + "\n")
    print(f"Dataset guardado: {ruta} ({len(datos)} ejemplos)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--save",   action="store_true", help="Guardar en bt_dataset.jsonl")
    parser.add_argument("--n",      type=int, default=800)
    parser.add_argument("--output", type=str, default="bt_dataset.jsonl")
    args = parser.parse_args()

    datos = generar_dataset(args.n)
    print(f"Ejemplos generados: {len(datos)}")
    tipos = {}
    for d in datos:
        sig = "buy"  if "COMPRAR" in d["messages"][-1]["content"] else \
              "sell" if "VENDER"  in d["messages"][-1]["content"] else \
              "hold" if "Conviction" in d["messages"][-1]["content"] else "other"
        tipos[sig] = tipos.get(sig, 0) + 1
    for k, v in sorted(tipos.items()):
        print(f"  {k}: {v}")
    if args.save:
        guardar_dataset(args.output, args.n)
