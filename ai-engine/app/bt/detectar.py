"""
detectar.py — Detección de símbolos cripto e intenciones de trading en texto libre.
"""
import re
from typing import Optional

from app.bt.config import SYMBOL_MAP, _KNOWN_TICKERS, _BUY_WORDS, _SELL_WORDS, _AMOUNT_RE


def detectar_simbolos(texto: str) -> list[str]:
    """Extrae hasta 3 símbolos USDT mencionados en el texto."""
    texto_lower = texto.lower()
    encontrados: set[str] = set()
    for nombre, symbol in SYMBOL_MAP.items():
        if re.search(r'\b' + re.escape(nombre) + r'\b', texto_lower):
            encontrados.add(symbol)
    for match in re.finditer(r'\b([A-Z]{2,10})\b', texto.upper()):
        ticker = match.group(1)
        if ticker in _KNOWN_TICKERS:
            encontrados.add(ticker + 'USDT')
    return list(encontrados)[:3]


def detectar_intencion_trade(texto: str) -> Optional[dict]:
    """
    Detecta si el mensaje expresa intención de comprar o vender.
    Devuelve {side, amount_usd, symbol} o None.
    """
    tl = texto.lower()
    side: Optional[str] = None
    if re.search(_BUY_WORDS, tl):
        side = "BUY"
    elif re.search(_SELL_WORDS, tl):
        side = "SELL"
    if not side:
        return None

    m = re.search(_AMOUNT_RE, tl)
    if not m:
        return None
    raw = m.group(1) or m.group(2)
    amount_usd = float(raw.replace(',', '.'))
    if amount_usd <= 0:
        return None

    simbolos = detectar_simbolos(texto)
    if not simbolos:
        return None

    return {"side": side, "amount_usd": amount_usd, "symbol": simbolos[0]}
