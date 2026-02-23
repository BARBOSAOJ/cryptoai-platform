import os
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import tensorflow as tf
import joblib
import numpy as np
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import requests
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CRYPTO_PANIC_KEY = "28362ce532a46ffa882ed3bada3fec298619f83f"
NEWS_CACHE = {}
CACHE_DURATION = 300

try:
    tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
    sentiment_model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
except:
    tokenizer = sentiment_model = None

try:
    lstm_model = tf.keras.models.load_model('models/crypto_lstm_model_v2.h5')
    scaler = joblib.load('models/scaler_v2.gz')
except:
    lstm_model = scaler = None

class MarketRequest(BaseModel):
    symbol: str
    price: float
    history: List[float]
    volumes: Optional[List[float]] = None

def calculate_rsi(data, window=14):
    delta = data['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))

def calculate_macd(data, short_window=12, long_window=26, signal_window=9):
    short_ema = data['Close'].ewm(span=short_window, adjust=False).mean()
    long_ema = data['Close'].ewm(span=long_window, adjust=False).mean()
    macd = short_ema - long_ema
    signal = macd.ewm(span=signal_window, adjust=False).mean()
    return macd, signal

def get_fallback_news(symbol):
    coin = symbol.replace("USDT", "")
    return [
        (f"Market monitoring active for {coin}.", "system"),
        (f"Volume analysis showing steady activity for {coin}.", "system"),
        (f"Waiting for new social sentiment signals.", "system")
    ]

def fetch_real_news(symbol):
    coin = symbol.replace("USDT", "")
    current_time = time.time()

    if coin in NEWS_CACHE:
        if current_time - NEWS_CACHE[coin]["time"] < CACHE_DURATION:
            return NEWS_CACHE[coin]["data"]

    try:
        url = f"https://cryptopanic.com/api/v1/posts/?auth_token={CRYPTO_PANIC_KEY}&currencies={coin}&kind=news"
        response = requests.get(url, timeout=5)

        headlines = []
        if response.status_code == 200:
            data = response.json()
            if 'results' in data:
                for post in data['results'][:3]:
                    domain = post.get('domain', 'news')
                    title = post['title']
                    if len(title) > 5:
                        headlines.append((title, domain))

        if not headlines:
            url_general = f"https://cryptopanic.com/api/v1/posts/?auth_token={CRYPTO_PANIC_KEY}&kind=news"
            response_gen = requests.get(url_general, timeout=5)
            if response_gen.status_code == 200:
                data = response_gen.json()
                if 'results' in data:
                    for post in data['results'][:3]:
                        domain = post.get('domain', 'global_news')
                        title = post['title']
                        if len(title) > 5:
                            headlines.append((title, domain))

        final_news = headlines if headlines else get_fallback_news(symbol)

    except:
        final_news = get_fallback_news(symbol)

    NEWS_CACHE[coin] = {"data": final_news, "time": current_time}
    return final_news

def analyze_headlines(raw_news):
    if not raw_news or not sentiment_model:
        return [], 0.0

    results = []
    total_score = 0.0

    try:
        titles = [item[0] for item in raw_news]
        inputs = tokenizer(titles, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = sentiment_model(**inputs)
        scores = torch.nn.functional.softmax(outputs.logits, dim=-1).numpy()

        for i, (title, source) in enumerate(raw_news):
            val = float(scores[i, 0] - scores[i, 1])
            if val > 0.1: label = "BULLISH"
            elif val < -0.1: label = "BEARISH"
            else: label = "NEUTRAL"

            results.append({
                "title": title,
                "source": source,
                "impact": round(val, 2),
                "label": label
            })
            total_score += val

        return results, total_score / len(results)
    except:
        return [], 0.0

async def perform_analysis(symbol, price, history, volumes=None):
    news_data = fetch_real_news(symbol)
    news_details, avg_sentiment = analyze_headlines(news_data)

    tech_score = 0.0
    if lstm_model and len(history) >= 60:
        try:
            if not volumes or len(volumes) != len(history):
                volumes = [1000.0] * len(history)

            df = pd.DataFrame({'Close': history, 'Volume': volumes})
            df['RSI'] = calculate_rsi(df)
            df['MACD'], _ = calculate_macd(df)

            df.bfill(inplace=True)
            df.fillna(0, inplace=True)

            data_matrix = df[['Close', 'Volume', 'RSI', 'MACD']].values[-60:]
            scaled_data = scaler.transform(data_matrix)

            pred = lstm_model.predict(np.array([scaled_data]), verbose=0)

            dummy_matrix = np.zeros((1, 4))
            dummy_matrix[0, 0] = pred[0][0]
            p_val = float(scaler.inverse_transform(dummy_matrix)[0][0])

            tech_score = float(((p_val - price) / price) * 100)
        except:
            pass

    combined = (tech_score * 0.6) + (avg_sentiment * 0.4)

    signal = "MANTENER ⚖️"
    if combined > 0.12: signal = "COMPRAR 🚀"
    if combined < -0.12: signal = "VENDER 📉"

    conf = int(min(99, max(50, abs(combined) * 40 + 55)))

    return {
        "symbol": symbol,
        "signal": signal,
        "confidence": f"{conf}%",
        "tech_impact": float(round(tech_score, 2)),
        "news_impact": float(round(avg_sentiment, 2)),
        "news_details": news_details
    }

@app.post("/analyze")
async def analyze(request: MarketRequest):
    return await perform_analysis(request.symbol, request.price, request.history, request.volumes)

@app.get("/trending-radar")
async def get_trending_radar():
    memes = ["PEPEUSDT", "DOGEUSDT", "SHIBUSDT", "WIFUSDT", "BONKUSDT", "TRUMPUSDT"]
    results = []
    for m in memes:
        analysis = await perform_analysis(m, 1.0, [1.0] * 60, [1000.0] * 60)
        results.append({
            "symbol": m,
            "signal": analysis["signal"],
            "sentiment": "BULLISH" if analysis["news_impact"] > 0 else "BEARISH",
            "confidence": int(analysis["confidence"].replace("%", "")),
            "tech_impact": analysis["tech_impact"],
            "news_impact": analysis["news_impact"],
            "alert": "HIGH" if int(analysis["confidence"].replace("%", "")) > 85 else "MEDIUM"
        })
    return results

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)