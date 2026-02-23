import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import TradingTerminal from './components/TradingTerminal'
import MemeRadar from './components/MemeRadar'
import Portfolio from './components/Portfolio'
import Settings from './components/Settings'
import Login from './components/Login'
import LoadingSplash from './components/LoadingSplash'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('token'))
  const [activeTab, setActiveTab] = useState<'TRADE' | 'MEMES' | 'PORTFOLIO' | 'CONFIG'>('TRADE')
  const [currentSymbol, setCurrentSymbol] = useState('BTCUSDT')
  const [user, setUser] = useState({
    name: localStorage.getItem('userName') || '',
    plan: 'PRO ELITE',
    balance: 12500.50
  })

  const [marketData, setMarketData] = useState<Record<string, any>>({})
  const [aiInsights, setAiInsights] = useState<Record<string, any>>({})
  const [tradeHistory, setTradeHistory] = useState<any[]>([])
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const [alertFlash, setAlertFlash] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  const fetchData = async (symbol: string) => {
    try {
      const resPrice = await axios.get(`http://localhost:8081/prices/${symbol}`)
      const rawData = resPrice.data

      const price = parseFloat(rawData.price)
      const volume = parseFloat(rawData.volume)

      if (!isNaN(price) && price > 0) {
        let currentHistory: number[] = []
        let currentVolumes: number[] = []

        setMarketData(prev => {
          const oldEntry = prev[symbol] || { price: 0, history: [], volumes: [], change: "0%" }
          const newHistory = [...oldEntry.history, price].slice(-65)
          const newVolumes = [...(oldEntry.volumes || []), volume].slice(-65)

          currentHistory = newHistory
          currentVolumes = newVolumes

          return {
            ...prev,
            [symbol]: { price, history: newHistory, volumes: newVolumes, change: "+2.5%" }
          }
        })

        const resAi = await axios.post('http://localhost:8002/analyze', {
          symbol,
          price,
          history: currentHistory,
          volumes: currentVolumes
        })

        setAiInsights(prev => ({ ...prev, [symbol]: resAi.data }))
      }
    } catch (e) { }
  }

  useEffect(() => {
    if (!isLoggedIn || loading) return
    const mainCoins = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "TRUMPUSDT", "PEPEUSDT", "DOGEUSDT", "SHIBUSDT"]
    const allSymbols = Array.from(new Set([currentSymbol, ...mainCoins]))
    const int = setInterval(() => {
      allSymbols.forEach(s => fetchData(s))
    }, refreshInterval)
    return () => clearInterval(int)
  }, [currentSymbol, isLoggedIn, loading, refreshInterval])

  if (loading) return <LoadingSplash />
  if (!isLoggedIn) return <Login onLoginSuccess={() => setIsLoggedIn(true)} />

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw', background: '#080808', color: '#e0e0e0', overflow: 'hidden',
      transition: '0.3s',
      boxShadow: alertFlash ? 'inset 0 0 100px rgba(8, 153, 129, 0.2)' : 'none'
    }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={() => setIsLoggedIn(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header currentSymbol={currentSymbol} setCurrentSymbol={setCurrentSymbol} user={user} marketData={marketData} />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'TRADE' && <TradingTerminal symbol={currentSymbol} insight={aiInsights[currentSymbol]} history={tradeHistory} user={user} />}
          {activeTab === 'MEMES' && <MemeRadar onSelect={setCurrentSymbol} marketData={marketData} aiInsights={aiInsights} />}
          {activeTab === 'PORTFOLIO' && <Portfolio user={user} />}
          {activeTab === 'CONFIG' && <Settings setRefreshInterval={setRefreshInterval} currentInterval={refreshInterval} />}
        </main>
      </div>
    </div>
  )
}