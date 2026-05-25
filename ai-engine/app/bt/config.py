"""
config.py — Constantes globales del sistema BT: system prompt, mapa de símbolos y
patrones regex de detección de intenciones.

BT_MODEL se lee de la variable de entorno BT_MODEL (por defecto gemma2:27b).
Tras el fine-tuning, establece BT_MODEL=bt-crypto en el .env para usar el modelo propio.
"""
import os

# Modelo Ollama que usa BT.
# bt-crypto = Phi-3.5-mini fine-tuned (3.8B, ~6s/resp). bt-base = qwen2.5:14b (~25s/resp).
BT_MODEL: str = os.getenv("BT_MODEL", "bt-crypto")

SYSTEM_PROMPT = """Eres BT, el sistema de inteligencia financiera de CryptoAI.

QUIÉN ERES:
El asesor cuantitativo que cualquier trader profesional desearía tener. No eres un chatbot — eres el sistema que lee el mercado en tiempo real y dice exactamente qué está pasando y qué hacer. Piensa en ti como Jarvis, pero especializado en mercados financieros: directo, preciso, con criterio propio y memoria activa de cada usuario.

FORMATO OBLIGATORIO cuando hay datos de mercado:
Línea 1 — Estado: [SÍMBOLO] [precio] · Señal [señal] · Conviction [n]/100
Línea 2-3 — Los 2-3 indicadores que justifican esa lectura (no todos, solo los que importan)
Línea 4 — Acción o nivel a vigilar: una instrucción concreta

Sin introducciones. Sin "según el análisis". Sin párrafos de relleno. Máximo 6 líneas.

ESCALA DE CONVICTION:
· >70 → recomendación directa con nivel de entrada y stop sugerido
· 50-70 → presenta el argumento a favor y el riesgo principal; sugiere esperar confirmación
· <50 → no hay setup claro; indica qué condición cambiaría eso

PERSONALIDAD:
- Usa el nombre del usuario cuando lo conoces. Si es su segunda sesión o más, menciónalo con naturalidad
- Seco, preciso, con ironía calibrada: cuando el mercado hace algo obvio o absurdo, lo señalas
- Siempre con números concretos: precios, niveles, porcentajes — nunca vaguedades
- Si el usuario razona mal, lo corriges con educación pero sin rodeos
- Referencia conversaciones anteriores cuando es relevante ("la semana pasada me preguntaste por SOL...")
- El Fear & Greed y el sentimiento Reddit son datos operativos, no emociones

ÓRDENES EJECUTADAS:
Confirma en una línea: activo, cantidad, precio, y si los datos lo respaldaban o no. Punto.

GESTIÓN DE CARTERA — SIEMPRE TIENES ACCESO AL ESTADO REAL:
Recibirás el contexto [CARTERA ACTUAL] con el patrimonio, saldo libre, posiciones abiertas y métricas de riesgo. Úsalo activamente:
- Cuando recomiendes una compra, menciona el tamaño sugerido (calculado con Kelly y perfil de riesgo) — nunca dejes al usuario sin un número concreto
- Si la exposición supera el límite del perfil, advierte antes de recomendar añadir más posiciones
- Si un activo ya representa >30% del patrimonio, señala el riesgo de concentración
- P&L flotante: si una posición abierta está en verde >10%, sugiere tomar parciales o mover el stop
- Si el win rate cae por debajo del 40%, recomienda reducir el tamaño de posición hasta recuperar consistencia
- Nunca ejecutes ni sugieras una operación que deje el saldo libre por debajo del 10% del patrimonio

NORMAS ABSOLUTAS:
- Siempre en español
- Sin markdown excesivo (listas solo si genuinamente ayudan)
- Sin lenguaje dramático ni militar
- Sin saludos genéricos al inicio de cada mensaje"""

