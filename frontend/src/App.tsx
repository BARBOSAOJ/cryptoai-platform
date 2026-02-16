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

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  const fetchData = async () => {
    try {
      const resAll = await axios.get('http://localhost:8081/prices')
      const allPrices = resAll.data;

      const updatedData: Record<string, any> = {}
      Object.keys(allPrices).forEach(sym => {
        updatedData[sym] = { price: parseFloat(allPrices[sym]), change: "+0.00%" }
      })

      setMarketData(updatedData)

      const price = updatedData[currentSymbol]?.price || 0
      if (price > 0) {
        const resAi = await axios.post('http://localhost:8002/analyze', { symbol: currentSymbol, price })
        setAiInsights(prev => ({ ...prev, [currentSymbol]: resAi.data }))
      }
    } catch (e) { }
  }

  useEffect(() => {
    if (!isLoggedIn || loading) return
    const int = setInterval(fetchData, refreshInterval)
    fetchData()
    return () => clearInterval(int)
  }, [currentSymbol, isLoggedIn, loading, refreshInterval])

  if (loading) return <LoadingSplash />
  if (!isLoggedIn) return <Login onLoginSuccess={(d) => setIsLoggedIn(true)} />

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#080808', color: '#e0e0e0', overflow: 'hidden' }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={() => setIsLoggedIn(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header
          currentSymbol={currentSymbol}
          setCurrentSymbol={setCurrentSymbol}
          user={user}
          marketData={marketData}
        />
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