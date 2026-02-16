from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np
from sklearn.linear_model import SGDRegressor
from sklearn.preprocessing import StandardScaler
from collections import deque
from fastapi.middleware.cors import CORSMiddleware
import joblib

app = FastAPI(title="Crypto AI Trader", version="2.0.0")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Usamos SGDRegressor porque soporta 'partial_fit' (aprender sobre la marcha)
model = SGDRegressor(loss='huber', penalty='l2', learning_rate='adaptive')
scaler = StandardScaler()

# Inicialización del modelo (necesita ver datos una vez para arrancar)
# Le damos un empujón inicial simulado para que no empiece vacío
initial_X = np.array([[50000]])
initial_y = np.array([50000])
model.partial_fit(initial_X, initial_y)

# --- MEMORIA DEL MERCADO ---
# Guardamos los últimos 30 precios para entender el contexto (Ventana deslizante)
price_window = deque(maxlen=30)
accuracy_window = deque(maxlen=50) # Para medir qué tan buena es la IA

class MarketData(BaseModel):
    symbol: str
    price: float

@app.get("/")
def home():
    return {"status": "AI Trader Learning... 🧠", "strategy": "Online SGD"}

@app.post("/analyze")
def analyze_market(data: MarketData):
    try:
        global model, scaler

        current_price = data.price

        # 1. ACTUALIZAR MEMORIA
        price_window.append(current_price)

        # Necesitamos al menos 2 datos para detectar tendencia
        if len(price_window) < 2:
            return {
                "recommendation": "RECOPILANDO DATOS...",
                "signal": "WAIT",
                "confidence": 0,
                "prediction": current_price
            }

        # 2. PREPARAR DATOS (Feature Engineering Real-Time)
        # Usamos el precio anterior para predecir el actual (Entrenamiento)
        last_price = price_window[-2]
        X = np.array([[last_price]]) # Entrada: Precio anterior
        y = np.array([current_price]) # Salida Correcta: Precio actual

        # 3. AUTO-ENTRENAMIENTO (El momento mágico ✨)
        # La IA ajusta sus neuronas basándose en el error que acaba de cometer
        model.partial_fit(X, y)

        # 4. PREDICCIÓN FUTURA (¿Qué pasará en el siguiente tick?)
        # Usamos el precio actual para predecir el siguiente
        X_next = np.array([[current_price]])
        predicted_next_price = model.predict(X_next)[0]

        # 5. GENERAR SEÑAL DE TRADING
        # Umbral de sensibilidad (0.005% de movimiento mínimo para operar)
        threshold = current_price * 0.00005

        signal = "MANTENER"
        recommendation = "Observando mercado..."
        action_color = "GRAY"

        diff = predicted_next_price - current_price

        if diff > threshold:
            signal = "COMPRAR 🚀"
            recommendation = "Tendencia ALCISTA detectada"
            action_color = "GREEN"
        elif diff < -threshold:
            signal = "VENDER 📉"
            recommendation = "Tendencia BAJISTA detectada"
            action_color = "RED"

        # 6. CALCULAR PRECISIÓN (Auto-evaluación)
        # Guardamos el error absoluto
        error = abs(current_price - predicted_next_price)
        accuracy_window.append(error)
        avg_error = sum(accuracy_window) / len(accuracy_window)

        # "Confianza" basada en qué tan pequeño es el error promedio
        confidence = max(0, 100 - (avg_error / current_price * 10000))

        return {
            "symbol": data.symbol,
            "current_price": current_price,
            "predicted_next": round(predicted_next_price, 2),
            "signal": signal,
            "recommendation": recommendation,
            "confidence": f"{round(confidence, 2)}%",
            "learning_rate": "Adaptativo (Activo)",
            "action_color": action_color
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))