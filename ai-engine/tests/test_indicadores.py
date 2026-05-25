"""
Tests for IndicadoresTecnicos — verifies Wilder's EMA RSI stays in [0, 100]
and other indicator calculations are within expected ranges.
"""
import sys
import os
import pytest

# Make app importable without installing as a package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Patch _has_ml flag so calculations always run regardless of GPU/model availability
import app.config as _cfg
_cfg._has_ml = True

import pandas as pd
import numpy as np
from app.indicadores import IndicadoresTecnicos as IT


def _make_df(prices, highs=None, lows=None):
    """Build a minimal OHLCV DataFrame accepted by IndicadoresTecnicos."""
    closes = pd.Series(prices, dtype=float)
    df = pd.DataFrame({'Close': closes})
    if highs is not None:
        df['High'] = pd.Series(highs, dtype=float)
        df['Low']  = pd.Series(lows,  dtype=float)
    return df


# ── RSI ───────────────────────────────────────────────────────────────────────

class TestRSI:
    def test_rsi_within_0_100(self):
        prices = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
                  110, 108, 107, 105, 103, 101, 100, 98, 97, 99]
        rsi = IT.rsi(_make_df(prices))
        valid = rsi.dropna()
        assert (valid >= 0).all() and (valid <= 100).all()

    def test_rsi_never_exactly_100_with_wilder_ema(self):
        """Wilder EMA can approach 100 but should never reach it due to epsilon guard."""
        prices = list(range(50, 100))  # strictly increasing
        rsi = IT.rsi(_make_df(prices))
        valid = rsi.dropna()
        assert (valid < 100).all(), "RSI should never reach 100 with epsilon guard"

    def test_rsi_extreme_downtrend_stays_in_range(self):
        """On a strictly decreasing series, RSI should be in [0, 100] (can reach 0)."""
        prices = list(range(100, 50, -1))
        rsi = IT.rsi(_make_df(prices))
        valid = rsi.dropna()
        assert (valid >= 0).all() and (valid <= 100).all()

    def test_rsi_length_matches_input(self):
        prices = [100 + i for i in range(30)]
        rsi = IT.rsi(_make_df(prices))
        assert len(rsi) == len(prices)

    def test_rsi_overbought_on_rally(self):
        """A sustained uptrend should push RSI above 70."""
        prices = [100 + i * 2 for i in range(30)]
        rsi = IT.rsi(_make_df(prices))
        assert rsi.iloc[-1] > 70

    def test_rsi_oversold_on_decline(self):
        """A sustained downtrend should push RSI below 30."""
        prices = [100 - i * 2 for i in range(30)]
        rsi = IT.rsi(_make_df(prices))
        assert rsi.iloc[-1] < 30

    def test_rsi_sideways_market_near_50(self):
        """Oscillating prices should keep RSI near 50."""
        prices = [100 + (5 if i % 2 == 0 else -5) for i in range(40)]
        rsi = IT.rsi(_make_df(prices))
        last = rsi.iloc[-1]
        assert 40 < last < 60, f"Expected RSI near 50, got {last:.1f}"

    def test_rsi_window_parameter(self):
        prices = [100 + i for i in range(50)]
        rsi_14 = IT.rsi(_make_df(prices), window=14)
        rsi_7  = IT.rsi(_make_df(prices), window=7)
        # Shorter window reacts faster — earlier non-NaN values
        non_nan_7  = rsi_7.dropna()
        non_nan_14 = rsi_14.dropna()
        assert len(non_nan_7) > 0 and len(non_nan_14) > 0


# ── MACD ──────────────────────────────────────────────────────────────────────

class TestMACD:
    def test_macd_returns_two_series(self):
        prices = [100 + i for i in range(60)]
        macd, signal = IT.macd(_make_df(prices))
        assert len(macd) == 60
        assert len(signal) == 60

    def test_macd_histogram_sign_on_uptrend(self):
        """MACD line should be above signal on a clear uptrend."""
        prices = [100 + i * 3 for i in range(60)]
        macd, signal = IT.macd(_make_df(prices))
        # After warm-up, macd > signal on uptrend
        assert float(macd.iloc[-1]) > float(signal.iloc[-1])


# ── Bollinger ─────────────────────────────────────────────────────────────────

class TestBollinger:
    def test_upper_above_lower(self):
        prices = [100 + np.sin(i) * 5 for i in range(50)]
        upper, lower = IT.bollinger(_make_df(prices))
        valid = upper.dropna()
        valid_l = lower.dropna()
        assert (valid.values > valid_l.values[:len(valid)]).all()


# ── EMA Cross ─────────────────────────────────────────────────────────────────

class TestEMACross:
    def test_ema_cross_positive_on_uptrend(self):
        prices = [100 + i for i in range(30)]
        result = IT.ema_cross(_make_df(prices))
        assert result > 0

    def test_ema_cross_negative_on_downtrend(self):
        prices = [100 - i for i in range(30)]
        result = IT.ema_cross(_make_df(prices))
        assert result < 0

    def test_ema_cross_returns_float(self):
        prices = [100] * 30
        result = IT.ema_cross(_make_df(prices))
        assert isinstance(result, float)
