
// ─── Constantes ────────────────────────────────────────────────────────────────
export const WATCHLIST_COINS = [
  { id: 'BTCUSDT',  name: 'Bitcoin',   type: 'MAJOR' },
  { id: 'ETHUSDT',  name: 'Ethereum',  type: 'MAJOR' },
  { id: 'SOLUSDT',  name: 'Solana',    type: 'MAJOR' },
  { id: 'DOGEUSDT', name: 'Dogecoin',  type: 'MEME'  },
  { id: 'PEPEUSDT', name: 'Pepe',      type: 'MEME'  },
  { id: 'SHIBUSDT', name: 'Shiba Inu', type: 'MEME'  },
  { id: 'WIFUSDT',  name: 'Wifhat',    type: 'MEME'  },
]

// ─── Tipos de pantalla / navegación ───────────────────────────────────────────
export type Tab = 'TRADE' | 'MEMES' | 'PORTFOLIO' | 'WATCHLIST' | 'NEWS' | 'CHARTS' | 'ALERTS' | 'PROFILE' | 'CONFIG'

// ─── Dominio de mercado ────────────────────────────────────────────────────────
export interface Coin {
  id:   string
  name: string
  type: string
}

export interface MarketTick {
  price:   number
  history: number[]
  volumes: number[]
  change:  string
}

export type MarketDataMap = Record<string, MarketTick>

// ─── Análisis IA ───────────────────────────────────────────────────────────────
export interface TechnicalIndicators {
  rsi:           number
  macd_histogram: number
  ema_cross:     string   // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  bb_position:   string   // 'UPPER' | 'LOWER' | 'MIDDLE'
  volume_spike:  boolean
}

export interface AiAnalysis {
  symbol:        string
  signal:        string
  recommendation: string
  confidence:    string
  action_color:  string
  predicted_next: number
  lstm_active?:  boolean
  indicators?:   TechnicalIndicators
  news_details?: NewsItem[]
}

export type AiInsightsMap = Record<string, AiAnalysis>

// ─── Noticias ──────────────────────────────────────────────────────────────────
export interface NewsItem {
  title:     string
  source:    string
  label:     'BULLISH' | 'BEARISH' | 'NEUTRAL'
  impact:    number
  symbol?:   string
  url?:      string
  published?: string
}

// ─── Usuario y configuración ───────────────────────────────────────────────────
export interface UserProfile {
  id:              number
  email:           string
  fullName:        string
  avatarInitials:  string
  bio:             string
  createdAt:       string
}

export interface UserSettings {
  theme:                string
  notificationsEnabled: boolean
  alertThreshold:       number
  defaultInterval:      number
  tradingEnabled:       boolean
  maxOrderSizeUsdt:     number
  hasBinanceKeys:       boolean
  watchlistSymbols:     string
}

// ─── Alertas de precio ─────────────────────────────────────────────────────────
export interface PriceAlert {
  id:          number
  symbol:      string
  targetPrice: number
  direction:   'ABOVE' | 'BELOW'
  message?:    string
  triggered:   boolean
  createdAt:   string
}
