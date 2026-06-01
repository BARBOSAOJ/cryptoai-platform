"""
Tests for detectar.py — symbol detection, trade intent, accent normalization, fuzzy matching.
"""
import sys
import os
import unittest.mock as _mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app.config as _cfg
_cfg._has_ml = False

import pytest
from app.bt.detectar import detectar_simbolos, detectar_intencion_trade, _normalizar


# ── _normalizar ───────────────────────────────────────────────────────────────

class TestNormalizar:
    def test_strips_acute_accents(self):
        assert _normalizar('Dólares') == 'dolares'

    def test_strips_all_diacritics(self):
        assert _normalizar('ínvierte ésto') == 'invierte esto'

    def test_lowercases(self):
        assert _normalizar('BITCOIN') == 'bitcoin'

    def test_no_op_on_clean_text(self):
        assert _normalizar('solana 100 usd') == 'solana 100 usd'


# ── detectar_simbolos ─────────────────────────────────────────────────────────

class TestDetectarSimbolos:
    def test_exact_name_bitcoin(self):
        assert 'BTCUSDT' in detectar_simbolos('analiza bitcoin')

    def test_exact_name_solana(self):
        assert 'SOLUSDT' in detectar_simbolos('¿cómo está solana?')

    def test_ticker_uppercase(self):
        assert 'BTCUSDT' in detectar_simbolos('BTC está en máximos')

    def test_multiple_symbols(self):
        syms = detectar_simbolos('bitcoin y ethereum')
        assert 'BTCUSDT' in syms
        assert 'ETHUSDT' in syms

    def test_fuzzy_slana_to_solana(self):
        assert 'SOLUSDT' in detectar_simbolos('slana está subiendo')

    def test_fuzzy_bticoin_to_bitcoin(self):
        assert 'BTCUSDT' in detectar_simbolos('compra bticoin')

    def test_no_false_positives_on_random_text(self):
        result = detectar_simbolos('hola como estas')
        assert result == []

    def test_max_three_symbols(self):
        result = detectar_simbolos('bitcoin ethereum solana doge btc eth sol')
        assert len(result) <= 3


# ── detectar_intencion_trade ──────────────────────────────────────────────────

class TestDetectarIntencionTrade:
    # ── buy variants ──────────────────────────────────────────────────────────

    def test_original_failing_case(self):
        r = detectar_intencion_trade('inivertene 100 dolares en slana')
        assert r is not None
        assert r['side'] == 'BUY'
        assert r['amount_usd'] == 100.0
        assert r['symbol'] == 'SOLUSDT'

    def test_invierte_dolares(self):
        r = detectar_intencion_trade('invierte 50 dolares en bitcoin')
        assert r == {'side': 'BUY', 'amount_usd': 50.0, 'symbol': 'BTCUSDT', 'full_position': False}

    def test_invierteme_usd(self):
        r = detectar_intencion_trade('invierteme 200 usd en eth')
        assert r['side'] == 'BUY' and r['amount_usd'] == 200.0

    def test_inverteme_dolares_slana(self):
        r = detectar_intencion_trade('inverteme 300 dolares en slana')
        assert r['side'] == 'BUY' and r['symbol'] == 'SOLUSDT'

    def test_compra_euros(self):
        r = detectar_intencion_trade('compra 75 euros de doge')
        assert r['side'] == 'BUY' and r['amount_usd'] == 75.0

    def test_ponme_dolares(self):
        r = detectar_intencion_trade('ponme 100 dolares en solana')
        assert r is not None and r['side'] == 'BUY'

    def test_buy_usd(self):
        r = detectar_intencion_trade('buy 500 usd sol')
        assert r['side'] == 'BUY' and r['amount_usd'] == 500.0

    def test_dollar_sign_prefix(self):
        r = detectar_intencion_trade('compra $150 de btc')
        assert r is not None and r['amount_usd'] == 150.0

    def test_quiero_comprar(self):
        r = detectar_intencion_trade('quiero comprar 150 dolares de eth')
        assert r is not None and r['side'] == 'BUY'

    def test_dólares_with_accent(self):
        r = detectar_intencion_trade('invierte 80 dólares en btc')
        assert r is not None and r['amount_usd'] == 80.0

    # ── sell variants ─────────────────────────────────────────────────────────

    def test_vende_dolares(self):
        r = detectar_intencion_trade('vende 100 dolares de btc')
        assert r['side'] == 'SELL' and r['symbol'] == 'BTCUSDT'

    def test_cierra_posicion(self):
        r = detectar_intencion_trade('cierra 50 usd de eth')
        assert r is not None and r['side'] == 'SELL'

    # ── should return None ────────────────────────────────────────────────────

    def test_no_amount_returns_none(self):
        assert detectar_intencion_trade('compra solana') is None

    def test_no_symbol_returns_none(self):
        assert detectar_intencion_trade('compra 100 dolares') is None

    def test_question_no_intent(self):
        assert detectar_intencion_trade('¿cómo está bitcoin?') is None

    def test_greeting_no_intent(self):
        assert detectar_intencion_trade('hola como estas') is None

    def test_analysis_request_no_intent(self):
        assert detectar_intencion_trade('analisis de solana') is None

    def test_zero_amount_returns_none(self):
        assert detectar_intencion_trade('compra 0 dolares de btc') is None
