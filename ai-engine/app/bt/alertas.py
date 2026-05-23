"""
alertas.py — Alertas proactivas de BT.
Compara el estado actual del mercado con el anterior y genera alertas
cuando hay cambios significativos. Las almacena en Redis por usuario.
"""
import json
import time
from app.config import logger, redis_client

COOLDOWN_S   = 1800   # 30 min entre alertas del mismo símbolo
CONV_UMBRAL  = 72     # conviction mínimo para alertar señal
MOVIM_UMBRAL = 2.0    # % de movimiento rápido para alertar


def _en_cooldown(symbol: str) -> bool:
    if not redis_client:
        return False
    ts = redis_client.get(f"bt:cooldown:{symbol}")
    return bool(ts and (time.time() - float(ts)) < COOLDOWN_S)


def _marcar_cooldown(symbol: str) -> None:
    if redis_client:
        redis_client.setex(f"bt:cooldown:{symbol}", COOLDOWN_S, str(time.time()))


def _estado_anterior(symbol: str) -> dict:
    if not redis_client:
        return {}
    raw = redis_client.get(f"bt:estado:{symbol}")
    return json.loads(raw) if raw else {}


def _guardar_estado(symbol: str, estado: dict) -> None:
    if redis_client:
        redis_client.setex(f"bt:estado:{symbol}", 7200, json.dumps(estado))


def _mensaje_bt(symbol: str, tipo: str, datos: dict) -> str:
    coin = symbol.replace("USDT", "")
    precio = datos.get('precio', '?')
    if tipo == "señal_compra":
        rsi = datos.get('rsi', '?')
        reg = datos.get('regimen', '?')
        return (f"{coin} · Señal de compra. Conviction {datos['conviction']}/100 — "
                f"RSI {rsi}, régimen {reg}. Entrada en ${precio}.")
    if tipo == "señal_venta":
        return (f"{coin} · Señal de venta. Conviction {datos['conviction']}/100. "
                f"Precio actual: ${precio}. Considera cerrar posición.")
    if tipo == "fear_extremo":
        val = datos['valor']
        cls = datos['clasificacion']
        nota = "Históricamente una zona de acumulación." if val <= 20 else "El mercado está eufórico. Precaución."
        return (f"Fear & Greed en {val}/100 — {cls}. {nota}")
    if tipo == "movimiento_rapido":
        cambio = datos["cambio"]
        signo = "+" if cambio > 0 else ""
        dir_ = "sube" if cambio > 0 else "cae"
        return (f"{coin} {dir_} un {signo}{cambio:.2f}% en poco tiempo. "
                f"Precio: ${precio}. Revisa tu posición.")
    return f"{coin} — cambio detectado en el mercado."


def publicar_alerta(user_ids: list, symbol: str, tipo: str,
                    datos: dict, urgencia: int = 1) -> None:
    if not redis_client:
        return
    alerta = {
        "symbol":   symbol,
        "tipo":     tipo,
        "mensaje":  _mensaje_bt(symbol, tipo, datos),
        "urgencia": urgencia,
        "ts":       time.time(),
    }
    payload = json.dumps(alerta)
    for uid in user_ids:
        redis_client.rpush(f"bt:alertas:{uid}", payload)
        redis_client.expire(f"bt:alertas:{uid}", 7200)


def consumir_alerta(user_id: str) -> dict | None:
    if not redis_client:
        return None
    raw = redis_client.lpop(f"bt:alertas:{user_id}")
    return json.loads(raw) if raw else None


def evaluar_y_publicar(symbol: str, analisis: dict, user_ids: list) -> None:
    """Compara el análisis actual con el estado previo y publica alertas si procede."""
    if _en_cooldown(symbol) or not user_ids:
        return

    anterior   = _estado_anterior(symbol)
    signal     = analisis.get("signal", "")
    conviction = analisis.get("conviction_score", 0)
    precio     = float(analisis.get("entry_price", 0))
    ind        = analisis.get("indicators", {})
    fg         = analisis.get("fear_greed", {})
    alertado   = False

    if "COMPRAR" in signal and conviction >= CONV_UMBRAL:
        publicar_alerta(user_ids, symbol, "señal_compra", {
            "conviction": conviction, "precio": precio,
            "rsi": ind.get("rsi"), "regimen": ind.get("regimen"),
        }, urgencia=2)
        alertado = True
    elif "VENDER" in signal and conviction >= CONV_UMBRAL:
        publicar_alerta(user_ids, symbol, "señal_venta", {
            "conviction": conviction, "precio": precio,
        }, urgencia=2)
        alertado = True

    if not alertado and fg.get("valor") is not None:
        val     = fg["valor"]
        val_ant = anterior.get("fg_valor")
        era_ext = val_ant is not None and (val_ant <= 25 or val_ant >= 75)
        if (val <= 20 or val >= 80) and not era_ext:
            publicar_alerta(user_ids, symbol, "fear_extremo", {
                "valor": val, "clasificacion": fg.get("clasificacion", ""),
            }, urgencia=1)
            alertado = True

    if not alertado:
        precio_ant = anterior.get("precio")
        if precio_ant and precio_ant > 0:
            cambio = (precio - precio_ant) / precio_ant * 100
            if abs(cambio) >= MOVIM_UMBRAL:
                publicar_alerta(user_ids, symbol, "movimiento_rapido", {
                    "cambio": cambio, "precio": precio,
                }, urgencia=1)
                alertado = True

    if alertado:
        _marcar_cooldown(symbol)

    _guardar_estado(symbol, {
        "signal":     signal,
        "conviction": conviction,
        "precio":     precio,
        "fg_valor":   fg.get("valor"),
    })


def obtener_usuarios_activos() -> list:
    """Devuelve user_ids con actividad reciente (tienen perfil en Redis)."""
    if not redis_client:
        return []
    try:
        keys = redis_client.keys("bt:perfil:*")
        return [k.decode().replace("bt:perfil:", "") for k in keys]
    except Exception:
        return []
