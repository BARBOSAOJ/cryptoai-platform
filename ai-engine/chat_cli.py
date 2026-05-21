#!/usr/bin/env python3
"""
chat_cli.py — Prueba interactiva de Gemma + LSTM desde la consola.

Uso:
    python chat_cli.py               # modo interactivo
    python chat_cli.py "analiza BTC" # mensaje único y sale

Requiere: ai-engine/.venv activo y Ollama corriendo (ollama serve).
"""
import sys
import os
import asyncio
import json
import logging
import warnings

# Silenciar logs ruidosos antes de cualquier import
os.environ["TF_CPP_MIN_LOG_LEVEL"]      = "3"
os.environ["TRANSFORMERS_VERBOSITY"]     = "error"
os.environ["GLOG_minloglevel"]           = "3"
os.environ["GRPC_VERBOSITY"]             = "ERROR"
os.environ["HF_HUB_VERBOSITY"]           = "error"
os.environ["TOKENIZERS_PARALLELISM"]     = "false"
warnings.filterwarnings("ignore")
for lib in ("httpx", "httpcore", "huggingface_hub", "huggingface_hub.utils._http",
            "huggingface_hub.utils._validators", "transformers", "transformers.modeling_utils",
            "tensorflow", "absl", "absl-py", "urllib3", "filelock"):
    logging.getLogger(lib).setLevel(logging.CRITICAL)

# Redirigir stderr durante los imports pesados para suprimir mensajes C++/absl
import io
_stderr_original = sys.stderr
sys.stderr = io.StringIO()

# Asegura que los imports de app.* funcionen desde este directorio
sys.path.insert(0, os.path.dirname(__file__))

# ── Colores ANSI ──────────────────────────────────────────────────────────────
CYAN    = "\033[36m"
GREEN   = "\033[32m"
YELLOW  = "\033[33m"
RED     = "\033[31m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
RESET   = "\033[0m"

def c(color, text): return f"{color}{text}{RESET}"


# ── Importación de módulos (stderr suprimido durante la carga) ─────────────────
logging.getLogger("ai-engine").setLevel(logging.CRITICAL)
print(c(DIM, "  Iniciando BT..."), end="\r", flush=True)

from app.bt.config   import SYMBOL_MAP, SYSTEM_PROMPT
from app.bt.detectar import detectar_simbolos as _detectar_simbolos, detectar_intencion_trade as _detectar_intencion_trade
from app.bt.contexto import obtener_contexto_mercado as _obtener_contexto_mercado
from app.bt.historial import guardar_prediccion, obtener_track_record
from app.bt.alertas   import evaluar_y_publicar, consumir_alerta
from app.bt.memoria   import (
    obtener_perfil, registrar_sesion, actualizar_perfil_desde_mensaje,
    obtener_turnos_sesion_anterior, guardar_turno, construir_contexto_memoria,
)

sys.stderr = _stderr_original  # restaurar stderr
print(" " * 50, end="\r")  # limpia la línea de carga

HISTORIAL: list[dict] = []
CLI_USER_ID = "cli_user"


