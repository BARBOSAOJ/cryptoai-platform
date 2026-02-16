
// 1. Constantes
export const WATCHLIST_COINS = [
  { id: 'BTCUSDT', name: 'Bitcoin', type: 'MAJOR' },
  { id: 'ETHUSDT', name: 'Ethereum', type: 'MAJOR' },
  { id: 'SOLUSDT', name: 'Solana', type: 'MAJOR' },
  { id: 'DOGEUSDT', name: 'Dogecoin', type: 'MEME' },
  { id: 'PEPEUSDT', name: 'Pepe', type: 'MEME' },
  { id: 'SHIBUSDT', name: 'Shiba Inu', type: 'MEME' },
  { id: 'WIFUSDT', name: 'Wifhat', type: 'MEME' },
]

// 2. Interfaces
export interface Coin {
  id: string;
  name: string;
  type: string;
}

export interface AiAnalysis {
  symbol: string;
  signal: string;
  recommendation: string;
  confidence: string;
  action_color: string;
  predicted_next: number;
}

export type MarketDataMap = Record<string, number>;

export type AiInsightsMap = Record<string, AiAnalysis>;
