"""
sentimiento.py — FinBERT: obtención de noticias y análisis de sentimiento.
"""
import time
from app.config import logger, CRYPTO_PANIC_KEY, CACHE_DURATION, NEWS_CACHE, NEWS_CACHE_MAX
import requests


def _evict_news_cache():
    if len(NEWS_CACHE) <= NEWS_CACHE_MAX:
        return
    now     = time.time()
    expired = [k for k, v in NEWS_CACHE.items() if now - v["time"] > CACHE_DURATION]
    for k in expired:
        del NEWS_CACHE[k]
    if len(NEWS_CACHE) > NEWS_CACHE_MAX:
        oldest = sorted(NEWS_CACHE.items(), key=lambda x: x[1]["time"])
        for k, _ in oldest[:len(NEWS_CACHE) - NEWS_CACHE_MAX]:
            del NEWS_CACHE[k]


def noticias_fallback(symbol: str) -> list:
    coin = symbol.replace("USDT", "")
    return [
        (f"Market monitoring active for {coin}.", "system"),
        (f"Volume analysis showing steady activity for {coin}.", "system"),
        (f"Waiting for new social sentiment signals.", "system"),
    ]


def obtener_noticias(symbol: str) -> list:
    coin = symbol.replace("USDT", "")
    now  = time.time()
    cached = NEWS_CACHE.get(coin)
    if cached and now - cached["time"] < CACHE_DURATION:
        return cached["data"]
    try:
        url  = (f"https://cryptopanic.com/api/v1/posts/"
                f"?auth_token={CRYPTO_PANIC_KEY}&currencies={coin}&kind=news")
        resp = requests.get(url, timeout=5)
        headlines = []
        if resp.status_code == 200:
            for post in resp.json().get('results', [])[:3]:
                t = post.get('title', '')
                if len(t) > 5:
                    headlines.append((t, post.get('domain', 'news')))
        if not headlines:
            g_url = (f"https://cryptopanic.com/api/v1/posts/"
                     f"?auth_token={CRYPTO_PANIC_KEY}&kind=news")
            gr = requests.get(g_url, timeout=5)
            if gr.status_code == 200:
                for post in gr.json().get('results', [])[:3]:
                    t = post.get('title', '')
                    if len(t) > 5:
                        headlines.append((t, post.get('domain', 'global_news')))
        final = headlines or noticias_fallback(symbol)
    except Exception as e:
        logger.debug(f"Error noticias {coin}: {e}")
        final = noticias_fallback(symbol)
    _evict_news_cache()
    NEWS_CACHE[coin] = {"data": final, "time": now}
    return final


def analizar_titulares(raw_news: list) -> tuple:
    from app.modelos import sentiment_model, tokenizer
    if not raw_news:
        return [], 0.0
    if not sentiment_model:
        results = [{"title": t, "source": s, "impact": 0.0, "label": "NEUTRAL"}
                   for t, s in raw_news]
        return results, 0.0
    try:
        import torch
        titles = [item[0] for item in raw_news]
        inputs = tokenizer(titles, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = sentiment_model(**inputs)
        scores  = torch.nn.functional.softmax(outputs.logits, dim=-1).numpy()
        results, total = [], 0.0
        for i, (title, source) in enumerate(raw_news):
            val   = float(scores[i, 0] - scores[i, 1])
            label = "BULLISH" if val > 0.1 else "BEARISH" if val < -0.1 else "NEUTRAL"
            results.append({"title": title, "source": source,
                            "impact": round(val, 2), "label": label})
            total += val
        return results, total / len(results)
    except Exception as e:
        logger.warning(f"Error sentimiento: {e}")
        return [], 0.0
