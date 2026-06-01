"""
backtest_autonomo.py — Simulación histórica del ciclo autónomo de BT.

Optimizaciones de latencia:
  · Indicadores calculados una sola vez sobre el DataFrame completo (no por ventana).
  · Predicciones LSTM en una única llamada batch (N×60×9) → 10-20x más rápido que
    predecir vela a vela.
  · Timeframe adaptativo: 4H para períodos largos, 1H para cortos → menos velas.

Señales técnicas reproducibles. El sentimiento (FinBERT/Reddit/Fear&Greed) se fija
en neutro al no estar disponible históricamente.
"""
from __future__ import annotations

import asyncio
import math
import time
from datetime import datetime, timezone

import requests

from app.config import logger, _has_ml, BINANCE_KLINES
from app.bt.autonomo import UMBRAL_ENTRADA, UMBRAL_SALIDA, UMBRAL_SALIDA_SIG

_TP_PCT = 0.15   # take profit
_SL_PCT = 0.08   # stop loss

_REGIME_COMP = {
    "TRENDING":    0.4,
    "RANGING":     0.0,
    "VOLATILE":   -0.4,
    "TRANSITION": -0.2,
}

_FEATURES = ["Close", "Volume", "RSI", "MACD", "StochRSI",
             "EMA_cross", "BB_pos", "OBV_norm", "Momentum"]


# ─── Descarga de datos históricos ─────────────────────────────────────────────

def _intervalo_optimo(dias: int) -> tuple[str, int]:
    """Timeframe y step (ms) que minimizan el número de velas sin perder señal."""
    if dias <= 60:
        return "1h", 3_600_000
    return "4h", 14_400_000


def _fetch_historico(symbol: str, dias: int) -> tuple[list[dict], str]:
    """Descarga datos históricos de Binance con paginación automática."""
    intervalo, ms_step = _intervalo_optimo(dias)
    ahora  = int(time.time() * 1000)
    inicio = ahora - dias * 24 * 3_600_000

    candles: list[dict] = []
    cursor = inicio

    while cursor < ahora - ms_step:
        url = (f"{BINANCE_KLINES}?symbol={symbol}&interval={intervalo}"
               f"&limit=1000&startTime={cursor}")
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code != 200:
                break
            rows = resp.json()
            if not rows:
                break
            for row in rows:
                candles.append({
                    "open_time": int(row[0]),
                    "close":     float(row[4]),
                    "volume":    float(row[5]),
                })
            cursor = int(rows[-1][0]) + ms_step
        except Exception as e:
            logger.warning(f"[backtest] fetch {symbol}: {e}")
            break

    seen: set = set()
    out: list[dict] = []
    for c in sorted(candles, key=lambda x: x["open_time"]):
        if c["open_time"] not in seen:
            seen.add(c["open_time"])
            out.append(c)
    return out, intervalo


# ─── Precálculo de indicadores (una sola vez, O(N)) ───────────────────────────

def _build_dataframe(candles: list[dict]):
    import pandas as pd
    from app.indicadores import IndicadoresTecnicos

    closes  = [c["close"]  for c in candles]
    volumes = [c["volume"] for c in candles]
    df = pd.DataFrame({"Close": closes, "Volume": volumes})

    df["RSI"]        = IndicadoresTecnicos.rsi(df)
    df["MACD"], msig = IndicadoresTecnicos.macd(df)
    df["MACD_hist"]  = df["MACD"] - msig
    df["StochRSI"]   = IndicadoresTecnicos.stoch_rsi(df)

    ema9  = df["Close"].ewm(span=9,  adjust=False).mean()
    ema21 = df["Close"].ewm(span=21, adjust=False).mean()
    df["EMA_cross"] = ((ema9 - ema21) / (ema21 + 1e-9) * 100).clip(-10, 10)

    sma20  = df["Close"].rolling(20).mean()
    std20  = df["Close"].rolling(20).std()
    bb_rng = (std20 * 4).replace(0, 1e-9)
    df["BB_pos"] = ((df["Close"] - (sma20 - 2 * std20)) / bb_rng * 2 - 1).clip(-2, 2)

    sign_s  = df["Close"].diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    obv_raw = (df["Volume"] * sign_s).cumsum()
    obv_mx  = obv_raw.abs().rolling(50, min_periods=1).max().replace(0, 1)
    df["OBV_norm"] = (obv_raw / obv_mx).clip(-1, 1)
    df["Momentum"] = df["Close"].pct_change(10).fillna(0).clip(-0.2, 0.2)

    df.bfill(inplace=True)
    df.fillna(0, inplace=True)

    # Régimen proxy: pendiente de ema21 en 5 períodos
    slope = ema21.pct_change(5)
    df["regime"] = "RANGING"
    df.loc[slope.abs() > 0.005, "regime"] = "TRENDING"
    df.loc[(df["RSI"] > 65) | (df["RSI"] < 35), "regime"] = "VOLATILE"
    return df


# ─── Predicciones LSTM en un único batch ──────────────────────────────────────

