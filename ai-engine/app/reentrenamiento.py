"""
reentrenamiento.py — GestorReentrenamiento: ciclo de vida del modelo LSTM.
"""
import os
import time
import threading
import asyncio
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import requests
from app.config import logger, _has_ml, BINANCE_KLINES


class GestorReentrenamiento:
    RUTA_MODELO   = 'models/crypto_lstm_model_v3.keras'
    RUTA_SCALER   = 'models/scaler_v3.gz'
    SEQ_LEN       = 60
    FEATURES      = ['Close', 'Volume', 'RSI', 'MACD', 'StochRSI', 'EMA_cross', 'BB_pos', 'OBV_norm', 'Momentum']
    INTERVALO_H   = 24
    SIMBOLOS_FIJOS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BNBUSDT', 'XRPUSDT']

    def __init__(self):
        self.estado: str               = 'inactivo'
        self.ultimo_entrenamiento: Optional[str] = None
        self.metricas: dict            = {}
        self._lock                     = threading.Lock()
        self._executor                 = ThreadPoolExecutor(max_workers=1)

    @staticmethod
    def obtener_todos_usdt(max_simbolos: int = 0) -> list:
        try:
            info = requests.get("https://api.binance.com/api/v3/exchangeInfo", timeout=15).json()
            activos = {
                s['symbol'] for s in info.get('symbols', [])
                if s['status'] == 'TRADING'
                and s['quoteAsset'] == 'USDT'
                and s['isSpotTradingAllowed']
            }
            tickers  = requests.get("https://api.binance.com/api/v3/ticker/24hr", timeout=15).json()
            ordenados = sorted(
                [t for t in tickers if t['symbol'] in activos],
                key=lambda t: float(t.get('quoteVolume', 0)), reverse=True
            )
            simbolos = [t['symbol'] for t in ordenados]
            if max_simbolos > 0:
                simbolos = simbolos[:max_simbolos]
            logger.info(f"Símbolos USDT obtenidos de Binance: {len(simbolos)}")
            return simbolos
        except Exception as e:
            logger.warning(f"No se pudieron obtener símbolos de Binance: {e}. Usando lista fija.")
            return GestorReentrenamiento.SIMBOLOS_FIJOS

    def _construir_arquitectura(self):
        if not _has_ml:
            raise RuntimeError("TensorFlow no disponible")
        import tensorflow as tf
        modelo = tf.keras.Sequential([
            tf.keras.Input(shape=(self.SEQ_LEN, len(self.FEATURES))),
            tf.keras.layers.LSTM(128, return_sequences=True),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.LSTM(64),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(32, activation='relu'),
            tf.keras.layers.Dense(1),
        ])
        modelo.compile(optimizer='adam', loss='mse', metrics=['mae'])
        return modelo

    def _preparar_datos_simbolo(self, symbol: str, scaler_fit, limit: int = 1000, interval: str = '1h'):
        try:
            import pandas as pd
            import numpy as np
            from app.indicadores import IndicadoresTecnicos
            url  = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
            resp = requests.get(url, timeout=15)
            if resp.status_code != 200:
                return None, None
            rows = resp.json()
            if len(rows) < self.SEQ_LEN + 30:
                return None, None
            df = pd.DataFrame(rows, columns=[
                'ts','open','high','low','close','vol',
                'close_ts','quote_vol','trades','taker_base','taker_quote','ignore'
            ])
            df['Close']  = df['close'].astype(float)
            df['Volume'] = df['vol'].astype(float)
            df['RSI']    = IndicadoresTecnicos.rsi(df)
            df['MACD'], _ = IndicadoresTecnicos.macd(df)
            df['StochRSI'] = IndicadoresTecnicos.stoch_rsi(df)
            # EMA cross: (EMA9 - EMA21) / EMA21 × 100, clipado a [-10, 10]
            ema9  = df['Close'].ewm(span=9,  adjust=False).mean()
            ema21 = df['Close'].ewm(span=21, adjust=False).mean()
            df['EMA_cross'] = ((ema9 - ema21) / (ema21 + 1e-9) * 100).clip(-10, 10)
            # Bollinger position: (Close - lower) / (upper - lower) × 2 - 1
            sma20 = df['Close'].rolling(20).mean()
            std20 = df['Close'].rolling(20).std()
            bb_range = (2 * std20 * 2).replace(0, 1e-9)
            df['BB_pos'] = ((df['Close'] - (sma20 - 2 * std20)) / bb_range * 2 - 1).clip(-2, 2)
            # OBV normalizado por máximo rolling 50
            sign = df['Close'].diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
            obv_raw = (df['Volume'] * sign).cumsum()
            obv_max = obv_raw.abs().rolling(50, min_periods=1).max().replace(0, 1)
            df['OBV_norm'] = (obv_raw / obv_max).clip(-1, 1)
            # Momentum: retorno a 5 períodos
            df['Momentum'] = df['Close'].pct_change(5).clip(-0.1, 0.1)
            df.bfill(inplace=True); df.fillna(0, inplace=True)
            data_scaled = (scaler_fit.transform(df[self.FEATURES].values)
                           if hasattr(scaler_fit, 'scale_')
                           else scaler_fit.fit_transform(df[self.FEATURES].values))
            X, y = [], []
            for i in range(self.SEQ_LEN, len(data_scaled)):
                X.append(data_scaled[i - self.SEQ_LEN:i])
                y.append(data_scaled[i, 0])
            return np.array(X), np.array(y)
        except Exception as e:
            logger.warning(f"Error preparando datos de {symbol}: {e}")
            return None, None

    def _preparar_datos_multi(self, simbolos: list, limit: int = 1000, interval: str = '1h'):
        import numpy as np
        from sklearn.preprocessing import MinMaxScaler
        X_total, y_total = [], []
        scaler_btc = None
        ok, fallido, total = 0, 0, len(simbolos)
        for i, sym in enumerate(simbolos, 1):
            sc = MinMaxScaler()
            X, y = self._preparar_datos_simbolo(sym, sc, limit, interval)
            if X is None:
                fallido += 1
            else:
                X_total.append(X); y_total.append(y)
                if sym == 'BTCUSDT' or scaler_btc is None:
                    scaler_btc = sc
                ok += 1
            if i % 25 == 0 or i == total:
                logger.info(f"  Progreso: {i}/{total} — OK={ok} fallidos={fallido}")
            time.sleep(0.12)
        if not X_total:
            raise RuntimeError("Ningún símbolo devolvió datos válidos")
        logger.info(f"Dataset combinado: {ok} símbolos, {sum(len(x) for x in X_total)} secuencias totales")
        return np.concatenate(X_total), np.concatenate(y_total), scaler_btc

    def _ejecutar_entrenamiento(self, simbolos: list, epochs: int, desde_cero: bool):
        import numpy as np
        import joblib
        import app.modelos as modelos
        try:
            with self._lock:
                self.estado = 'entrenando'
            logger.info(f"Reentrenamiento iniciado — símbolos={simbolos} epochs={epochs} desde_cero={desde_cero}")
            X, y, scaler_nuevo = self._preparar_datos_multi(simbolos)
            indices = np.random.permutation(len(X))
            X, y = X[indices], y[indices]
            split = int(len(X) * 0.85)
            X_train, X_val = X[:split], X[split:]
            y_train, y_val = y[:split], y[split:]
            modelo = self._construir_arquitectura() if (desde_cero or modelos.lstm_model is None) else modelos.lstm_model
            historia = modelo.fit(X_train, y_train, epochs=epochs, batch_size=32,
                                  validation_data=(X_val, y_val), verbose=0)
            ruta_tmp = 'models/crypto_lstm_model_v3_new.keras'
            modelo.save(ruta_tmp)
            os.replace(ruta_tmp, self.RUTA_MODELO)
            joblib.dump(scaler_nuevo, self.RUTA_SCALER)
            modelos.lstm_model = modelo
            modelos.scaler     = scaler_nuevo
            metricas = {
                'loss_final':     round(float(historia.history['loss'][-1]), 6),
                'val_loss_final': round(float(historia.history['val_loss'][-1]), 6),
                'epochs': epochs, 'muestras': len(X_train), 'simbolos': simbolos,
            }
            with self._lock:
                self.estado               = 'inactivo'
                self.ultimo_entrenamiento = datetime.utcnow().isoformat() + 'Z'
                self.metricas             = metricas
            logger.info(f"Reentrenamiento completado — {metricas}")
        except Exception as e:
            logger.error(f"Error en reentrenamiento: {e}")
            with self._lock:
                self.estado   = 'error'
                self.metricas = {'error': str(e)}

    def lanzar(self, simbolos: list = None, epochs: int = 5, desde_cero: bool = False) -> bool:
        with self._lock:
            if self.estado == 'entrenando':
                return False
        if simbolos is None:
            simbolos = self.obtener_todos_usdt()
        self._executor.submit(self._ejecutar_entrenamiento, simbolos, epochs, desde_cero)
        return True

    def estado_actual(self) -> dict:
        import app.modelos as modelos
        with self._lock:
            return {
                'estado':               self.estado,
                'ultimo_entrenamiento': self.ultimo_entrenamiento,
                'metricas':             self.metricas,
                'lstm_cargado':         modelos.lstm_model is not None,
            }


# Instancia global
gestor_reentrenamiento = GestorReentrenamiento()


async def _ciclo_reentrenamiento_automatico():
    intervalo_s = GestorReentrenamiento.INTERVALO_H * 3600
    # Reentrenar inmediatamente desde cero si no existe el modelo v3
    _existe = (os.path.exists(GestorReentrenamiento.RUTA_MODELO) or
               os.path.exists('models/crypto_lstm_model_v3.h5'))
    if not _existe:
        logger.info("Modelo v3 no encontrado — reentrenando desde cero con 9 features")
        gestor_reentrenamiento.lanzar(desde_cero=True)
    await asyncio.sleep(intervalo_s)
    while True:
        logger.info("Reentrenamiento automático — iniciando ciclo periódico")
        gestor_reentrenamiento.lanzar()
        await asyncio.sleep(intervalo_s)
