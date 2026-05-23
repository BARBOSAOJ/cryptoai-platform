"""
cartera.py — Conciencia de cartera para BT.

Obtiene el estado real del portfolio del usuario (saldo, posiciones, P&L)
y calcula métricas de riesgo para que BT tome decisiones contextualizadas:
Kelly criterion, exposición total, concentración por activo, tamaño óptimo
de posición según perfil de riesgo.
"""
import asyncio
import httpx
from app.config import logger

MARKET_SERVICE_URL = "http://localhost:8081"

# Exposición máxima permitida del patrimonio (% en posiciones abiertas)
_EXPOSICION_MAX = {"conservador": 30.0, "moderado": 60.0, "agresivo": 85.0}

# Fracción del saldo libre a arriesgar por operación según perfil
_RIESGO_BASE    = {"conservador": 0.04, "moderado": 0.10, "agresivo": 0.20}


async def _fetch(client: httpx.AsyncClient, url: str, token: str) -> dict:
    try:
        r = await client.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=5.0)
        return r.json() if r.status_code == 200 else {}
    except Exception as e:
        logger.warning(f"BT cartera — error en {url}: {e}")
        return {}


async def obtener_estado_cartera(token: str) -> tuple[dict, dict]:
    """
    Consulta /cartera y /portfolio/stats en paralelo.
    Devuelve (resumen_cartera, stats_portfolio). Ambos pueden ser {} si falla.
    """
    if not token:
        return {}, {}
    async with httpx.AsyncClient() as client:
        cartera, stats = await asyncio.gather(
            _fetch(client, f"{MARKET_SERVICE_URL}/cartera",        token),
            _fetch(client, f"{MARKET_SERVICE_URL}/portfolio/stats", token),
        )
    return cartera, stats


def calcular_riesgo(cartera: dict, stats: dict, perfil_riesgo: str | None) -> dict:
    """
    Calcula métricas de gestión de riesgo a partir del estado actual de la cartera.
    Retorna un dict listo para usar en construir_contexto_cartera.
    """
    perfil      = (perfil_riesgo or "moderado").lower()
    patrimonio  = cartera.get("patrimonioTotal",  0.0)
    saldo_libre = cartera.get("saldoDisponible",  0.0)
    val_pos     = cartera.get("valorPosiciones",  0.0)
    pnl_total   = cartera.get("pnlTotal",         0.0)
    deposito    = cartera.get("depositoInicial",  1.0) or 1.0

    posiciones       = stats.get("positions", [])
    win_rate_pct     = stats.get("winRate",   0.0)   # 0-100
    total_trades     = stats.get("totalTrades", 0)
    mejor_trade      = stats.get("mejorTrade",  0.0)
    peor_trade       = stats.get("peorTrade",   0.0)

    # ── Exposición actual ─────────────────────────────────────────────────────
    exposicion_pct = (val_pos / patrimonio * 100) if patrimonio > 0 else 0.0
    max_exposicion = _EXPOSICION_MAX.get(perfil, 60.0)
    exposicion_ok  = exposicion_pct < max_exposicion

    # ── Rentabilidad vs depósito inicial ─────────────────────────────────────
    rentabilidad_pct = ((patrimonio - deposito) / deposito * 100) if deposito > 0 else 0.0

    # ── Kelly criterion ───────────────────────────────────────────────────────
    # f* = p - (1-p)/b  donde b = avg_win / avg_loss
    # Usamos mejor_trade / abs(peor_trade) como aproximación de b
    kelly_fraction = 0.0
    if total_trades >= 5 and win_rate_pct > 0 and peor_trade < 0:
        p = win_rate_pct / 100.0
        b = mejor_trade / abs(peor_trade) if abs(peor_trade) > 0 else 1.0
        kelly_fraction = max(0.0, p - (1.0 - p) / b)
        kelly_fraction = min(kelly_fraction, 0.25)   # techo 25% nunca superar

    # ── Tamaño de posición sugerido ───────────────────────────────────────────
    if total_trades >= 5 and kelly_fraction > 0:
        # Half-Kelly para reducir volatilidad de la equity curve
        base = kelly_fraction * 0.5 * saldo_libre
    else:
        # Sin historial suficiente, usar fracción fija según perfil
        base = _RIESGO_BASE.get(perfil, 0.10) * saldo_libre

    max_pos = base if exposicion_ok else max(0.0, base * 0.5)

    # ── Concentración por activo ──────────────────────────────────────────────
    concentracion: list[dict] = []
    for pos in posiciones:
        valor = pos.get("value", 0.0)
        pct   = (valor / patrimonio * 100) if patrimonio > 0 else 0.0
        concentracion.append({
            "symbol":    pos.get("symbol", "?"),
            "coin":      pos.get("coin", "?"),
            "valor":     round(valor, 2),
            "pct":       round(pct, 1),
            "pnl_pct":   pos.get("pct", 0.0),
            "precio_actual": pos.get("currentPrice", 0.0),
            "avg_compra":    pos.get("avgBuyPrice",  0.0),
        })
    concentracion.sort(key=lambda x: x["pct"], reverse=True)

    return {
        "patrimonio":       round(patrimonio,      2),
        "saldo_libre":      round(saldo_libre,     2),
        "valor_posiciones": round(val_pos,         2),
        "pnl_total":        round(pnl_total,       2),
        "rentabilidad_pct": round(rentabilidad_pct, 2),
        "exposicion_pct":   round(exposicion_pct,  1),
        "max_exposicion":   max_exposicion,
        "exposicion_ok":    exposicion_ok,
        "kelly_fraction":   round(kelly_fraction,  4),
        "max_posicion":     round(max_pos,         2),
        "perfil":           perfil,
        "win_rate":         win_rate_pct,
        "total_trades":     total_trades,
        "concentracion":    concentracion,
    }


def construir_contexto_cartera(cartera: dict, stats: dict, riesgo: dict) -> str:
    """
    Genera el bloque de contexto de cartera que BT recibe en cada mensaje.
    Compacto y accionable — no es un dump, es una lectura de gestor.
    """
    if not cartera:
        return ""

    r = riesgo
    lineas = [
        f"\n[CARTERA ACTUAL]",
        f"Patrimonio: ${r['patrimonio']} · Libre: ${r['saldo_libre']} · En posiciones: ${r['valor_posiciones']}",
        f"P&L realizado: ${r['pnl_total']:+.2f} · Rentabilidad vs depósito: {r['rentabilidad_pct']:+.1f}%",
        f"Exposición: {r['exposicion_pct']:.1f}% del patrimonio "
        f"(límite perfil {r['perfil']}: {r['max_exposicion']:.0f}%)"
        + (" ⚠ SOBREEXPUESTO" if not r['exposicion_ok'] else ""),
    ]

    if r["concentracion"]:
        pos_str = " | ".join(
            f"{p['coin']} {p['pct']}% ({p['pnl_pct']:+.1f}%)"
            for p in r["concentracion"]
        )
        lineas.append(f"Posiciones abiertas: {pos_str}")

    if r["total_trades"] >= 5:
        lineas.append(
            f"Historial: {r['total_trades']} trades · Win rate {r['win_rate']:.1f}% · "
            f"Kelly fraction {r['kelly_fraction']*100:.1f}%"
        )
        lineas.append(
            f"Tamaño sugerido próxima operación (½ Kelly, perfil {r['perfil']}): ${r['max_posicion']:.2f}"
        )
    else:
        lineas.append(
            f"Sin historial suficiente para Kelly. Posición conservadora sugerida: ${r['max_posicion']:.2f}"
        )

    return "\n".join(lineas)
