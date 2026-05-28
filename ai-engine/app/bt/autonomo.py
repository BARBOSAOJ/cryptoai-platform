"""
autonomo.py — Motor de decisión autónoma de BT.

BT puede operar de forma autónoma cuando el usuario activa el modo.
Abre posiciones cuando conviction es alta y cierra cuando la predicción se gira.
"""
import json
from app.config import logger, redis_client

# ── Umbrales de decisión ──────────────────────────────────────────────────────
UMBRAL_ENTRADA    = 72    # conviction mínimo para abrir posición
UMBRAL_SALIDA     = 35    # conviction por debajo del cual BT cierra
UMBRAL_SALIDA_SIG = 45    # si la señal se gira a VENDER con este conviction, cierra
MAX_EXPOSICION_PCT = 0.60 # máximo 60% del patrimonio invertido
MAX_POS_PCT        = 0.15 # máximo 15% del patrimonio por posición
MIN_SALDO_LIBRE    = 0.10 # reservar siempre el 10% del patrimonio

_AUTONOMO_KEY = "bt:autonomo:{user_id}"


# ── Estado del modo autónomo ──────────────────────────────────────────────────

def activar_autonomo(user_id: str) -> bool:
    if not redis_client:
        return False
    redis_client.setex(_AUTONOMO_KEY.format(user_id=user_id), 86400 * 7, "1")
    return True


def desactivar_autonomo(user_id: str) -> bool:
    if not redis_client:
        return False
    redis_client.delete(_AUTONOMO_KEY.format(user_id=user_id))
    return True


def es_autonomo(user_id: str) -> bool:
    if not redis_client:
        return False
    return redis_client.exists(_AUTONOMO_KEY.format(user_id=user_id)) == 1


# ── Lógica de entrada ─────────────────────────────────────────────────────────

def evaluar_entrada(
    symbol: str,
    analisis: dict,
    cartera: dict,
    stats: dict,
) -> tuple[bool, float, str]:
    """
    Decide si BT debe abrir una posición.
    Retorna (abrir: bool, amount_usd: float, razon: str).
    """
    conviction     = int(analisis.get("conviction_score", 0))
    signal         = analisis.get("signal", "")
    confidence_str = analisis.get("confidence", "0%")
    precio         = float(analisis.get("entry_price", 0))

    if precio <= 0:
        return False, 0.0, "sin precio válido"

    if conviction < UMBRAL_ENTRADA:
        return False, 0.0, f"conviction insuficiente ({conviction} < {UMBRAL_ENTRADA})"

    if "COMPRAR" not in signal and "COMPRA" not in signal:
        return False, 0.0, f"señal no es de compra ({signal})"

    patrimonio  = cartera.get("patrimonioTotal", 0.0)
    saldo_libre = cartera.get("saldoDisponible", 0.0)
    val_pos     = cartera.get("valorPosiciones", 0.0)

    if patrimonio <= 0:
        return False, 0.0, "sin patrimonio registrado"

    # No superar exposición máxima
    exposicion_actual = val_pos / patrimonio
    if exposicion_actual >= MAX_EXPOSICION_PCT:
        return False, 0.0, f"exposición máxima alcanzada ({exposicion_actual*100:.0f}%)"

    # Reservar mínimo el 10% libre
    saldo_util = saldo_libre - (patrimonio * MIN_SALDO_LIBRE)
    if saldo_util <= 0:
        return False, 0.0, "saldo libre insuficiente"

    # Ya hay posición abierta en este símbolo
    posiciones = stats.get("positions", [])
    for pos in posiciones:
        if pos.get("symbol") == symbol:
            return False, 0.0, f"ya hay posición abierta en {symbol}"

    # Calcular tamaño: min(max_pos_pct * patrimonio, saldo_util)
    max_pos = min(MAX_POS_PCT * patrimonio, saldo_util)
    # Escalar con conviction: más conviction → tamaño más cercano al máximo
    factor  = (conviction - UMBRAL_ENTRADA) / (100 - UMBRAL_ENTRADA)
    amount  = round(max_pos * (0.4 + 0.6 * factor), 2)
    amount  = max(10.0, amount)

    razon = (f"conviction {conviction}/100 · señal {signal} · "
             f"tamaño ${amount:.2f} ({amount/patrimonio*100:.1f}% patrimonio)")
    return True, amount, razon


# ── Lógica de salida ──────────────────────────────────────────────────────────

def evaluar_salidas(
    posiciones: list[dict],
    analisis_map: dict[str, dict],
) -> list[tuple[str, float, str]]:
    """
    Para cada posición abierta, decide si BT debe cerrarla.
    Retorna lista de (symbol, price, razon) para las que hay que vender.
    """
    salidas = []
    for pos in posiciones:
        symbol    = pos.get("symbol", "")
        analisis  = analisis_map.get(symbol)
        if not analisis:
            continue

        conviction = int(analisis.get("conviction_score", 50))
        signal     = analisis.get("signal", "")
        precio     = float(analisis.get("entry_price", 0))
        pnl_pct    = pos.get("pct", 0.0)

        razon = None

        # Señal girada a VENDER con conviction razonable
        if ("VENDER" in signal or "VENTA" in signal) and conviction >= UMBRAL_SALIDA_SIG:
            razon = f"señal girada a {signal} · conviction {conviction}/100"

        # Conviction caído muy por debajo del umbral de salida
        elif conviction < UMBRAL_SALIDA:
            razon = f"conviction colapsó a {conviction}/100 · señal sin dirección clara"

        # Take profit: posición en +15%
        elif pnl_pct >= 15.0:
            razon = f"take profit alcanzado: +{pnl_pct:.1f}%"

        # Stop loss: posición en -8%
        elif pnl_pct <= -8.0:
            razon = f"stop loss activado: {pnl_pct:.1f}%"

        if razon and precio > 0:
            salidas.append((symbol, precio, razon))

    return salidas


# ── Registro de decisiones ────────────────────────────────────────────────────

_LOG_KEY = "bt:autonomo_log:{user_id}"

def registrar_decision(user_id: str, tipo: str, symbol: str, amount: float, razon: str):
    if not redis_client:
        return
    entry = json.dumps({"tipo": tipo, "symbol": symbol, "amount": amount, "razon": razon})
    key   = _LOG_KEY.format(user_id=user_id)
    redis_client.lpush(key, entry)
    redis_client.ltrim(key, 0, 49)   # guardar últimas 50 decisiones
    redis_client.expire(key, 86400 * 30)


def obtener_log_autonomo(user_id: str) -> list[dict]:
    if not redis_client:
        return []
    raw = redis_client.lrange(_LOG_KEY.format(user_id=user_id), 0, 19)
    return [json.loads(r) for r in raw]
