"""
detectar.py — Detección de símbolos cripto e intenciones de trading en texto libre.
"""
import re
import unicodedata
from difflib import get_close_matches
from typing import Optional

from app.bt.config import SYMBOL_MAP, _KNOWN_TICKERS, _BUY_WORDS, _SELL_WORDS, _AMOUNT_RE

# Palabras canónicas usadas para fuzzy fallback de intención de trade
_BUY_STEMS  = ['compra', 'comprar', 'invierte', 'invertir', 'invierteme',
               'inverteme', 'ponme', 'entra', 'buy']
_SELL_STEMS = ['vende', 'vender', 'cierra', 'cerrar', 'sell']


def _normalizar(texto: str) -> str:
    """Minúsculas + elimina diacríticos (ó→o, é→e, ú→u…)."""
    nfkd = unicodedata.normalize('NFKD', texto.lower())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def detectar_simbolos(texto: str) -> list[str]:
    """
    Extrae hasta 3 símbolos USDT mencionados en el texto.
    Primero busca coincidencias exactas en SYMBOL_MAP, luego tickers en mayúsculas,
    y finalmente usa difflib como fallback fuzzy (corta typos como 'slana'→'solana').
    """
    norm     = _normalizar(texto)
    encontrados: set[str] = set()

    # Exact matches en SYMBOL_MAP (ya sin acentos en las claves)
    for nombre, symbol in SYMBOL_MAP.items():
        if re.search(r'\b' + re.escape(nombre) + r'\b', norm):
            encontrados.add(symbol)

    # Tickers en mayúsculas (BTC, ETH, SOL…)
    for match in re.finditer(r'\b([A-Z]{2,10})\b', texto.upper()):
        ticker = match.group(1)
        if ticker in _KNOWN_TICKERS:
            encontrados.add(ticker + 'USDT')

    # Fuzzy fallback — ayuda con typos tipo "slana" → "solana"
    # Requiere ≥5 chars para evitar que palabras comunes ("como") hagan match con nombres cortos
    if not encontrados:
        palabras = re.findall(r'\b[a-z]{5,}\b', norm)
        for palabra in palabras:
            matches = get_close_matches(palabra, SYMBOL_MAP.keys(), n=1, cutoff=0.78)
            if matches:
                encontrados.add(SYMBOL_MAP[matches[0]])
                break  # un símbolo fuzzy ya es suficiente

    return list(encontrados)[:3]


def detectar_intencion_trade(texto: str) -> Optional[dict]:
    """
    Detecta si el mensaje expresa intención de comprar o vender.
    Devuelve {side, amount_usd, symbol, full_position} o None.
    full_position=True cuando se pide cerrar la posición completa sin especificar monto.
    """
    norm = _normalizar(texto)

    side: Optional[str] = None
    if re.search(_BUY_WORDS, norm):
        side = "BUY"
    elif re.search(_SELL_WORDS, norm):
        side = "SELL"

    # Fuzzy fallback — captura typos graves como "inivertene" → "inverteme"
    if not side:
        palabras = re.findall(r'\b[a-z]{4,}\b', norm)
        for palabra in palabras:
            if get_close_matches(palabra, _BUY_STEMS, n=1, cutoff=0.72):
                side = "BUY"; break
            if get_close_matches(palabra, _SELL_STEMS, n=1, cutoff=0.72):
                side = "SELL"; break

    if not side:
        return None

    simbolos = detectar_simbolos(texto)
    if not simbolos:
        return None

    # Buscar monto explícito
    m = re.search(_AMOUNT_RE, norm)
    if m:
        raw = m.group(1) or m.group(2) or m.group(3)
        if raw:
            amount_usd = float(raw.replace(',', '.'))
            if m.group(2):
                amount_usd *= 1000
            if amount_usd > 0:
                return {"side": side, "amount_usd": amount_usd,
                        "symbol": simbolos[0], "full_position": False}

    # Sin monto → solo válido para SELL (cerrar posición completa)
    if side == "SELL":
        return {"side": "SELL", "amount_usd": 0.0,
                "symbol": simbolos[0], "full_position": True}

    return None