# ── Mapa de símbolos ─────────────────────────────────────────────────────────
# Incluye nombres oficiales, tickers, apodos y variantes ortográficas comunes.
SYMBOL_MAP: dict[str, str] = {
    # ── Bitcoin ──────────────────────────────────────────────────────────────
    'bitcoin':      'BTCUSDT', 'btc':       'BTCUSDT',
    'bitcoins':     'BTCUSDT', 'bitcoincito':'BTCUSDT',
    'la naranja':   'BTCUSDT', 'oro digital':'BTCUSDT',

    # ── Ethereum ─────────────────────────────────────────────────────────────
    'ethereum':     'ETHUSDT', 'eth':        'ETHUSDT',
    'ether':        'ETHUSDT', 'ethereo':    'ETHUSDT',
    'etherum':      'ETHUSDT', 'etherion':   'ETHUSDT',

    # ── Solana ───────────────────────────────────────────────────────────────
    'solana':       'SOLUSDT', 'sol':        'SOLUSDT',
    'soly':         'SOLUSDT', 'solano':     'SOLUSDT',

    # ── BNB / Binance ─────────────────────────────────────────────────────────
    'bnb':          'BNBUSDT', 'binance':    'BNBUSDT',
    'binance coin': 'BNBUSDT', 'bnbcoin':    'BNBUSDT',

    # ── Ripple / XRP ─────────────────────────────────────────────────────────
    'ripple':       'XRPUSDT', 'xrp':        'XRPUSDT',
    'riple':        'XRPUSDT', 'rippl':      'XRPUSDT',

    # ── Dogecoin ─────────────────────────────────────────────────────────────
    'dogecoin':     'DOGEUSDT', 'doge':       'DOGEUSDT',
    'dogeito':      'DOGEUSDT', 'el perro':   'DOGEUSDT',
    'perro':        'DOGEUSDT',

    # ── Shiba Inu ─────────────────────────────────────────────────────────────
    'shib':         'SHIBUSDT', 'shiba':      'SHIBUSDT',
    'shiba inu':    'SHIBUSDT', 'shibu':      'SHIBUSDT',
    'shibacoin':    'SHIBUSDT',

    # ── PEPE ─────────────────────────────────────────────────────────────────
    'pepe':         'PEPEUSDT', 'pepecoin':   'PEPEUSDT',
    'pepe the frog':'PEPEUSDT',

    # ── Trump ─────────────────────────────────────────────────────────────────
    'trump':        'TRUMPUSDT', 'trumpcoin': 'TRUMPUSDT',

    # ── Cardano ──────────────────────────────────────────────────────────────
    'cardano':      'ADAUSDT', 'ada':         'ADAUSDT',

    # ── Avalanche ─────────────────────────────────────────────────────────────
    'avalanche':    'AVAXUSDT', 'avax':       'AVAXUSDT',

    # ── Polkadot ─────────────────────────────────────────────────────────────
    'polkadot':     'DOTUSDT', 'dot':         'DOTUSDT',

    # ── Chainlink ─────────────────────────────────────────────────────────────
    'chainlink':    'LINKUSDT', 'link':       'LINKUSDT',

    # ── Polygon ──────────────────────────────────────────────────────────────
    'polygon':      'MATICUSDT', 'matic':     'MATICUSDT',
    'pol':          'MATICUSDT',

    # ── Litecoin ─────────────────────────────────────────────────────────────
    'litecoin':     'LTCUSDT', 'ltc':         'LTCUSDT',

    # ── Cosmos ───────────────────────────────────────────────────────────────
    'cosmos':       'ATOMUSDT', 'atom':       'ATOMUSDT',

    # ── NEAR Protocol ────────────────────────────────────────────────────────
    'near':         'NEARUSDT', 'near protocol':'NEARUSDT',

    # ── Tron ─────────────────────────────────────────────────────────────────
    'tron':         'TRXUSDT', 'trx':         'TRXUSDT',

    # ── Uniswap ──────────────────────────────────────────────────────────────
    'uniswap':      'UNIUSDT', 'uni':         'UNIUSDT',

    # ── Aave ─────────────────────────────────────────────────────────────────
    'aave':         'AAVEUSDT',

    # ── Render ───────────────────────────────────────────────────────────────
    'render':       'RENDERUSDT', 'rndr':     'RENDERUSDT',

    # ── Injective ─────────────────────────────────────────────────────────────
    'injective':    'INJUSDT', 'inj':         'INJUSDT',

    # ── Arbitrum ─────────────────────────────────────────────────────────────
    'arbitrum':     'ARBUSDT', 'arb':         'ARBUSDT',

    # ── Optimism ─────────────────────────────────────────────────────────────
    'optimism':     'OPUSDT', 'op':           'OPUSDT',

    # ── Sui ──────────────────────────────────────────────────────────────────
    'sui':          'SUIUSDT',

    # ── Aptos ────────────────────────────────────────────────────────────────
    'aptos':        'APTUSDT', 'apt':         'APTUSDT',

    # ── TON ──────────────────────────────────────────────────────────────────
    'ton':          'TONUSDT', 'toncoin':     'TONUSDT',

    # ── WIF (dogwifhat) ───────────────────────────────────────────────────────
    'wif':          'WIFUSDT', 'dogwifhat':   'WIFUSDT', 'dogwif': 'WIFUSDT',

    # ── Bonk ─────────────────────────────────────────────────────────────────
    'bonk':         'BONKUSDT',

    # ── Floki ────────────────────────────────────────────────────────────────
    'floki':        'FLOKIUSDT',

    # ── Jupiter ──────────────────────────────────────────────────────────────
    'jupiter':      'JUPUSDT', 'jup':         'JUPUSDT',

    # ── Worldcoin ─────────────────────────────────────────────────────────────
    'worldcoin':    'WLDUSDT', 'wld':         'WLDUSDT',

    # ── Notcoin ───────────────────────────────────────────────────────────────
    'notcoin':      'NOTUSDT', 'not':         'NOTUSDT',

    # ── Popcat ───────────────────────────────────────────────────────────────
    'popcat':       'POPCATUSDT',

    # ── Fantom ───────────────────────────────────────────────────────────────
    'fantom':       'FTMUSDT', 'ftm':         'FTMUSDT',

    # ── Sei ──────────────────────────────────────────────────────────────────
    'sei':          'SEIUSDT',
}

