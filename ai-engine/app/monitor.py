"""
monitor.py — MonitorFallos: registro de fallos por componente y estado de degradación.
"""
import threading
from datetime import datetime
from app.config import logger


class MonitorFallos:
    """
    Registra fallos consecutivos por componente y expone el estado
    de degradación para que el administrador pueda detectar problemas.
    """

    def __init__(self):
        self._fallos: dict = {}
        self._lock = threading.Lock()

    def registrar(self, componente: str, mensaje: str):
        with self._lock:
            entrada = self._fallos.get(componente, {"count": 0, "ultimo": None, "mensaje": ""})
            entrada["count"]  += 1
            entrada["ultimo"]  = datetime.utcnow().isoformat() + "Z"
            entrada["mensaje"] = mensaje
            self._fallos[componente] = entrada
        logger.warning(f"[{componente}] fallo #{entrada['count']}: {mensaje}")

    def limpiar(self, componente: str):
        with self._lock:
            self._fallos.pop(componente, None)

    def estado(self) -> dict:
        with self._lock:
            return dict(self._fallos)

    def degradado(self) -> bool:
        with self._lock:
            return any(v["count"] >= 3 for v in self._fallos.values())


# Instancia global
monitor_fallos = MonitorFallos()

# Registrar fallo inicial de Redis si no conectó
from app.config import redis_client
if redis_client is None:
    monitor_fallos.registrar("redis", "no disponible al arrancar")
