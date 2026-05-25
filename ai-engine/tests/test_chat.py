"""
Tests for chat.py domain logic: guardrail, UI action detection, LSTM direction.
All heavy dependencies (ollama, redis, postgres) are mocked at import time.
"""
import sys
import os
import types
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# ── Stub heavy imports before loading chat module ────────────────────────────

# redis stub
redis_mod = types.ModuleType('redis')
redis_mod.Redis = lambda **kw: None
redis_mod.ConnectionError = ConnectionError
sys.modules.setdefault('redis', redis_mod)

# ollama stub
ollama_mod = types.ModuleType('ollama')
sys.modules.setdefault('ollama', ollama_mod)

# app.config
import unittest.mock as _mock
with _mock.patch.dict('sys.modules', {
    'app.config':           _mock.MagicMock(logger=_mock.MagicMock(), redis_client=None, _has_ml=False),
    'app.bt.config':        _mock.MagicMock(BT_MODEL='test-model'),
    'app.bt.detectar':      _mock.MagicMock(detectar_simbolos=lambda m: [], detectar_intencion_trade=lambda m: None),
    'app.bt.contexto':      _mock.MagicMock(obtener_contexto_mercado=_mock.AsyncMock(return_value=('', {})),
                                             construir_track_record_contexto=lambda t: ''),
    'app.bt.ordenes':       _mock.MagicMock(ejecutar_orden=_mock.AsyncMock(return_value={})),
    'app.bt.historial':     _mock.MagicMock(obtener_track_record=lambda s: {},
                                             obtener_track_record_global=lambda: {}),
    'app.bt.alertas':       _mock.MagicMock(consumir_alerta=lambda u: None),
    'app.bt.memoria':       _mock.MagicMock(extraer_user_id=lambda t: 'anon',
                                             obtener_perfil=lambda u: {},
                                             registrar_sesion=lambda u: {},
                                             actualizar_perfil_desde_mensaje=lambda u, m, s: {},
                                             obtener_turnos_sesion_anterior=lambda u, n: [],
                                             guardar_turno=lambda u, r, c: None,
                                             construir_contexto_memoria=lambda u, p, n: ''),
    'app.bt.cartera':       _mock.MagicMock(obtener_estado_cartera=_mock.AsyncMock(return_value=({}, {})),
                                             calcular_riesgo=lambda c, s, r: {},
                                             construir_contexto_cartera=lambda c, s, r: ''),
    'app.bt.calibracion':   _mock.MagicMock(calcular_calibracion=lambda s, a: {},
                                             obtener_calibracion_por_simbolo=lambda s: {}),
}):
    from app.rutas.chat import _accion_ui, _es_consulta_financiera


# ── _es_consulta_financiera ───────────────────────────────────────────────────

class TestDomainGuardrail:
    def test_crypto_keywords_pass(self):
        assert _es_consulta_financiera("análisis de btc y eth") is True

    def test_bitcoin_keyword_passes(self):
        assert _es_consulta_financiera("¿Cómo está bitcoin hoy?") is True

    def test_portfolio_keyword_passes(self):
        assert _es_consulta_financiera("muéstrame mi cartera") is True

    def test_rsi_keyword_passes(self):
        assert _es_consulta_financiera("¿Qué indica el RSI ahora?") is True

    def test_trading_keyword_passes(self):
        assert _es_consulta_financiera("señal de trading en solana") is True

    def test_recipe_is_offtopic(self):
        assert _es_consulta_financiera("receta de pasta carbonara") is False

    def test_football_is_offtopic(self):
        assert _es_consulta_financiera("partido de fútbol esta noche") is False

    def test_weather_is_offtopic(self):
        assert _es_consulta_financiera("¿Cómo está el tiempo hoy?") is False

    def test_greetings_pass_by_default(self):
        """Greetings have no keyword either way — benefit of doubt."""
        assert _es_consulta_financiera("hola") is True

    def test_ambiguous_question_passes(self):
        assert _es_consulta_financiera("¿qué opinas de la situación actual?") is True

    def test_medicine_is_offtopic(self):
        assert _es_consulta_financiera("tengo síntoma de fiebre") is False


# ── _accion_ui ────────────────────────────────────────────────────────────────

class TestAccionUI:
    def test_grafica_with_symbol_returns_action(self):
        result = _accion_ui("pon la gráfica de btc", ["BTCUSDT"])
        assert result is not None
        assert result["action"] == "change_symbol"
        assert result["symbol"] == "BTCUSDT"

    def test_chart_word_returns_action(self):
        result = _accion_ui("show me the chart for ethereum", ["ETHUSDT"])
        assert result is not None
        assert result["symbol"] == "ETHUSDT"

    def test_muestrame_returns_action(self):
        result = _accion_ui("muéstrame solana", ["SOLUSDT"])
        assert result is not None
        assert result["action"] == "change_symbol"

    def test_no_symbol_returns_none(self):
        result = _accion_ui("pon la gráfica", [])
        assert result is None

    def test_no_nav_keyword_returns_none(self):
        result = _accion_ui("¿cómo está bitcoin?", ["BTCUSDT"])
        assert result is None

    def test_first_symbol_used_when_multiple(self):
        result = _accion_ui("ponme la gráfica", ["BTCUSDT", "ETHUSDT"])
        assert result["symbol"] == "BTCUSDT"

    def test_visualiza_triggers_action(self):
        result = _accion_ui("visualiza el precio de PEPE", ["PEPEUSDT"])
        assert result is not None

    def test_mostrar_triggers_action(self):
        result = _accion_ui("mostrar ETH", ["ETHUSDT"])
        assert result is not None

    def test_cambiar_triggers_action(self):
        result = _accion_ui("cambia a DOGE", ["DOGEUSDT"])
        assert result is not None

    def test_unrelated_sentence_no_nav_returns_none(self):
        result = _accion_ui("análisis técnico de bitcoin", ["BTCUSDT"])
        assert result is None
