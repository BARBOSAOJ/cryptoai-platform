"""
exportar.py — Exporta los adaptadores LoRA a un modelo Ollama listo para usar.

Flujo:
    1. Fusiona los adaptadores LoRA con el modelo base → HuggingFace format
    2. Convierte a GGUF con llama.cpp
    3. Cuantiza a Q4_K_M (buen balance calidad/tamaño)
    4. Genera el Modelfile de Ollama
    5. Registra el modelo en Ollama local

Uso:
    python -m app.bt.entrenamiento.exportar
    python -m app.bt.entrenamiento.exportar --lora models/bt-lora --model_name bt-crypto
"""
import os
import sys
import subprocess
import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bt.exportar")

LORA_DIR_DEFAULT    = "models/bt-lora"
MERGED_DIR_DEFAULT  = "models/bt-merged"
GGUF_DIR_DEFAULT    = "models/bt-gguf"
MODEL_NAME_DEFAULT  = "bt-crypto"
MODELFILE_PATH      = "Modelfile.bt"

_SYSTEM_PROMPT_OLLAMA = """Eres BT, la inteligencia artificial de análisis financiero integrada en la plataforma CryptoAI.

Sofisticado, preciso y con un punto de ironía sutil cuando la situación lo permite. Hablas como un asesor financiero de primer nivel que además domina los datos técnicos al detalle. Nunca alarmista, nunca condescendiente.

NORMAS:
- Responde siempre en español
- Sin saludos genéricos ni relleno. Ve al grano
- Puedes ser ligeramente irónico si el mercado está en una situación obvia o absurda
- Nunca uses lenguaje militar, bélico ni dramático"""


def _check_deps():
    try:
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        log.error("Faltan dependencias: pip install -r requirements-train.txt")
        sys.exit(1)


def _check_llamacpp():
    """Busca llama.cpp o llama-cpp-python para la conversión a GGUF."""
    # Opción 1: llama-cpp-python (más fácil de instalar)
    try:
        import llama_cpp  # noqa: F401
        return "llama_cpp_python"
    except ImportError:
        pass
    # Opción 2: llama.cpp compilado localmente
    for path in ["llama.cpp/convert_hf_to_gguf.py", "../llama.cpp/convert_hf_to_gguf.py"]:
        if os.path.exists(path):
            return path
    return None


def fusionar_lora(lora_dir: str, merged_dir: str) -> str:
    """Fusiona los adaptadores LoRA en el modelo base y guarda en HF format."""
    _check_deps()
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base_model_file = os.path.join(lora_dir, "base_model.txt")
    if not os.path.exists(base_model_file):
        log.error(f"No se encontró {base_model_file}. ¿Has ejecutado fine_tune.py?")
        sys.exit(1)

    with open(base_model_file) as f:
        base_model = f.read().strip()

    log.info(f"Cargando modelo base: {base_model}")
    tokenizer = AutoTokenizer.from_pretrained(lora_dir, trust_remote_code=True)

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16,
        device_map={"": "cpu"},
        trust_remote_code=True,
    )

    log.info("Fusionando adaptadores LoRA...")
    model = PeftModel.from_pretrained(model, lora_dir)
    model = model.merge_and_unload()

    os.makedirs(merged_dir, exist_ok=True)
    log.info(f"Guardando modelo fusionado en {merged_dir}/...")
    model.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)

    return merged_dir


def convertir_a_gguf(merged_dir: str, gguf_dir: str) -> str:
    """Convierte el modelo HF a formato GGUF (Q4_K_M)."""
    os.makedirs(gguf_dir, exist_ok=True)
    gguf_path = os.path.join(gguf_dir, "bt-crypto-q4_k_m.gguf")

    metodo = _check_llamacpp()
    if metodo is None:
        log.warning("llama.cpp no encontrado. Instálalo con:")
        log.warning("  pip install llama-cpp-python  (recomendado)")
        log.warning("  o clona https://github.com/ggerganov/llama.cpp y compila")
        log.warning(f"Saltando conversión GGUF. El modelo fusionado está en: {merged_dir}/")
        log.warning("Puedes usar el modelo HF directamente en Ollama con --from si tu versión lo soporta.")
        return merged_dir

    if metodo == "llama_cpp_python":
        log.info("Convirtiendo a GGUF con llama-cpp-python...")
        try:
            from llama_cpp import llama_cpp
            # llama-cpp-python no expone conversión directa; usamos su script si existe
            raise ImportError("use script")
        except Exception:
            # Fallback: intentar con el script de llama.cpp si está en PATH
            result = subprocess.run(
                ["python", "-c",
                 f"from llama_cpp.llama_cpp import llama_model_quantize; "
                 f"print('llama_cpp_python no soporta conversión directa')"],
                capture_output=True, text=True
            )
            log.warning("llama-cpp-python no incluye conversión HF→GGUF.")
            log.warning("Instala llama.cpp manualmente para este paso.")
            return merged_dir
    else:
        # metodo es la ruta al script convert_hf_to_gguf.py
        log.info(f"Convirtiendo con {metodo}...")
        fp16_path = os.path.join(gguf_dir, "bt-crypto-f16.gguf")
        subprocess.run([
            sys.executable, metodo,
            merged_dir,
            "--outtype", "f16",
            "--outfile", fp16_path,
        ], check=True)

        log.info("Cuantizando a Q4_K_M...")
        quantize_bin = os.path.join(os.path.dirname(metodo), "llama-quantize")
        if not os.path.exists(quantize_bin):
            quantize_bin = os.path.join(os.path.dirname(metodo), "build", "bin", "llama-quantize")
        if os.path.exists(quantize_bin):
            subprocess.run([quantize_bin, fp16_path, gguf_path, "Q4_K_M"], check=True)
            os.remove(fp16_path)
            log.info(f"GGUF cuantizado: {gguf_path}")
            return gguf_path
        else:
            log.warning("llama-quantize no encontrado, usando modelo f16 sin cuantizar.")
            return fp16_path

    return merged_dir


