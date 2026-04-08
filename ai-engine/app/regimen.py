"""
regimen.py — DetectorRegimen: clasifica el estado del mercado y ajusta pesos de indicadores.
"""
from app.config import logger, _has_ml


class DetectorRegimen:
    """
    Detecta si el mercado está en tendencia, lateral o volátil.
    Regímenes: TRENDING | RANGING | VOLATILE | TRANSITION
    """

    @staticmethod
    def adx(df, window: int = 14) -> float:
        if not _has_ml: return 20.0
        try:
            import pandas as pd
            if 'High' in df.columns and 'Low' in df.columns:
                high, low = df['High'], df['Low']
            else:
                high = df['Close'].rolling(3).max()
                low  = df['Close'].rolling(3).min()

            prev_close = df['Close'].shift(1)
            tr = pd.concat([
                high - low,
                (high - prev_close).abs(),
                (low  - prev_close).abs(),
            ], axis=1).max(axis=1)

            dm_pos = (high - high.shift(1)).clip(lower=0)
            dm_neg = (low.shift(1) - low).clip(lower=0)
            dm_pos = dm_pos.where(dm_pos > dm_neg, 0)
            dm_neg = dm_neg.where(dm_neg > dm_pos, 0)

            atr_s   = tr.ewm(span=window, adjust=False).mean()
            di_pos  = 100 * dm_pos.ewm(span=window, adjust=False).mean() / (atr_s + 1e-9)
            di_neg  = 100 * dm_neg.ewm(span=window, adjust=False).mean() / (atr_s + 1e-9)
            dx      = 100 * (di_pos - di_neg).abs() / (di_pos + di_neg + 1e-9)
            return round(float(dx.ewm(span=window, adjust=False).mean().iloc[-1]), 2)
        except Exception:
            return 20.0

    @staticmethod
    def pendiente_lineal(precios: list, ventana: int = 20) -> float:
        if not _has_ml or len(precios) < ventana: return 0.0
        try:
            import numpy as np
            y    = np.array(precios[-ventana:], dtype=float)
            x    = np.arange(ventana)
            coef = np.polyfit(x, y, 1)
            return round(coef[0] / (y.mean() + 1e-9), 6)
        except Exception:
            return 0.0

    @staticmethod
    def r_cuadrado(precios: list, ventana: int = 20) -> float:
        if not _has_ml or len(precios) < ventana: return 0.0
        try:
            import numpy as np
            y    = np.array(precios[-ventana:], dtype=float)
            x    = np.arange(ventana)
            coef = np.polyfit(x, y, 1)
            y_hat = np.polyval(coef, x)
            ss_res = ((y - y_hat) ** 2).sum()
            ss_tot = ((y - y.mean()) ** 2).sum()
            return round(1 - ss_res / (ss_tot + 1e-9), 4)
        except Exception:
            return 0.0

    @classmethod
    def detectar(cls, df, atr_val: float = 0.0) -> dict:
        if not _has_ml or len(df) < 20:
            return cls._regimen_neutro()

        precios       = df['Close'].tolist()
        adx_val       = cls.adx(df)
        r2            = cls.r_cuadrado(precios)
        pendiente     = cls.pendiente_lineal(precios)
        precio_actual = float(df['Close'].iloc[-1])
        vol_relativa  = atr_val / (precio_actual + 1e-9) if atr_val > 0 else 0.0

        if vol_relativa > 0.04:
            regimen   = "VOLATILE"
            confianza = min(1.0, vol_relativa / 0.06)
            pesos     = cls._pesos_volatil()
        elif adx_val > 25 and r2 > 0.6:
            regimen   = "TRENDING"
            confianza = min(1.0, (adx_val - 25) / 30 * 0.5 + r2 * 0.5)
            pesos     = cls._pesos_tendencia(pendiente)
        elif adx_val < 20 and r2 < 0.4:
            regimen   = "RANGING"
            confianza = min(1.0, (20 - adx_val) / 20 * 0.5 + (0.4 - r2) / 0.4 * 0.5)
            pesos     = cls._pesos_lateral()
        else:
            regimen   = "TRANSITION"
            confianza = 0.4
            pesos     = cls._pesos_neutros()

        return {
            "regimen":   regimen,
            "adx":       adx_val,
            "r2":        r2,
            "pendiente": pendiente,
            "confianza": round(confianza, 2),
            "pesos":     pesos,
        }

    @staticmethod
    def _pesos_tendencia(pendiente: float) -> dict:
        return {"rsi": 0.6, "stoch_rsi": 0.5, "macd": 1.4, "ema_cross": 1.4,
                "bollinger": 0.7, "vwap": 1.2, "obv": 1.3}

    @staticmethod
    def _pesos_lateral() -> dict:
        return {"rsi": 1.5, "stoch_rsi": 1.4, "macd": 0.6, "ema_cross": 0.5,
                "bollinger": 1.5, "vwap": 1.2, "obv": 0.8}

    @staticmethod
    def _pesos_volatil() -> dict:
        return {"rsi": 0.5, "stoch_rsi": 0.5, "macd": 0.5, "ema_cross": 0.5,
                "bollinger": 0.6, "vwap": 0.7, "obv": 0.5}

    @staticmethod
    def _pesos_neutros() -> dict:
        return {"rsi": 1.0, "stoch_rsi": 1.0, "macd": 1.0,
                "ema_cross": 1.0, "bollinger": 1.0, "vwap": 1.0, "obv": 1.0}

    @staticmethod
    def _regimen_neutro() -> dict:
        return {"regimen": "RANGING", "adx": 20.0, "r2": 0.0,
                "pendiente": 0.0, "confianza": 0.0,
                "pesos": DetectorRegimen._pesos_neutros()}
