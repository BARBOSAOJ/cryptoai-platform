"""
contexto.py — Obtención y formateo del contexto de mercado en tiempo real para BT.
Los símbolos se analizan en paralelo con asyncio.gather para minimizar latencia.
"""
import asyncio
from app.config import logger
from app.indicadores import obtener_velas_binance
from app.analisis import realizar_analisis
from app.bt.historial import guardar_prediccion, obtener_track_record
from app.bt.rag import guardar_en_rag, actualizar_outcome_rag, buscar_similares, construir_contexto_rag


async def _analizar_simbolo(symbol: str) -> tuple[str, dict | None]:
    try:
        data = obtener_velas_binance(symbol, limit=100)
        if len(data["prices"]) < 5:
            return symbol, None
        a = await realizar_analisis(symbol, data["prices"][-1], data["prices"], data["volumes"])
        return symbol, a
    except Exception as e:
        logger.warning(f"Error obteniendo contexto para {symbol}: {e}")
        return symbol, None


async def obtener_contexto_mercado(simbolos: list) -> tuple[str, dict]:
    """
    Analiza todos los símbolos en paralelo y construye el bloque de contexto para BT.
    Devuelve (texto_contexto, {symbol: analisis_dict}).
    """
    if not simbolos:
        return "", {}

    resultados = await asyncio.gather(*[_analizar_simbolo(sym) for sym in simbolos])

    partes: list[str] = []
    analisis_map: dict = {}

    for symbol, a in resultados:
        if a is None:
            continue
        analisis_map[symbol] = a
        ind = a.get("indicators", {})
        fg  = a.get("fear_greed", {})
        rd  = a.get("reddit", {})
        bt  = a.get("backtest")

        bt_line = (
            f"Modelo: {round(bt['accuracy']*100,1)}% precisión · {bt['muestras']} muestras · Sharpe {bt['sharpe_simulado']}"
            if bt and bt.get("accuracy") is not None
            else "Modelo: calibración pendiente"
        )

        rsi_val   = ind.get('rsi', '?')
        macd_val  = ind.get('macd_histogram', '?')
        regimen   = ind.get('regimen', '?')
        adx_val   = ind.get('adx', '?')
        bb_pos    = ind.get('bb_position', '?')
        ema_cross = ind.get('ema_cross', '?')
        fg_val    = fg.get('valor', '?')
        fg_cls    = fg.get('clasificacion', '?')
        rd_cls    = rd.get('clasificacion', 'sin datos')
        rd_score  = rd.get('sentimiento', 0.0)
        rd_posts  = rd.get('posts_analizados', 0)

        partes.append(
            f"\n[{symbol}] ${a['entry_price']} · {a['signal']} · Conviction {a['conviction_score']}/100"
            f" · LSTM {'✓' if a['lstm_active'] else '✗'}\n"
            f"Predicción: ${a['predicted_next']} · RSI {rsi_val} · MACD {macd_val}"
            f" · BB {bb_pos} · EMA {ema_cross}\n"
            f"Régimen: {regimen} · ADX {adx_val} · Técnico: {a['tech_impact']}"
            f" · FinBERT: {a['news_impact']}\n"
            f"F&G: {fg_val}/100 ({fg_cls}) · Reddit ({rd_posts}p): {rd_cls} ({rd_score:+.2f})\n"
            f"{bt_line}"
        )

        guardar_prediccion(symbol, a["signal"], a["conviction_score"],
                           float(a["entry_price"]), a["confidence"])

        # RAG: actualizar outcomes pendientes y guardar análisis actual
        actualizar_outcome_rag(symbol, float(a["entry_price"]))
        guardar_en_rag(symbol, a)

        # Recuperar situaciones pasadas similares e incluirlas en el contexto
        similares = buscar_similares(a, symbol)
        if similares:
            partes.append(construir_contexto_rag(similares, symbol))

    return "\n".join(partes), analisis_map


def construir_track_record_contexto(track_records: dict) -> str:
    """Formatea el historial de aciertos de BT como bloque de texto para el LLM."""
    lineas = ""
    for sym, tr in track_records.items():
        if tr.get("evaluadas", 0) == 0:
            continue
        lineas += (f"\n[TRACK RECORD BT — {sym}: "
                   f"{tr['tasa_acierto']}% de acierto en {tr['evaluadas']} predicciones evaluadas]")
        for r in tr.get("recientes", [])[:3]:
            signo = "✓" if r["correcto"] else "✗"
            lineas += (f"\n  {signo} Hace {r['horas_atras']}h recomendé {r['signal']} "
                       f"a ${r['precio_entrada']} → {r['movimiento_pct']:+.2f}%")
    return lineas
