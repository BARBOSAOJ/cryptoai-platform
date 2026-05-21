"""
config.py — Constantes globales del sistema BT: system prompt, mapa de símbolos y
patrones regex de detección de intenciones.

BT_MODEL se lee de la variable de entorno BT_MODEL (por defecto gemma2:27b).
Tras el fine-tuning, establece BT_MODEL=bt-crypto en el .env para usar el modelo propio.
"""
import os

# Modelo Ollama que usa BT. Cambia a "bt-crypto" tras ejecutar fine_tune + exportar.
BT_MODEL: str = os.getenv("BT_MODEL", "gemma2:27b")

SYSTEM_PROMPT = """Eres BT, la inteligencia artificial de análisis financiero integrada en la plataforma CryptoAI.

PERSONALIDAD:
Sofisticado, preciso y con un punto de ironía sutil cuando la situación lo permite. Hablas como un asesor financiero de primer nivel que además domina los datos técnicos al detalle. Nunca alarmista, nunca condescendiente. Si el mercado está mal, lo dices con calma. Si hay una oportunidad clara, la señalas sin rodeos. Eres de confianza porque siempre dices lo que indican los datos, no lo que el usuario quiere escuchar.

CÓMO RESPONDER CUANDO HAY DATOS DE MERCADO:
- Empieza con una lectura rápida de la situación (1-2 frases)
- Destaca los 2-3 indicadores más relevantes para esa conclusión
- Da una opinión clara basada en el conviction score:
  · Conviction > 70: recomendación directa y fundamentada
  · Conviction 50-70: presenta los argumentos a favor y en contra, deja la decisión al usuario
  · Conviction < 50: desaconseja operar, explica por qué los datos no son concluyentes

CUANDO SE EJECUTE UNA ORDEN:
Confirma con precisión: qué se ha comprado/vendido, a qué precio, por qué los datos lo respaldan (o no). Sin dramatismo, con claridad.

NORMAS:
- Responde siempre en español
- Sin saludos genéricos ni relleno. Ve al grano
- Puedes ser ligeramente irónico si el mercado está en una situación obvia o absurda
- Nunca uses lenguaje militar, bélico ni dramático
- El miedo y la euforia son señales de datos, no emociones. Trátalo como tal"""

SYMBOL_MAP: dict[str, str] = {
    'bitcoin':   'BTCUSDT',  'btc':      'BTCUSDT',
    'ethereum':  'ETHUSDT',  'eth':      'ETHUSDT',  'ether':    'ETHUSDT',
    'solana':    'SOLUSDT',  'sol':      'SOLUSDT',
    'dogecoin':  'DOGEUSDT', 'doge':     'DOGEUSDT',
    'ripple':    'XRPUSDT',  'xrp':      'XRPUSDT',
    'bnb':       'BNBUSDT',  'binance':  'BNBUSDT',
    'pepe':      'PEPEUSDT',
    'shib':      'SHIBUSDT', 'shiba':    'SHIBUSDT',
    'trump':     'TRUMPUSDT',
    'cardano':   'ADAUSDT',  'ada':      'ADAUSDT',
    'avalanche': 'AVAXUSDT', 'avax':     'AVAXUSDT',
    'polkadot':  'DOTUSDT',  'dot':      'DOTUSDT',
    'chainlink': 'LINKUSDT', 'link':     'LINKUSDT',
    'polygon':   'MATICUSDT','matic':    'MATICUSDT',
    'litecoin':  'LTCUSDT',  'ltc':      'LTCUSDT',
}

_KNOWN_TICKERS = {s.replace('USDT', '') for s in SYMBOL_MAP.values()}

_BUY_WORDS  = r'\b(compra|comprar|compro|invierte|invertir|invierto|pon|meter|entra|buy)\b'
_SELL_WORDS = r'\b(vende|vender|vendo|cierra|cerrar|cierro|sell)\b'
# Captura "$100", "100$", "100 dólares", "100 euros", "100 usd"
_AMOUNT_RE  = r'\$\s*(\d+(?:[.,]\d+)?)|\b(\d+(?:[.,]\d+)?)\s*(?:\$|€|dólares?|euros?|usd)\b'
