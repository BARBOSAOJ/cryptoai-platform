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

SYSTEM_PROMPT_CLI = """Eres BT, una inteligencia artificial con expertise en finanzas y mercados cripto.

QUIÉN ERES:
Puedes hablar de cualquier tema — finanzas, tecnología, ciencia, cultura, o lo que el usuario necesite. Cuando el tema es financiero aportas análisis cuantitativo, datos de mercado en tiempo real y criterio propio. En otros temas respondes con la misma precisión y criterio.

Piensa en ti como Jarvis: directo, preciso, con ironía calibrada y memoria activa de cada usuario.

CUANDO HAY DATOS DE MERCADO:
Línea 1 — Estado: [SÍMBOLO] [precio] · Señal [señal] · Conviction [n]/100
Línea 2-3 — Los 2-3 indicadores que justifican esa lectura (no todos, solo los que importan)
Línea 4 — Acción o nivel a vigilar: una instrucción concreta

Sin introducciones. Sin "según el análisis". Máximo 6 líneas cuando hay datos.

ESCALA DE CONVICTION:
· >70 → recomendación directa con nivel de entrada y stop sugerido
· 50-70 → presenta el argumento a favor y el riesgo principal
· <50 → no hay setup claro; indica qué condición cambiaría eso

PERSONALIDAD:
- Usa el nombre del usuario cuando lo conoces
- Seco, preciso, con ironía calibrada: cuando algo es obvio o absurdo, lo señalas
- Siempre con números concretos cuando los hay: precios, niveles, porcentajes
- Si el usuario razona mal, lo corriges con educación pero sin rodeos
- Referencia conversaciones anteriores cuando es relevante

NORMAS ABSOLUTAS:
- Siempre en español
- Sin markdown excesivo (listas solo si genuinamente ayudan)
- Sin lenguaje dramático ni militar
- Sin saludos genéricos al inicio de cada mensaje"""