def _batch_lstm(df, scaler, model) -> list[float | None]:
    """Todas las ventanas de 60 velas en una sola llamada a model.predict()."""
    import numpy as np

    n = len(df)
    expected = model.input_shape[-1] if hasattr(model, "input_shape") else len(_FEATURES)
    if expected != len(_FEATURES):
        return [None] * (n - 60)

    feat = df[_FEATURES].values                                    # (N, 9)
    wins = np.stack([feat[i - 60:i] for i in range(60, n)], 0)     # (N-60, 60, 9)
    nW   = wins.shape[0]
    flat = wins.reshape(-1, len(_FEATURES))
    scal = scaler.transform(flat).reshape(nW, 60, len(_FEATURES))

    preds  = model.predict(scal, batch_size=256, verbose=0)        # (N-60, 1)
    closes = df["Close"].values
    out: list[float | None] = []
    dummy  = np.zeros((1, len(_FEATURES)))
    for idx, raw in enumerate(preds):
        dummy[0, 0] = raw[0]
        p_pred = float(scaler.inverse_transform(dummy)[0][0])
        p_now  = closes[60 + idx - 1]
        out.append(float(((p_pred - p_now) / p_now) * 100))
    return out


# ─── Convicción técnica por vela (valores precalculados) ──────────────────────

def _conviction(row, lstm_score: float | None) -> tuple[int, str]:
    rsi_val   = float(row["RSI"])
    macd_hist = float(row["MACD_hist"])
    stoch_v   = float(row["StochRSI"])
    obv_delta = float(row["OBV_norm"])
    ema_v     = float(row["EMA_cross"])
    regime    = str(row.get("regime", "RANGING"))

    rsi_comp    = max(-1.0, min(1.0, (50.0 - rsi_val) / 20.0))
    macd_comp   = max(-1.0, min(1.0, macd_hist * 20.0))
    stoch_comp  = max(-1.0, min(1.0, (0.5 - stoch_v) * 2.0))
    obv_comp    = max(-1.0, min(1.0, obv_delta * 5.0))
    ema_comp    = max(-1.0, min(1.0, ema_v / 5.0))
    regime_comp = _REGIME_COMP.get(regime, 0.0)

    w_lstm   = 0.35 if lstm_score is not None else 0.0
    w_rsi, w_macd, w_regime, w_obv, w_stoch, w_ema = 0.20, 0.18, 0.13, 0.07, 0.04, 0.03
    w_total  = w_lstm + w_rsi + w_macd + w_regime + w_obv + w_stoch + w_ema or 0.01

    lstm_comp = 0.0
    if lstm_score is not None:
        tech_sig = ((0.25 if rsi_val < 50 else -0.25) +
                    (0.18 if macd_hist > 0 else -0.18) +
                    (0.15 if ema_v > 0 else -0.15))
        w_mix    = {"TRENDING": 0.55, "RANGING": 0.25, "VOLATILE": 0.20}.get(regime, 0.40)
        eff      = lstm_score * w_mix + tech_sig * (1 - w_mix)
        lstm_comp = max(-1.0, min(1.0, eff / 5.0))

    raw = (lstm_comp * w_lstm + rsi_comp * w_rsi + macd_comp * w_macd +
           regime_comp * w_regime + obv_comp * w_obv + stoch_comp * w_stoch +
           ema_comp * w_ema) / w_total

    conviction = max(0, min(100, int(round((raw + 1.0) * 50))))
    if regime in ("RANGING", "VOLATILE") and conviction > 49:
        conviction = min(conviction, 49)

    signal = "BUY" if conviction >= 55 else "SELL" if conviction <= 45 else "HOLD"
    return conviction, signal


# ─── Métricas ─────────────────────────────────────────────────────────────────

def _sharpe(returns: list[float], ppy: int = 365 * 24) -> float:
    if len(returns) < 2:
        return 0.0
    import statistics
    mu, std = statistics.mean(returns), statistics.stdev(returns) or 1e-9
    return round(mu / std * math.sqrt(ppy), 3)


def _max_drawdown(equity: list[float]) -> float:
    if len(equity) < 2:
        return 0.0
    peak, mdd = equity[0], 0.0
    for v in equity:
        peak = max(peak, v)
        mdd  = max(mdd, (peak - v) / peak if peak > 0 else 0)
    return round(mdd * 100, 2)


def _ts_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


# ─── Motor principal ──────────────────────────────────────────────────────────