async def _responder(mensaje: str) -> None:
    print()

    # 1. Detectar símbolos y obtener análisis LSTM
    simbolos = _detectar_simbolos(mensaje)
    if simbolos:
        print(c(DIM, f"  BT: Consultando datos de {', '.join(simbolos)}..."), flush=True)

    contexto, analisis_map = await _obtener_contexto_mercado(simbolos)

    if analisis_map:
        for sym, a in analisis_map.items():
            ind = a.get("indicators", {})
            fg  = a.get("fear_greed", {})
            rd  = a.get("reddit", {})
            bt  = a.get("backtest")
            bt_line = ""
            if bt and bt.get("accuracy") is not None:
                acc_pct = round(bt["accuracy"] * 100, 1)
                bt_line = c(CYAN, f"  │ Precisión histórica: {acc_pct}%  |  "
                                  f"Muestras: {bt['muestras']}  |  Sharpe: {bt['sharpe_simulado']}\n")
            else:
                bt_line = c(DIM,  "  │ Precisión histórica: calculando...\n")
            print(
                c(CYAN, f"\n  ┌─ {sym} ─────────────────────────────────────────\n") +
                c(CYAN, f"  │ Señal: {BOLD}{a['signal']}{RESET}{CYAN}  |  Confianza: {a['confidence']}  |  "
                        f"Conviction: {a['conviction_score']}/100\n") +
                c(CYAN, f"  │ Precio: ${a['entry_price']}  |  LSTM: ${a['predicted_next']}\n") +
                c(CYAN, f"  │ Régimen: {ind.get('regimen','?')}  |  RSI: {ind.get('rsi','?')}  |  "
                        f"MACD hist: {ind.get('macd_histogram','?')}\n") +
                c(CYAN, f"  │ Fear & Greed: {fg.get('valor','?')}/100 ({fg.get('clasificacion','N/A')})\n") +
                c(CYAN, f"  │ Reddit ({rd.get('posts_analizados',0)} posts): "
                        f"{rd.get('clasificacion','sin datos')}  score={rd.get('sentimiento',0.0)}\n") +
                bt_line +
                c(CYAN,  "  └────────────────────────────────────────────────")
            )
            # Guardar predicción y mostrar track record si hay datos
            guardar_prediccion(sym, a["signal"], a["conviction_score"],
                               float(a["entry_price"]), a["confidence"])
            tr = obtener_track_record(sym)
            if tr.get("evaluadas", 0) > 0:
                print(c(YELLOW, f"\n  BT track record ({sym}): "
                                f"{tr['tasa_acierto']}% acierto en {tr['evaluadas']} predicciones"))
                for r in tr.get("recientes", [])[:3]:
                    signo = c(GREEN, "✓") if r["correcto"] else c(RED, "✗")
                    print(c(DIM, f"    {signo}{DIM} hace {r['horas_atras']}h — "
                                 f"{r['signal']}  ${r['precio_entrada']} → {r['movimiento_pct']:+.2f}%"))

    # 2. Detectar intención de trade (sin ejecutar — solo muestra qué haría)
    intencion = _detectar_intencion_trade(mensaje)
    if intencion:
        sym = intencion["symbol"]
        a = analisis_map.get(sym)
        precio = float(a["entry_price"]) if a else 0
        size = round(intencion["amount_usd"] / precio, 8) if precio else "?"
        tipo = "COMPRA" if intencion["side"] == "BUY" else "VENTA"
        print(
            c(YELLOW, f"\n  ⚡ Intención de trade detectada:\n") +
            c(YELLOW, f"     {tipo} {size} {sym} a ${precio} "
                      f"(${intencion['amount_usd']:.2f})\n") +
            c(DIM,    "     [En la app real esto ejecutaría la orden vía market-service]\n")
        )

    # 3. Llamar a Gemma con el contexto
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in HISTORIAL[-10:]:
        messages.append({"role": h["role"], "content": h["content"]})

    user_content = mensaje
    if contexto:
        user_content += f"\n\n[Datos de mercado obtenidos automáticamente:{contexto}]"
    if intencion and analisis_map.get(intencion["symbol"]):
        a = analisis_map[intencion["symbol"]]
        size = round(intencion["amount_usd"] / float(a["entry_price"]), 8)
        tipo = "Compra" if intencion["side"] == "BUY" else "Venta"
        user_content += (
            f"\n\n[ORDEN EJECUTADA (simulada en CLI): {tipo} de {size} {intencion['symbol']} "
            f"a ${a['entry_price']} — Total: ${intencion['amount_usd']:.2f}]"
        )

    messages.append({"role": "user", "content": user_content})

    print(c(BOLD + CYAN, "\n  BT: "), end="", flush=True)
    respuesta_completa = ""
    try:
        import ollama
        stream = ollama.chat(
            model="gemma2:27b",
            messages=messages,
            stream=True,
            options={"temperature": 0.7, "num_predict": 1024},
        )
        for chunk in stream:
            content = chunk["message"]["content"]
            if content:
                print(content, end="", flush=True)
                respuesta_completa += content
    except ImportError:
        print(c(RED, "Error: pip install ollama"))
        return
    except Exception as e:
        print(c(RED, f"Error Ollama: {e}"))
        return

    print("\n")

    # Actualizar historial en memoria y en Redis
    HISTORIAL.append({"role": "user",      "content": mensaje})
    HISTORIAL.append({"role": "assistant", "content": respuesta_completa})
    guardar_turno(CLI_USER_ID, "user",      mensaje)
    guardar_turno(CLI_USER_ID, "assistant", respuesta_completa)
    actualizar_perfil_desde_mensaje(CLI_USER_ID, mensaje, simbolos)