_KNOWN_TICKERS = {s.replace('USDT', '') for s in SYMBOL_MAP.values()}

# ── Palabras de intención de compra ──────────────────────────────────────────
_BUY_WORDS = (
    r'\b('
    # Comprar
    r'compra|comprar|compro|comprame|cómprame|compramos|'
    # Invertir
    r'invierte|invertir|invierto|invierteme|inverteme|invirtame|'
    r'inviertelo|inviertela|inverti|invierta|invirtio|'
    # Poner/meter
    r'pon|ponme|ponlo|ponla|'
    r'meter|meteme|metamo|metelo|meta|'
    # Entrar
    r'entra|entrar|entro|entrame|entrale|'
    # Abrir posición
    r'abre\s+posicion|abrir\s+posicion|abre\s+largo|abrir\s+largo|'
    r'largo|ir\s+largo|'
    # Adquirir
    r'adquiere|adquirir|adquiero|adquiereme|'
    # Tomar/agarrar
    r'toma|tomar|tomo|tomame|'
    r'agarra|agarrar|agarro|agarrame|'
    # Coge (informal)
    r'coge|coger|cojo|cogeme|'
    # Executar
    r'ejecuta|ejecutar|ejecuto|ejecutame|'
    # Inglés
    r'buy|long|'
    # Frases compuestas
    r'quiero\s+comprar|quiero\s+invertir|quiero\s+entrar|'
    r'quiero\s+meter|quiero\s+poner|quiero\s+adquirir|'
    r'dame\s+(?:un|una)?\s*posicion'
    r')\b'
)

# ── Palabras de intención de venta ────────────────────────────────────────────
_SELL_WORDS = (
    r'\b('
    # Vender
    r'vende|vender|vendo|vendeme|'
    # Cerrar
    r'cierra|cerrar|cierro|cierrame|'
    # Salir
    r'sale|salir|salgo|sal\s+de|salgame|'
    # Liquidar
    r'liquida|liquidar|liquido|liquidame|'
    # Retirar/sacar
    r'retira|retirar|retiro|retirame|'
    r'saca|sacar|saco|sacame|'
    # Quitar/deshacer
    r'quita|quitar|quito|quitame|'
    r'deshaz|deshacer|'
    r'abandona|abandonar|abandono|'
    # Corto
    r'corto|short|ir\s+corto|abrir\s+corto|'
    # Inglés
    r'sell|'
    # Frases
    r'quiero\s+vender|quiero\s+cerrar|quiero\s+salir|'
    r'quiero\s+liquidar'
    r')\b'
)

# ── Regex de cantidad monetaria ───────────────────────────────────────────────
# Soporta: $100, 100$, 100 dólares, 100 euros, 100 usd, 1k usd (= 1000)
_AMOUNT_RE = (
    r'\$\s*(\d+(?:[.,]\d+)?)'                          # $100 o $ 100
    r'|\b(\d+(?:[.,]\d+)?)\s*k\b'                      # 1k, 2.5k (se multiplica por 1000 en código)
    r'|\b(\d+(?:[.,]\d+)?)\s*(?:\$|€|d[oó]lares?|euros?|usd|usdt)\b'  # 100$ / 100 dolares / 100 usd
)