async def backtest_autonomo(symbol: str, dias: int = 90,
                            balance_inicial: float = 1000.0) -> dict:
    t0 = time.monotonic()

    candles, intervalo = await asyncio.to_thread(_fetch_historico, symbol, dias)
    if len(candles) < 80:
        return {"error": f"Datos insuficientes para {symbol}: {len(candles)} velas"}
    if not _has_ml:
        return {"error": "Módulo ML no disponible"}

    df = await asyncio.to_thread(_build_dataframe, candles)

    lstm_preds: list[float | None] = [None] * (len(candles) - 60)
    try:
        import app.modelos as modelos
        if modelos.lstm_model and modelos.scaler:
            lstm_preds = await asyncio.to_thread(_batch_lstm, df, modelos.scaler, modelos.lstm_model)
    except Exception as e:
        logger.warning(f"[backtest] LSTM batch error: {e}")

    closes    = df["Close"].values
    balance   = balance_inicial
    posicion  = None
    trades:   list[dict] = []
    equity:   list[dict] = []
    retornos: list[float] = []
    prev_eq   = balance_inicial

    # horas por vela según el timeframe → para anualizar Sharpe correctamente
    horas_vela = 1 if intervalo == "1h" else 4

    for idx, i in enumerate(range(60, len(candles))):
        precio     = float(closes[i])
        ts         = candles[i]["open_time"]
        row        = df.iloc[i]
        conviction, signal = _conviction(row, lstm_preds[idx])

        if posicion is None and signal == "BUY" and conviction >= UMBRAL_ENTRADA:
            cantidad = (balance * 0.95) / precio
            posicion = {"precio_entrada": precio, "cantidad": cantidad,
                        "ts_entrada": ts, "conviction_entrada": conviction}
            balance -= cantidad * precio

        elif posicion is not None:
            pe, cant = posicion["precio_entrada"], posicion["cantidad"]
            pnl_pct  = (precio - pe) / pe
            razon = None
            if   pnl_pct >= _TP_PCT:                                    razon = "TP"
            elif pnl_pct <= -_SL_PCT:                                   razon = "SL"
            elif conviction < UMBRAL_SALIDA:                           razon = "conviction_baja"
            elif signal == "SELL" and conviction >= UMBRAL_SALIDA_SIG: razon = "señal_girada"

            if razon:
                balance += cant * precio
                trades.append({
                    "symbol": symbol,
                    "ts_entrada": _ts_iso(posicion["ts_entrada"]), "ts_salida": _ts_iso(ts),
                    "precio_entrada": round(pe, 4), "precio_salida": round(precio, 4),
                    "pnl_pct": round(pnl_pct * 100, 2), "pnl_usd": round((precio - pe) * cant, 4),
                    "razon": razon, "conviction_entrada": posicion["conviction_entrada"],
                    "duracion_h": round((ts - posicion["ts_entrada"]) / 3_600_000, 1),
                })
                posicion = None

        val_pos = (posicion["cantidad"] * precio) if posicion else 0.0
        eq_val  = balance + val_pos
        equity.append({"ts": _ts_iso(ts), "valor": round(eq_val, 4)})
        retornos.append((eq_val - prev_eq) / prev_eq if prev_eq > 0 else 0.0)
        prev_eq = eq_val

    if posicion:
        pf = float(closes[-1])
        balance += posicion["cantidad"] * pf
        pnl_pct = (pf - posicion["precio_entrada"]) / posicion["precio_entrada"]
        trades.append({
            "symbol": symbol,
            "ts_entrada": _ts_iso(posicion["ts_entrada"]),
            "ts_salida": _ts_iso(candles[-1]["open_time"]),
            "precio_entrada": round(posicion["precio_entrada"], 4), "precio_salida": round(pf, 4),
            "pnl_pct": round(pnl_pct * 100, 2),
            "pnl_usd": round((pf - posicion["precio_entrada"]) * posicion["cantidad"], 4),
            "razon": "fin_backtest", "conviction_entrada": posicion["conviction_entrada"],
            "duracion_h": round((candles[-1]["open_time"] - posicion["ts_entrada"]) / 3_600_000, 1),
        })

    valor_final = equity[-1]["valor"] if equity else balance_inicial
    bh_return   = (float(closes[-1]) - float(closes[60])) / float(closes[60]) * 100
    wins        = [t for t in trades if t["pnl_pct"] > 0]
    step        = max(1, len(equity) // 200)
    elapsed     = round(time.monotonic() - t0, 1)

    logger.info(f"[backtest] {symbol} {dias}d ({intervalo}) — {len(trades)} trades en {elapsed}s")

    return {
        "symbol": symbol, "dias": dias, "intervalo": intervalo,
        "balance_inicial": balance_inicial, "balance_final": round(valor_final, 2),
        "retorno_pct": round((valor_final - balance_inicial) / balance_inicial * 100, 2),
        "bh_retorno_pct": round(bh_return, 2),
        "num_trades": len(trades),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "sharpe": _sharpe(retornos, ppy=int(365 * 24 / horas_vela)),
        "max_drawdown_pct": _max_drawdown([e["valor"] for e in equity]),
        "avg_duracion_h": round(sum(t["duracion_h"] for t in trades) / len(trades), 1) if trades else 0.0,
        "candles_analizadas": len(candles) - 60,
        "elapsed_s": elapsed,
        "nota": "Sentimiento (FinBERT/Reddit/Fear&Greed) fijado en neutro — solo señales técnicas + LSTM.",
        "trades": trades,
        "equity_curve": equity[::step],
    }