def _banner():
    print(c(BOLD + CYAN, """
  ██████╗ ████████╗
  ██╔══██╗╚══██╔══╝
  ██████╔╝   ██║
  ██╔══██╗   ██║
  ██████╔╝   ██║
  ╚═════╝    ╚═╝
"""))
    print(c(CYAN, "  BT  ·  Análisis de mercados cripto  ·  CryptoAI Platform"))
    print(c(DIM,  "  ──────────────────────────────────────────────────────────"))
    print(c(DIM,  "  'salir' para cerrar  ·  'limpiar' para nueva conversación"))
    print()
    print(c(DIM,  "  Ejemplos:"))
    print(c(DIM,  "    analiza bitcoin"))
    print(c(DIM,  "    ¿debo comprar ETH ahora?"))
    print(c(DIM,  "    compra 100$ de solana"))
    print(c(DIM,  "    compara BTC y ETH"))
    print()


async def _monitor_alertas():
    """Tarea de fondo: detecta alertas y las imprime en el terminal."""
    from app.analisis import realizar_analisis
    from app.indicadores import obtener_velas_binance
    simbolos = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    await asyncio.sleep(30)
    while True:
        for symbol in simbolos:
            try:
                data = obtener_velas_binance(symbol, limit=100)
                if len(data["prices"]) >= 5:
                    a = await realizar_analisis(
                        symbol, data["prices"][-1], data["prices"], data["volumes"]
                    )
                    evaluar_y_publicar(symbol, a, [CLI_USER_ID])
            except Exception:
                pass
        # Consumir y mostrar alertas pendientes
        while True:
            alerta = consumir_alerta(CLI_USER_ID)
            if not alerta:
                break
            color = YELLOW if alerta.get("urgencia", 1) == 2 else CYAN
            print(f"\n{c(color + BOLD, '  🔔 BT:')} {c(color, alerta['mensaje'])}\n"
                  f"{c(GREEN + BOLD, '  Tú: ')}", end="", flush=True)
        await asyncio.sleep(300)  # 5 min


async def main():
    _banner()

    # Registrar sesión y mostrar qué recuerda BT
    perfil = registrar_sesion(CLI_USER_ID)
    ctx = construir_contexto_memoria(CLI_USER_ID, perfil, es_nueva_sesion=True)
    if ctx and perfil.get("num_sesiones", 0) > 1:
        nombre = f", {perfil['nombre']}" if perfil.get("nombre") else ""
        print(c(DIM, f"  BT: Bienvenido de nuevo{nombre}."))
        if perfil.get("activos"):
            top = sorted(perfil["activos"].items(), key=lambda x: x[1], reverse=True)[:2]
            print(c(DIM, f"  BT: Recuerdo que sigues {', '.join(s for s, _ in top)}."))
        print()

    # Inyectar contexto de memoria en el historial de BT
    if ctx:
        HISTORIAL.append({"role": "system", "content": ctx})
    for t in obtener_turnos_sesion_anterior(CLI_USER_ID, n=4):
        HISTORIAL.append(t)

    # Lanzar monitor de alertas en background
    asyncio.create_task(_monitor_alertas())

    # Modo argumento único: python chat_cli.py "mensaje"
    if len(sys.argv) > 1:
        await _responder(" ".join(sys.argv[1:]))
        return

    # Modo interactivo
    while True:
        try:
            entrada = input(c(GREEN + BOLD, "  Tú: ") + RESET).strip()
        except (EOFError, KeyboardInterrupt):
            print(c(DIM, "\n  Hasta luego."))
            break

        if not entrada:
            continue
        if entrada.lower() in ("salir", "exit", "quit", "q"):
            print(c(DIM, "  BT: Hasta la próxima."))
            break
        if entrada.lower() in ("limpiar", "clear", "reset"):
            HISTORIAL.clear()
            print(c(DIM, "  BT: Conversación reiniciada.\n"))
            continue

        await _responder(entrada)


if __name__ == "__main__":
    asyncio.run(main())
