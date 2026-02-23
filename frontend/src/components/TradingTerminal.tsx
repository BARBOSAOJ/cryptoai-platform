import { useState, useEffect } from 'react'
import axios from 'axios'
import { Clock, Cpu, Target, ShieldCheck, ChevronDown, ChevronUp, Settings2, AlertCircle, Newspaper, Zap, Play, BarChart3 } from 'lucide-react'

const NewsPanel = ({ news }: { news: any[] }) => (
  <div style={{ width: '300px', background: '#0b0e11', borderLeft: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '20px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <Newspaper size={16} color="#FCD535" />
      <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>REDES & NOTICIAS (EN VIVO)</span>
    </div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
      {!news || news.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#444', fontSize: '11px', marginTop: '20px' }}>
          <Zap size={20} style={{ marginBottom: '10px', opacity: 0.2 }} />
          <p>Sin noticias recientes o falta API Key</p>
        </div>
      ) : (
        news.map((item, i) => (
          <div key={i} style={{ background: '#161a1e', padding: '12px', borderRadius: '8px', marginBottom: '12px', border: '1px solid #2b3139' }}>
            {/* TÍTULO DE LA NOTICIA */}
            <div style={{ fontSize: '11px', lineHeight: '1.4', marginBottom: '6px', color: '#e0e0e0' }}>
              {item.title}
            </div>

            {/* FUENTE (ej: twitter.com) */}
            <div style={{ fontSize: '9px', color: '#848e9c', marginBottom: '8px', fontStyle: 'italic' }}>
              Fuente: {item.source}
            </div>

            {/* ETIQUETAS DE LA IA */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{
                fontSize: '9px', fontWeight: '900', padding: '2px 6px', borderRadius: '4px',
                background: item.label === 'BULLISH' ? '#08998120' : item.label === 'BEARISH' ? '#f2364520' : '#2a2e39',
                color: item.label === 'BULLISH' ? '#089981' : item.label === 'BEARISH' ? '#f23645' : '#848e9c'
              }}>{item.label}</div>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#444' }}>IMPACTO: {item.impact}</div>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
)

export default function TradingTerminal({ symbol, insight, history = [], user }: any) {
  const [expanded, setExpanded] = useState({
    console: true,
    log: false,
    risk: true,
    auto: true
  })

  const [riskParams, setRiskParams] = useState({ risk: 1, entry: 0, stop: 0 })
  const [calcResult, setCalcResult] = useState({ size: 0, amount: 0 })

  const isBuy = insight?.signal?.includes('COMPRAR')
  const confidence = insight?.confidence || "50"

  const toggleSection = (section: keyof typeof expanded) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const syncRiskCalculation = async (params: any) => {
    if (params.entry > 0 && params.stop > 0 && params.entry !== params.stop) {
      try {
        const res = await axios.post('http://localhost:8081/risk/calculate', {
          balance: user.balance,
          riskPercentage: params.risk,
          entryPrice: params.entry,
          stopLoss: params.stop
        })
        setCalcResult({ size: res.data.positionSize, amount: res.data.riskAmount })
      } catch (e) { }
    }
  }

  const handleInputChange = (field: string, value: number) => {
    const newParams = { ...riskParams, [field]: value }
    setRiskParams(newParams)
    syncRiskCalculation(newParams)
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#080808', width: '100%' }}>
      <div style={{ flex: 1, position: 'relative', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          <iframe
            title={symbol}
            src={`https://s.tradingview.com/widgetembed/?symbol=BINANCE%3A${symbol}&interval=1&theme=dark&style=1`}
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        </div>

        <div style={aiBadgeStyle(isBuy)}>
          <div style={{ fontSize: '10px', color: '#848e9c', fontWeight: 'bold' }}>ESTADO IA</div>
          <div style={{ fontSize: '16px', fontWeight: '800', color: isBuy ? '#089981' : '#fff' }}>
            {isBuy ? 'OPORTUNIDAD DETECTADA' : 'MONITORIZANDO'}
          </div>
        </div>
      </div>

      <aside style={{ width: '320px', background: '#0b0e11', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a1a', overflowY: 'auto' }}>

        <div style={sectionWrapperStyle}>
          <div onClick={() => toggleSection('console')} style={headerActionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FCD535' }}>
              <Cpu size={16} />
              <span style={{ fontWeight: '800', fontSize: '11px', letterSpacing: '1px' }}>AI CONSOLE</span>
            </div>
            {expanded.console ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
          </div>
          {expanded.console && (
            <div style={{ padding: '0 20px 20px 20px' }}>
              <div style={confidenceCardStyle}>
                <div style={{ fontSize: '10px', color: '#848e9c', marginBottom: '10px' }}>PRECISIÓN COMBINADA</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div style={{ fontSize: '18px', fontWeight: '900', color: isBuy ? '#089981' : '#fff' }}>{insight?.signal || 'ESCANEO'}</div>
                  <div style={{ fontSize: '12px', color: '#848e9c' }}>{confidence}%</div>
                </div>
                <div style={{ width: '100%', height: '4px', background: '#2b3139', borderRadius: '2px', marginTop: '10px' }}>
                  <div style={{ width: `${confidence}%`, height: '100%', background: isBuy ? '#089981' : '#FCD535', borderRadius: '2px', transition: '1s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={sectionWrapperStyle}>
          <div onClick={() => toggleSection('log')} style={headerActionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={14} color="#848e9c" />
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#848e9c' }}>LOG DE OPERACIONES</span>
            </div>
            {expanded.log ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
          </div>
          {expanded.log && (
            <div style={{ padding: '0 20px 20px 20px', maxHeight: '200px', overflowY: 'auto' }}>
              {history?.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#444', fontSize: '11px' }}>Esperando señales...</div>
              ) : (
                history.map((h: any) => (
                  <div key={h.id} style={logItemStyle}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{h.symbol} • <span style={{ color: '#089981' }}>LONG</span></div>
                      <div style={{ fontSize: '10px', color: '#848e9c' }}>${h.price}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div style={sectionWrapperStyle}>
          <div onClick={() => toggleSection('risk')} style={headerActionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings2 size={14} color="#848e9c" />
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#848e9c' }}>GESTIÓN DE RIESGO</span>
            </div>
            {expanded.risk ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
          </div>
          {expanded.risk && (
            <div style={{ padding: '0 20px 20px 20px' }}>
              <div style={toolCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '11px', fontWeight: 'bold' }}>
                  <Target size={14} color="#FCD535" /> CALCULADORA (AUTO)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <input type="number" placeholder="Entrada" onChange={(e) => handleInputChange('entry', parseFloat(e.target.value))} style={toolInputStyle} />
                  <input type="number" placeholder="Stop" onChange={(e) => handleInputChange('stop', parseFloat(e.target.value))} style={toolInputStyle} />
                </div>
                <div style={{ marginTop: '12px', background: '#0b0e11', padding: '10px', borderRadius: '8px', border: '1px solid #2b3139' }}>
                  <div style={{ fontSize: '10px', color: '#848e9c' }}>TAMAÑO RECOMENDADO</div>
                  <div style={{ fontSize: '18px', fontWeight: '900', color: '#fff' }}>
                    {calcResult.size.toFixed(4)} <span style={{ fontSize: '12px', fontWeight: 'normal' }}>{symbol.replace('USDT', '')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={sectionWrapperStyle}>
          <div onClick={() => toggleSection('auto')} style={headerActionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={14} color="#089981" />
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#848e9c' }}>AUTO-TRADE (SIMULADO)</span>
            </div>
            {expanded.auto ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
          </div>
          {expanded.auto && (
            <div style={{ padding: '0 20px 20px 20px' }}>
              <div style={{ ...toolCardStyle, borderColor: isBuy ? '#08998140' : '#2b3139' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <div style={{ fontSize: '10px', color: '#848e9c' }}>ESTRATEGIA IA ACTIVA</div>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#089981', boxShadow: '0 0 8px #089981' }}></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9px', color: '#444', marginBottom: '2px' }}>PROY. GANANCIA</div>
                    <div style={{ fontSize: '16px', fontWeight: '900', color: '#089981' }}>+${(user.balance * (parseInt(confidence)/1000)).toFixed(2)}</div>
                  </div>
                  <BarChart3 size={24} color="#2b3139" />
                </div>
                <button style={autoTradeButtonStyle(isBuy)}>
                  {isBuy ? 'EJECUTAR ORDEN IA' : 'ESPERANDO SEÑAL'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '20px', borderTop: '1px solid #1a1a1a', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#089981' }}>
            <ShieldCheck size={14} /> RSA-2048 SECURITY ON
          </div>
        </div>
      </aside>

      <NewsPanel news={insight?.news_details || []} />
    </div>
  )
}

const aiBadgeStyle = (isBuy: boolean) => ({
  position: 'absolute' as const, bottom: '30px', left: '30px',
  background: 'rgba(11, 14, 17, 0.85)', backdropFilter: 'blur(10px)',
  padding: '16px 24px', borderRadius: '16px',
  border: `1px solid ${isBuy ? '#089981' : '#2b3139'}`, zIndex: 10
})

const sectionWrapperStyle = { borderBottom: '1px solid #1a1a1a' }
const headerActionStyle = { padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }
const confidenceCardStyle = { background: '#161a1e', padding: '15px', borderRadius: '12px', border: '1px solid #2b3139' }
const logItemStyle = { display: 'flex', gap: '12px', marginBottom: '16px', borderLeft: '2px solid #2b3139', paddingLeft: '12px' }
const toolCardStyle = { background: '#161a1e', border: '1px solid #2b3139', padding: '15px', borderRadius: '10px' }
const toolInputStyle = { background: '#0b0e11', border: '1px solid #2b3139', color: 'white', padding: '8px', borderRadius: '6px', fontSize: '11px', width: '100%', outline: 'none', marginBottom: '5px' }

const autoTradeButtonStyle = (active: boolean) => ({
  width: '100%',
  padding: '10px',
  borderRadius: '8px',
  border: 'none',
  background: active ? '#089981' : '#2b3139',
  color: active ? 'white' : '#444',
  fontSize: '11px',
  fontWeight: 'bold',
  cursor: active ? 'pointer' : 'not-allowed',
  transition: '0.3s'
})