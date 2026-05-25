"""
fine_tune.py — Fine-tuning de BT con LoRA sobre Phi-3.5-mini-instruct.

Detecta automáticamente si hay GPU (QLoRA 4-bit) o solo CPU (LoRA fp32).
El modelo resultante se guarda en models/bt-lora/ listo para exportar.

Uso:
    # Desde ai-engine/ con el venv activo:
    python -m app.bt.entrenamiento.fine_tune

    # Opciones:
    python -m app.bt.entrenamiento.fine_tune \\
        --base_model microsoft/Phi-3.5-mini-instruct \\
        --epochs 3 \\
        --n_ejemplos 800 \\
        --output models/bt-lora

Duración aproximada:
    - GPU (RTX 3060 12GB): ~25 min
    - CPU (8 cores, 16GB RAM): ~3-5 horas
"""
import os
import sys
import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bt.finetune")

BASE_MODEL_DEFAULT = "microsoft/Phi-3.5-mini-instruct"
OUTPUT_DEFAULT     = "models/bt-lora"


def _check_deps():
    missing = []
    for pkg in ("transformers", "peft", "trl", "datasets", "accelerate"):
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        log.error(f"Faltan dependencias: {', '.join(missing)}")
        log.error("Instala con: pip install -r requirements-train.txt")
        sys.exit(1)


def entrenar(base_model: str, n_ejemplos: int, epochs: int, output: str,
             lora_r: int = 8, lora_alpha: int = 16, batch_size: int = 2,
             grad_accum: int = 4, lr: float = 5e-5) -> None:

    _check_deps()

    import torch
    from datasets import Dataset
    from transformers import (AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig)
    from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    from app.bt.entrenamiento.dataset import generar_dataset

    cuda_ok = torch.cuda.is_available()
    device   = "cuda" if cuda_ok else "cpu"
    log.info(f"Dispositivo: {device.upper()}" + (f" — {torch.cuda.get_device_name(0)}" if cuda_ok else " (sin GPU)"))
    log.info(f"Modelo base: {base_model}")
    log.info(f"Ejemplos: {n_ejemplos} | Epochs: {epochs} | LR: {lr}")

    # ── Dataset ───────────────────────────────────────────────────────────────
    log.info("Generando dataset de entrenamiento...")
    raw = generar_dataset(n_ejemplos)

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    def aplicar_template(ejemplo):
        texto = tokenizer.apply_chat_template(
            ejemplo["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": texto}

    dataset_raw = Dataset.from_list(raw)
    dataset     = dataset_raw.map(aplicar_template, remove_columns=["messages"])
    log.info(f"Dataset listo: {len(dataset)} ejemplos")

    # ── Modelo ────────────────────────────────────────────────────────────────
    model_kwargs = {"trust_remote_code": True, "torch_dtype": torch.bfloat16 if cuda_ok else torch.float32}

    if cuda_ok:
        bnb_cfg = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        model_kwargs["quantization_config"] = bnb_cfg
        model_kwargs["device_map"]          = "auto"
        log.info("Cargando modelo con QLoRA (4-bit)...")
    else:
        model_kwargs["device_map"] = {"": "cpu"}
        log.info("Cargando modelo en CPU (fp32) — esto tardará unos minutos...")

    model = AutoModelForCausalLM.from_pretrained(base_model, **model_kwargs)

    if cuda_ok:
        model = prepare_model_for_kbit_training(model)

    # ── LoRA ──────────────────────────────────────────────────────────────────
    # target_modules para Phi-3.5-mini: qkv_proj y o_proj son las proyecciones de atención
    lora_cfg = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        target_modules=["qkv_proj", "o_proj", "gate_up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Entrenamiento ─────────────────────────────────────────────────────────
    os.makedirs(output, exist_ok=True)
    training_args = SFTConfig(
        output_dir=output,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        fp16=False,
        bf16=cuda_ok,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=1,
        report_to="none",
        dataloader_pin_memory=cuda_ok,
        gradient_checkpointing=cuda_ok,
        optim="adamw_torch_fused" if cuda_ok else "adamw_torch",
        dataset_text_field="text",
        max_length=640,
    )

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        args=training_args,
    )

    # Resume from checkpoint if one exists (allows continuing interrupted training)
    resume_ckpt = None
    ckpts = sorted([d for d in os.listdir(output) if d.startswith("checkpoint-")]) if os.path.exists(output) else []
    if ckpts:
        resume_ckpt = os.path.join(output, ckpts[-1])
        log.info(f"Reanudando desde checkpoint: {resume_ckpt}")

    # Offline mode: evita requests HTTP de HuggingFace durante el guardado
    # de checkpoints en contexto multi-thread (causa deadlock entre epochs)
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"

    log.info("Iniciando entrenamiento...")
    trainer.train(resume_from_checkpoint=resume_ckpt)

    log.info(f"Guardando adaptadores LoRA en {output}/...")
    trainer.model.save_pretrained(output)
    tokenizer.save_pretrained(output)

    # Guardar también la referencia al modelo base para exportar.py
    with open(os.path.join(output, "base_model.txt"), "w") as f:
        f.write(base_model)

    log.info(f"Fine-tuning completado. Adaptadores en: {output}/")
    log.info("Siguiente paso: python -m app.bt.entrenamiento.exportar")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune BT con LoRA")
    parser.add_argument("--base_model",  default=BASE_MODEL_DEFAULT)
    parser.add_argument("--epochs",      type=int,   default=3)
    parser.add_argument("--n_ejemplos",  type=int,   default=1000)
    parser.add_argument("--output",      default=OUTPUT_DEFAULT)
    parser.add_argument("--lora_r",      type=int,   default=8)
    parser.add_argument("--lora_alpha",  type=int,   default=16)
    parser.add_argument("--batch_size",  type=int,   default=2)
    parser.add_argument("--grad_accum",  type=int,   default=4)
    parser.add_argument("--lr",          type=float, default=5e-5)
    args = parser.parse_args()

    entrenar(
        base_model=args.base_model,
        n_ejemplos=args.n_ejemplos,
        epochs=args.epochs,
        output=args.output,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        batch_size=args.batch_size,
        grad_accum=args.grad_accum,
        lr=args.lr,
    )
