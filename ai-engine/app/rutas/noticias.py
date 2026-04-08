"""rutas/noticias.py — /news, /trending-radar"""
from fastapi import APIRouter, HTTPException
from app.config import logger
from app.sentimiento import obtener_noticias, analizar_titulares

router = APIRouter()

_MEMES = ["PEPEUSDT", "DOGEUSDT", "SHIBUSDT", "WIFUSDT", "BONKUSDT", "TRUMPUSDT"]


@router.get("/news")
async def get_news(symbols: str = "BTC,ETH,SOL,DOGE,PEPE", limit: int = 20):
    if len(symbols) > 200:
        raise HTTPException(status_code=400, detail="Parámetro symbols demasiado largo (máx 200 caracteres)")
    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    all_news, seen_titles = [], set()
    for coin in symbol_list[:8]:
        symbol = coin + "USDT" if not coin.endswith("USDT") else coin
        try:
            news_data = obtener_noticias(symbol)
            details, _ = analizar_titulares(news_data)
            for item in details:
                if item["title"] not in seen_titles:
                    seen_titles.add(item["title"])
                    item["symbol"] = coin
                    all_news.append(item)
        except Exception:
            pass
    all_news.sort(key=lambda x: abs(x.get("impact", 0)), reverse=True)
    return all_news[:limit]


@router.get("/trending-radar")
async def get_trending_radar():
    results = []
    for m in _MEMES:
        try:
            news_data = obtener_noticias(m)
            news_details, avg_sentiment = analizar_titulares(news_data)
            sentiment_label = ("BULLISH" if avg_sentiment > 0.05
                               else "BEARISH" if avg_sentiment < -0.05 else "NEUTRAL")
            conf = int(min(75, max(40, abs(avg_sentiment) * 50 + 45)))
            results.append({
                "symbol":       m,
                "signal":       "COMPRAR 🚀" if avg_sentiment > 0.1 else "VENDER 📉" if avg_sentiment < -0.1 else "MANTENER ⚖️",
                "sentiment":    sentiment_label,
                "confidence":   conf,
                "tech_impact":  0.0,
                "news_impact":  round(avg_sentiment, 2),
                "alert":        "HIGH" if conf > 65 else "MEDIUM",
                "lstm_active":  False,
                "news_details": news_details[:2],
            })
        except Exception as e:
            logger.warning(f"Error trending-radar {m}: {e}")
            results.append({"symbol": m, "signal": "MANTENER ⚖️", "sentiment": "NEUTRAL",
                            "confidence": 45, "tech_impact": 0.0, "news_impact": 0.0,
                            "alert": "MEDIUM", "lstm_active": False, "news_details": []})
    return results
