"""
contexto.py — Obtención y formateo del contexto de mercado en tiempo real para BT.
"""
from app.config import logger
from app.indicadores import obtener_velas_binance
from app.analisis import realizar_analisis
from app.bt.historial import guardar_prediccion, obtener_track_record


async def obtener_contexto_mercado(simbolos: list) -> tuple[str, dict]:
    """
    Para cada símbolo obtiene velas, ejecuta realizar_analisis y construye
    el bloque de texto que BT recibe como contexto.
    Devuelve (texto_contexto, {symbol: analisis_dict}).
    """
    if not simbolos:
        return "", {}
    partes = []
    analisis_map: dict = {}
    for symbol in simbolos:
        try:
            data = obtener_velas_binance(symbol, limit=100)
            if len(data["prices"]) < 5:
                continue
            a = await realizar_analisis(symbol, data["prices"][-1], data["prices"], data["volumes"])
            analisis_map[symbol] = a
            ind = a.get("indicators", {})
            fg  = a.get("fear_greed", {})
            rd  = a.get("reddit", {})
            bt  = a.get("backtest")
            bt_line = (
                f"Precisión histórica del modelo: {round(bt['accuracy']*100,1)}% "
                f"sobre {bt['muestras']} muestras (Sharpe {bt['sharpe_simulado']})\n"
                if bt and bt.get("accuracy") is not None
                else "Precisión histórica: pendiente de calibración\n"
            )
            partes.append(
                f"\n--- ANÁLISIS EN TIEMPO REAL: {symbol} ---\n"
                f"Precio: ${a['entry_price']} | Señal IA: {a['signal']} | Confianza: {a['confidence']}\n"
                f"Conviction Score: {a['conviction_score']}/100 | LSTM activo: {'Sí' if a['lstm_active'] else 'No'}\n"
                f"Predicción próxima vela: ${a['predicted_next']}\n"
                f"Régimen: {ind.get('regimen', 'N/A')} | ADX: {ind.get('adx', 'N/A')}\n"
                f"RSI: {ind.get('rsi', 'N/A')} | StochRSI: {ind.get('stoch_rsi', 'N/A')} | "
                f"MACD hist: {ind.get('macd_histogram', 'N/A')}\n"
                f"EMA cross: {ind.get('ema_cross', 'N/A')} | BB pos: {ind.get('bb_position', 'N/A')}\n"
                f"Sentimiento noticias (FinBERT): {a['news_impact']} | Impacto técnico: {a['tech_impact']}\n"
                f"Fear & Greed: {fg.get('valor', '?')}/100 ({fg.get('clasificacion', 'N/A')})\n"
                f"Reddit ({rd.get('posts_analizados', 0)} posts): {rd.get('clasificacion', 'sin datos')} "
                f"(score {rd.get('sentimiento', 0.0)})\n" +
                bt_line
            )
            guardar_prediccion(symbol, a["signal"], a["conviction_score"],
                               float(a["entry_price"]), a["confidence"])
        except Exception as e:
            logger.warning(f"Error obteniendo contexto para {symbol}: {e}")
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
