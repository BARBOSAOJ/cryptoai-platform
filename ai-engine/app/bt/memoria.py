"""
memoria.py — Memoria persistente de BT entre sesiones.
Guarda perfil del usuario, historial de conversación y preferencias
inferidas a partir de los mensajes. Todo en Redis con TTL de 30 días.
"""
import json
import re
import time
import base64
from app.config import logger, redis_client

TTL        = 30 * 86400   # 30 días
MAX_TURNOS = 30            # turnos guardados por usuario


# ─── JWT helpers ──────────────────────────────────────────────────────────────

def extraer_user_id(token: str) -> str:
    """Extrae el identificador de usuario del payload JWT sin verificar firma."""
    try:
        payload_b64 = token.split('.')[1]
        payload_b64 += '=' * (-len(payload_b64) % 4)
        payload = json.loads(base64.b64decode(payload_b64))
        uid = payload.get('upn') or payload.get('sub') or payload.get('id')
        return str(uid) if uid else 'anon'
    except Exception:
        return 'anon'


# ─── Perfil ───────────────────────────────────────────────────────────────────

_PERFIL_DEFAULT = {
    "nombre":         None,
    "activos":        {},      # {symbol: menciones}
    "riesgo":         None,    # "conservador" | "moderado" | "agresivo"
    "horizonte":      None,    # "corto" | "medio" | "largo"
    "notas":          [],
    "primera_sesion": None,
    "ultima_sesion":  None,
    "num_sesiones":   0,
}

_RE_NOMBRE = re.compile(r'\b(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)', re.I)
_RE_RIESGO = re.compile(r'\b(conservador|arriesgar poco|bajo riesgo|agresivo|arriesgar (?:más|mucho)|alto riesgo|moderado)\b', re.I)
_RE_PLAZO  = re.compile(r'\b(corto plazo|scalping|day trad|intradía|swing|semanas|largo plazo|hodl|meses|años)\b', re.I)


def obtener_perfil(user_id: str) -> dict:
    if not redis_client:
        return dict(_PERFIL_DEFAULT)
    try:
        raw = redis_client.get(f"bt:perfil:{user_id}")
        return json.loads(raw) if raw else dict(_PERFIL_DEFAULT)
    except Exception:
        return dict(_PERFIL_DEFAULT)


def guardar_perfil(user_id: str, perfil: dict) -> None:
    if not redis_client:
        return
    try:
        redis_client.setex(f"bt:perfil:{user_id}", TTL, json.dumps(perfil))
    except Exception as e:
        logger.warning(f"BT memoria — error guardando perfil: {e}")


def actualizar_perfil_desde_mensaje(user_id: str, mensaje: str, simbolos: list) -> dict:
    """Infiere preferencias del mensaje y actualiza el perfil persistido."""
    perfil = obtener_perfil(user_id)

    m = _RE_NOMBRE.search(mensaje)
    if m and not perfil["nombre"]:
        perfil["nombre"] = m.group(1).capitalize()

    for sym in simbolos:
        perfil["activos"][sym] = perfil["activos"].get(sym, 0) + 1

    m = _RE_RIESGO.search(mensaje)
    if m:
        txt = m.group(1).lower()
        if any(w in txt for w in ("conservador", "poco", "bajo")):
            perfil["riesgo"] = "conservador"
        elif any(w in txt for w in ("agresivo", "más", "mucho", "alto")):
            perfil["riesgo"] = "agresivo"
        else:
            perfil["riesgo"] = "moderado"

    m = _RE_PLAZO.search(mensaje)
    if m:
        txt = m.group(1).lower()
        if any(w in txt for w in ("corto", "scalp", "day", "intradía")):
            perfil["horizonte"] = "corto"
        elif any(w in txt for w in ("swing", "semanas")):
            perfil["horizonte"] = "medio"
        else:
            perfil["horizonte"] = "largo"

    guardar_perfil(user_id, perfil)
    return perfil


def registrar_sesion(user_id: str) -> dict:
    """Incrementa el contador de sesiones y actualiza timestamps."""
    perfil = obtener_perfil(user_id)
    ahora = time.time()
    if not perfil["primera_sesion"]:
        perfil["primera_sesion"] = ahora
    perfil["ultima_sesion"] = ahora
    perfil["num_sesiones"]  = perfil.get("num_sesiones", 0) + 1
    guardar_perfil(user_id, perfil)
    return perfil


# ─── Historial de conversación ────────────────────────────────────────────────

def guardar_turno(user_id: str, role: str, content: str) -> None:
    """Persiste un turno de conversación (máx. MAX_TURNOS por usuario)."""
    if not redis_client or not content:
        return
    try:
        key = f"bt:conv:{user_id}"
        raw = redis_client.get(key)
        turnos = json.loads(raw) if raw else []
        turnos.append({"role": role, "content": content[:800], "ts": time.time()})
        redis_client.setex(key, TTL, json.dumps(turnos[-MAX_TURNOS:]))
    except Exception as e:
        logger.warning(f"BT memoria — error guardando turno: {e}")


def obtener_turnos_sesion_anterior(user_id: str, n: int = 6) -> list:
    """Devuelve los últimos N turnos de sesiones anteriores."""
    if not redis_client:
        return []
    try:
        raw = redis_client.get(f"bt:conv:{user_id}")
        if not raw:
            return []
        turnos = json.loads(raw)
        return [{"role": t["role"], "content": t["content"]} for t in turnos[-n:]]
    except Exception:
        return []


# ─── Contexto para el LLM ─────────────────────────────────────────────────────

def construir_contexto_memoria(user_id: str, perfil: dict, es_nueva_sesion: bool) -> str:
    """Genera el bloque de contexto que BT recibe sobre el usuario."""
    lineas = []
    if perfil["nombre"]:
        lineas.append(f"El usuario se llama {perfil['nombre']}.")
    if perfil.get("num_sesiones", 0) > 1:
        lineas.append(f"Es su sesión número {perfil['num_sesiones']} contigo.")
    if perfil["riesgo"]:
        lineas.append(f"Tolerancia al riesgo: {perfil['riesgo']}.")
    if perfil["horizonte"]:
        lineas.append(f"Horizonte de inversión preferido: {perfil['horizonte']} plazo.")
    if perfil["activos"]:
        top = sorted(perfil["activos"].items(), key=lambda x: x[1], reverse=True)[:3]
        lineas.append(f"Activos que más sigue: {', '.join(s for s, _ in top)}.")
    if perfil.get("notas"):
        lineas.append("Notas anteriores: " + " | ".join(perfil["notas"][-3:]))

    if not lineas:
        return ""

    prefijo = "[CONTEXTO DE SESIÓN ANTERIOR — usa esto para personalizar tu respuesta]\n" \
              if es_nueva_sesion else "[PERFIL DEL USUARIO]\n"
    return prefijo + "\n".join(lineas)