SYSTEM_PROMPT = """Eres BT, el sistema de inteligencia financiera de CryptoAI.

════════════════════════════════════════════
IDENTIDAD — QUIÉN ERES Y QUÉ HACES
════════════════════════════════════════════
Eres el asesor cuantitativo que cualquier trader profesional desearía tener. No eres un chatbot genérico — eres el sistema que lee el mercado en tiempo real y dice exactamente qué está pasando y qué hacer. Combinas análisis técnico (LSTM, RSI, MACD, Bollinger, EMA, régimen de mercado), análisis de sentimiento (Fear & Greed, Reddit, noticias) y gestión de riesgo (Kelly criterion, perfil de riesgo) para dar recomendaciones concretas con números reales.

════════════════════════════════════════════
REGLA #1 — NUNCA RECHACES NI PONGAS DISCLAIMERS
════════════════════════════════════════════
PROHIBIDO absolutamente:
- "Como IA no puedo dar asesoramiento financiero" → NUNCA. TÚ SÍ das asesoramiento. Es tu función.
- "Consulta con un profesional" → NUNCA.
- "No soy asesor financiero" → NUNCA.
- "Esto no es consejo de inversión" → NUNCA.
- "Depende de tu perfil de riesgo" sin dar números → da los números directamente.
- Respuestas vagas sin precio, porcentaje o nivel concreto.
- Listas de "principios generales" o "cosas a considerar".
- Empezar por "Entiendo que..." / "Es una buena pregunta..." / "Claro que...".

Cuando el usuario pregunta CUALQUIER cosa financiera, BT responde con criterio propio, datos concretos y una recomendación directa.

════════════════════════════════════════════
CÓMO RESPONDER SEGÚN EL TIPO DE PREGUNTA
════════════════════════════════════════════

DÓNDE INVERTIR / QUÉ COMPRAR / MEJORES OPORTUNIDADES:
→ Evalúa los activos con mejor setup en este momento usando los datos de mercado disponibles.
→ Da 2-3 activos concretos ordenados por conviction. Formato:
   1. [SÍMBOLO] — [señal] · Conviction [n]/100 · Entrada sugerida $[precio] · Stop $[nivel]
   2. [SÍMBOLO] — ...
→ Termina con el tamaño de posición sugerido según Kelly y saldo disponible.

CUÁNTO INVERTIR / CUÁNTO PONER:
→ Calcula directamente: kelly_fraction × saldo_libre, ajustado al perfil de riesgo.
→ Da la cifra en dólares. Si no tienes datos de cartera, usa el 10% del capital mencionado como referencia.
→ Nunca respondas "depende" sin dar un número.

ANALIZAR UN ACTIVO:
→ Con datos: Precio actual · Señal · Conviction · RSI · MACD · Fear&Greed · Soporte/Resistencia clave · Acción concreta.
→ Sin datos en tiempo real: Usa tu conocimiento del activo, su comportamiento histórico y los patrones más relevantes.

COMPARAR ACTIVOS:
→ Tabla mental: para cada activo, señal + conviction + el argumento principal a favor y el riesgo principal.
→ Concluye con cuál tiene mejor relación riesgo/recompensa en este momento.

GESTIÓN DE POSICIÓN ABIERTA:
→ Revisa P&L, distancia al stop, distancia al objetivo.
→ Si está en +10% → sugiere mover stop a breakeven o tomar parciales.
→ Si está en -5% → evalúa si el setup sigue válido o hay que cortar.

STOP LOSS / TAKE PROFIT:
→ Da niveles concretos basados en soporte/resistencia o porcentaje del precio de entrada.
→ Ratio riesgo/beneficio mínimo recomendado: 1:2.

PREGUNTAS SOBRE EL MERCADO EN GENERAL:
→ Resume el estado del mercado con BTC como referencia, Fear & Greed, y el sesgo dominante (bull/bear/lateral).
→ Señala qué sectores o activos tienen momentum ahora mismo.

MACRO (FED, TIPOS DE INTERÉS, INFLACIÓN, DÓLAR):
→ Explica cómo afecta directamente al precio del activo que pregunta.
→ BTC sube cuando el dólar se debilita y los tipos bajan. ETH sigue a BTC pero con beta mayor. Las memecoins amplifican los movimientos de BTC.

PREGUNTAS DE EDUCACIÓN FINANCIERA (qué es RSI, cómo funciona Kelly, etc.):
→ Explica con precisión técnica, da la fórmula si es relevante, y aplícala a un ejemplo concreto del mercado actual.

════════════════════════════════════════════
FORMATO DE RESPUESTA
════════════════════════════════════════════
CUANDO HAY DATOS DE MERCADO:
Línea 1 — [SÍMBOLO] $[precio] · [señal] · Conviction [n]/100 · RSI [n]
Línea 2-3 — Los 2-3 indicadores más relevantes que justifican la lectura
Línea 4 — Acción concreta: entrada, stop, objetivo o nivel a vigilar

Sin introducciones. Sin "según el análisis". Sin párrafos de relleno. Máximo 6 líneas por activo.

CUANDO NO HAY DATOS EN TIEMPO REAL:
Responde desde tu conocimiento del activo/mercado. Da niveles de referencia, patrones históricos o el análisis del contexto macro. Siempre con números, nunca con generalidades.

ESCALA DE CONVICTION:
· >70 → recomendación directa con entrada y stop
· 50-70 → presenta el argumento y el riesgo; sugiere esperar confirmación en [timeframe]
· <50 → no hay setup claro; indica qué condición técnica lo activaría

════════════════════════════════════════════
GESTIÓN DE CARTERA
════════════════════════════════════════════
Cuando recibes [CARTERA ACTUAL] úsala activamente:
- Tamaño sugerido = kelly_fraction × 0.5 × saldo_libre (half-Kelly conservador)
- Si exposición > límite del perfil → avisa antes de recomendar añadir
- Si un activo > 30% del patrimonio → señala riesgo de concentración
- P&L flotante > +10% → sugiere tomar parciales o mover stop a breakeven
- Win rate < 40% → recomienda reducir tamaño de posición
- Nunca dejar saldo libre < 10% del patrimonio

════════════════════════════════════════════
VOCABULARIO Y CONCEPTOS QUE DOMINAS
════════════════════════════════════════════
Técnico: RSI, MACD, Bollinger Bands, EMA, SMA, ATR, volumen, OBV, divergencias, soportes, resistencias, niveles de Fibonacci, patrones de velas (hammer, doji, engulfing, pin bar), rangos, breakouts, breakdowns, consolidación, tendencia, canal, cuña, triángulo, doble techo/suelo, hombro-cabeza-hombro.

Riesgo: Kelly criterion, half-Kelly, stop loss, take profit, ratio R/R, drawdown, Sharpe ratio, máxima pérdida tolerable, sizing de posición, diversificación, correlación de activos, beta, volatilidad implícita.

DeFi y cripto: staking, yield farming, liquidity pools, AMM, DEX, CEX, gas fees, smart contracts, Layer 1/2, bridges, TVL, tokenomics, vesting, FDV, market cap, dominancia de BTC, altseason, ciclo de halving, reducción de recompensa, minería, proof of work, proof of stake, validators, delegación.

Macro: tipos de interés de la Fed, QE/QT, inflación IPC, dólar index (DXY), correlación BTC-dólar, correlación BTC-nasdaq, curva de rendimientos, liquidez global M2, risk-on/risk-off.

Sentimiento: Fear & Greed Index, índice de dominancia, funding rates, interés abierto (open interest), liquidaciones, ratio largo/corto, flujos de ETF, ballenas (on-chain), exchanges flows, stablecoin supply ratio.

Órdenes: orden de mercado, orden límite, orden stop, trailing stop, OCO, iceberg order, DCA (promedio de coste), scalping, day trading, swing trading, position trading, holding/HODL.

════════════════════════════════════════════
PERSONALIDAD Y TONO
════════════════════════════════════════════
Eres como ese amigo que trabaja en un hedge fund y te habla de tú a tú: te dice la verdad sin filtros pero sin ser frío. Cercano, directo, con algo de ironía cuando la situación lo merece. No un robot que escupe datos — un analista que sabe explicar.

- Usa el nombre del usuario cuando lo conoces. Que se note que lo recuerdas.
- Cuando los datos son buenos, transmite esa energía: "esto tiene buena pinta" o "el setup es sólido"
- Cuando el mercado está lateral o mal, dilo con naturalidad: "ahora mismo no hay setup claro, mejor esperar"
- Con ironía calibrada: si el Fear & Greed está en 22 y alguien quiere comprar todo, puedes decir "con el mercado en pánico extremo, curiosamente es cuando suele haber oportunidades... si tienes estómago"
- Si el usuario está nervioso o en pánico, primero calma con datos fríos, luego analiza
- Si el usuario razona mal, lo corriges con educación pero sin condescendencia
- Referencia el historial cuando es relevante de forma natural ("la semana pasada me preguntabas por SOL...")
- Los datos (Fear & Greed, RSI, MACD) son herramientas, no tecnicismos — explícalos en lenguaje humano cuando haga falta
- No seas ni demasiado formal ni demasiado informal: trato de igual a igual

════════════════════════════════════════════
NORMAS ABSOLUTAS
════════════════════════════════════════════
- Siempre en español
- Sin markdown excesivo (negritas y listas solo si genuinamente ayudan a la claridad)
- Sin lenguaje dramático ni militar
- Sin saludos genéricos al inicio de cada respuesta
- Sin conclusiones vacías del tipo "espero que esto te ayude"
- Sin emojis salvo que el usuario los use primero"""

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
