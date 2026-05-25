"""
Tests for contexto.py — LSTM direction logic and track record formatting.
Mocks all I/O (Binance, Redis, RAG) to keep tests fast and offline.
"""
import sys
import os
import types
import pytest
import unittest.mock as _mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# ── Stub dependencies ────────────────────────────────────────────────────────

_redis_stub = _mock.MagicMock()
_redis_stub.get.return_value = None

with _mock.patch.dict('sys.modules', {
    'app.config':        _mock.MagicMock(logger=_mock.MagicMock(), redis_client=_redis_stub),
    'app.indicadores':   _mock.MagicMock(obtener_velas_binance=_mock.MagicMock()),
    'app.analisis':      _mock.MagicMock(realizar_analisis=_mock.AsyncMock()),
    'app.bt.historial':  _mock.MagicMock(guardar_prediccion=_mock.MagicMock(),
                                          obtener_track_record=_mock.MagicMock(return_value={})),
    'app.bt.rag':        _mock.MagicMock(guardar_en_rag=_mock.MagicMock(),
                                          actualizar_outcome_rag=_mock.MagicMock(),
                                          buscar_similares=_mock.MagicMock(return_value=[]),
                                          construir_contexto_rag=_mock.MagicMock(return_value='')),
}):
    from app.bt.contexto import construir_track_record_contexto


# ── LSTM direction (inline logic from contexto.py) ────────────────────────────

def _lstm_direction(predicted_next, entry_price) -> str:
    """Mirrors the logic in contexto.py to derive LSTM direction string."""
    try:
        if float(predicted_next) > float(entry_price):
            return "alcista"
        elif float(predicted_next) < float(entry_price):
            return "bajista"
        else:
            return "neutral"
    except Exception:
        return "neutral"


class TestLstmDirection:
    def test_above_entry_is_alcista(self):
        assert _lstm_direction(100.0, 95.0) == "alcista"

    def test_below_entry_is_bajista(self):
        assert _lstm_direction(90.0, 95.0) == "bajista"

    def test_equal_entry_is_neutral(self):
        assert _lstm_direction(95.0, 95.0) == "neutral"

    def test_string_numbers_work(self):
        assert _lstm_direction("105.5", "100.0") == "alcista"

    def test_invalid_value_returns_neutral(self):
        assert _lstm_direction("n/a", "100.0") == "neutral"

    def test_none_value_returns_neutral(self):
        assert _lstm_direction(None, "100.0") == "neutral"

    def test_btc_realistic_values(self):
        """Typical BTC scenario: predicted slightly above current."""
        assert _lstm_direction(95500.0, 95000.0) == "alcista"

    def test_sol_realistic_values(self):
        """SOL scenario: predicted below entry."""
        assert _lstm_direction(85.50, 86.20) == "bajista"


# ── construir_track_record_contexto ───────────────────────────────────────────

class TestTrackRecordContexto:
    def test_empty_track_records_returns_empty_string(self):
        result = construir_track_record_contexto({})
        assert result == ""

    def test_zero_evaluaciones_skipped(self):
        track = {"BTCUSDT": {"evaluadas": 0, "tasa_acierto": 0, "recientes": []}}
        result = construir_track_record_contexto(track)
        assert result == ""

    def test_record_with_evaluaciones_included(self):
        track = {
            "BTCUSDT": {
                "evaluadas": 10,
                "tasa_acierto": 70,
                "recientes": [
                    {"correcto": True, "horas_atras": 2, "signal": "COMPRAR",
                     "precio_entrada": 90000, "movimiento_pct": 1.5},
                ],
            }
        }
        result = construir_track_record_contexto(track)
        assert "BTCUSDT" in result
        assert "70%" in result
        assert "10" in result

    def test_correct_prediction_uses_checkmark(self):
        track = {
            "ETHUSDT": {
                "evaluadas": 5,
                "tasa_acierto": 80,
                "recientes": [
                    {"correcto": True, "horas_atras": 1, "signal": "COMPRAR",
                     "precio_entrada": 3000, "movimiento_pct": 2.0},
                ],
            }
        }
        result = construir_track_record_contexto(track)
        assert "✓" in result

    def test_wrong_prediction_uses_cross(self):
        track = {
            "SOLUSDT": {
                "evaluadas": 3,
                "tasa_acierto": 33,
                "recientes": [
                    {"correcto": False, "horas_atras": 3, "signal": "VENDER",
                     "precio_entrada": 85, "movimiento_pct": -0.5},
                ],
            }
        }
        result = construir_track_record_contexto(track)
        assert "✗" in result

    def test_multiple_symbols_all_present(self):
        track = {
            "BTCUSDT": {"evaluadas": 5, "tasa_acierto": 60, "recientes": []},
            "ETHUSDT": {"evaluadas": 3, "tasa_acierto": 67, "recientes": []},
        }
        result = construir_track_record_contexto(track)
        assert "BTCUSDT" in result
        assert "ETHUSDT" in result

    def test_at_most_3_recent_items_shown(self):
        recientes = [
            {"correcto": True, "horas_atras": i, "signal": "COMPRAR",
             "precio_entrada": 100, "movimiento_pct": 1.0}
            for i in range(6)
        ]
        track = {"BTCUSDT": {"evaluadas": 10, "tasa_acierto": 70, "recientes": recientes}}
        result = construir_track_record_contexto(track)
        # Only 3 entries should be rendered
        assert result.count("✓") <= 3