def crear_modelfile(gguf_path: str, modelfile_path: str = MODELFILE_PATH) -> None:
    """Genera el Modelfile de Ollama."""
    # Si gguf_path apunta a un directorio HF (conversión fallida), usamos FROM con directorio
    if os.path.isdir(gguf_path):
        from_line = f"FROM {os.path.abspath(gguf_path)}"
    else:
        from_line = f"FROM {os.path.abspath(gguf_path)}"

    contenido = f"""{from_line}

SYSTEM \"\"\"{_SYSTEM_PROMPT_OLLAMA}\"\"\"

PARAMETER temperature 0.7
PARAMETER num_predict 1024
PARAMETER repeat_penalty 1.1
PARAMETER top_p 0.9
PARAMETER stop "<|end|>"
PARAMETER stop "<|endoftext|>"
"""
    with open(modelfile_path, "w") as f:
        f.write(contenido)
    log.info(f"Modelfile creado: {modelfile_path}")


def registrar_en_ollama(model_name: str, modelfile_path: str) -> bool:
    """Ejecuta `ollama create` para registrar el modelo localmente."""
    try:
        result = subprocess.run(
            ["ollama", "create", model_name, "-f", modelfile_path],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            log.info(f"Modelo registrado en Ollama: {model_name}")
            log.info(f"Úsalo con: ollama run {model_name}")
            return True
        else:
            log.error(f"Error al registrar en Ollama:\n{result.stderr}")
            return False
    except FileNotFoundError:
        log.error("Ollama no está instalado o no está en PATH.")
        return False


def exportar(lora_dir: str = LORA_DIR_DEFAULT,
             merged_dir: str = MERGED_DIR_DEFAULT,
             gguf_dir: str = GGUF_DIR_DEFAULT,
             model_name: str = MODEL_NAME_DEFAULT,
             modelfile_path: str = MODELFILE_PATH,
             solo_merge: bool = False) -> None:

    if not os.path.exists(lora_dir):
        log.error(f"No se encontró {lora_dir}. Ejecuta primero fine_tune.py.")
        sys.exit(1)

    # 1. Fusionar LoRA
    merged = fusionar_lora(lora_dir, merged_dir)

    if solo_merge:
        log.info(f"Modelo fusionado guardado en: {merged}")
        return

    # 2. Convertir a GGUF
    gguf_path = convertir_a_gguf(merged, gguf_dir)

    # 3. Modelfile
    crear_modelfile(gguf_path, modelfile_path)

    # 4. Registrar en Ollama
    ok = registrar_en_ollama(model_name, modelfile_path)

    print("\n" + "─" * 60)
    if ok:
        print(f"  Modelo listo: {model_name}")
        print(f"  Prueba con: ollama run {model_name}")
        print(f"  O configura BT_MODEL={model_name} en tu .env")
    else:
        print(f"  Modelo fusionado en: {merged}")
        print(f"  Modelfile en: {modelfile_path}")
        print(f"  Registra manualmente con: ollama create {model_name} -f {modelfile_path}")
    print("─" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Exportar modelo BT a Ollama")
    parser.add_argument("--lora",          default=LORA_DIR_DEFAULT)
    parser.add_argument("--merged_dir",    default=MERGED_DIR_DEFAULT)
    parser.add_argument("--gguf_dir",      default=GGUF_DIR_DEFAULT)
    parser.add_argument("--model_name",    default=MODEL_NAME_DEFAULT)
    parser.add_argument("--modelfile",     default=MODELFILE_PATH)
    parser.add_argument("--solo_merge",    action="store_true",
                        help="Solo fusionar LoRA, sin convertir a GGUF")
    args = parser.parse_args()

    exportar(
        lora_dir=args.lora,
        merged_dir=args.merged_dir,
        gguf_dir=args.gguf_dir,
        model_name=args.model_name,
        modelfile_path=args.modelfile,
        solo_merge=args.solo_merge,
    )
