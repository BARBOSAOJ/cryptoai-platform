import { useState } from 'react'
import axios from 'axios'
import { Clock, Cpu, Target, ShieldCheck, ChevronDown, ChevronUp, Settings2, AlertCircle } from 'lucide-react'

export default function TradingTerminal({ symbol, insight, history = [], user }: any) {
  const [isLogExpanded, setIsLogExpanded] = useState(false)
  const [riskParams, setRiskParams] = useState({ risk: 1, entry: 0, stop: 0 })
  const [calcResult, setCalcResult] = useState({ size: 0, amount: 0 })

  const isBuy = insight?.signal?.includes('COMPRAR')
  const confidence = insight?.confidence || "85%"

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
    <div style={{ display: 'flex', height: '100%', background: '#080808' }}>
      <div style={{ flex: 1, position: 'relative', borderRight: '1px solid #1a1a1a' }}>
        <iframe
          title={symbol}
          src={`https://s.tradingview.com/widgetembed/?symbol=BINANCE%3A${symbol}&interval=1&theme=dark&style=1`}
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
        <div style={aiBadgeStyle(isBuy)}>
          <div style={{ fontSize: '10px', color: '#848e9c', fontWeight: 'bold' }}>ESTADO IA</div>
          <div style={{ fontSize: '16px', fontWeight: '800', color: isBuy ? '#089981' : '#fff' }}>
            {isBuy ? 'OPORTUNIDAD DETECTADA' : 'MONITORIZANDO'}
          </div>
        </div>
      </div>

      <aside style={{ width: '320px', background: '#0b0e11', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FCD535', marginBottom: '20px' }}>
            <Cpu size={18} />
            <span style={{ fontWeight: '800', fontSize: '12px', letterSpacing: '1px' }}>AI CONSOLE</span>
          </div>
          <div style={confidenceCardStyle}>
            <div style={{ fontSize: '10px', color: '#848e9c', marginBottom: '10px' }}>PRECISIÓN DE SEÑAL</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '20px', fontWeight: '900', color: isBuy ? '#089981' : '#fff' }}>{insight?.signal || 'ESCANEO'}</div>
              <div style={{ fontSize: '12px', color: '#848e9c' }}>{confidence}</div>
            </div>
            <div style={{ width: '100%', height: '4px', background: '#2b3139', borderRadius: '2px', marginTop: '10px' }}>
              <div style={{ width: confidence, height: '100%', background: isBuy ? '#089981' : '#FCD535', borderRadius: '2px' }}></div>
            </div>
          </div>
        </div>

        <div style={{ flex: isLogExpanded ? 1 : 'none', display: 'flex', flexDirection: 'column', borderBottom: '1px solid #1a1a1a' }}>
          <div onClick={() => setIsLogExpanded(!isLogExpanded)} style={logHeaderStyle(isLogExpanded)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={14} color="#848e9c" />
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#848e9c' }}>LOG DE OPERACIONES</span>
            </div>
            {isLogExpanded ? <ChevronUp size={16} color="#444" /> : <ChevronDown size={16} color="#444" />}
          </div>
          {isLogExpanded && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
              {history?.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#444', fontSize: '11px', marginTop: '10px' }}>Esperando señales...</div>
              ) : (
                history.map((h: any) => (
                  <div key={h.id} style={logItemStyle}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{h.symbol} • <span style={{ color: '#089981' }}>LONG</span></div>
                      <div style={{ fontSize: '10px', color: '#848e9c' }}>${h.price}</div>
                    </div>
                    <div style={{ fontSize: '9px', color: '#444' }}>{h.time}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '20px', flex: isLogExpanded ? 'none' : 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
            <Settings2 size={14} color="#848e9c" />
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#848e9c' }}>GESTIÓN DE RIESGO</span>
          </div>
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
              <div style={{ fontSize: '10px', color: '#f23645', marginTop: '4px' }}>
                Riesgo máximo: ${calcResult.amount.toFixed(2)}
              </div>
            </div>
          </div>
          <div style={{ ...toolCardStyle, marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '11px', fontWeight: 'bold' }}>
              <AlertCircle size={14} color="#089981" /> ALERTA DE VOLUMEN
            </div>
            <input type="range" min="10" max="1000" style={{ width: '100%', cursor: 'pointer' }} />
          </div>
        </div>

        <div style={{ padding: '20px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#089981' }}>
            <ShieldCheck size={14} /> RSA-2048 SECURITY ON
          </div>
        </div>
      </aside>
    </div>
  )
}

const aiBadgeStyle = (isBuy: boolean) => ({
  position: 'absolute' as const, bottom: '30px', left: '30px',
  background: 'rgba(11, 14, 17, 0.85)', backdropFilter: 'blur(10px)',
  padding: '16px 24px', borderRadius: '16px',
  border: `1px solid ${isBuy ? '#089981' : '#2b3139'}`, zIndex: 10
})
const confidenceCardStyle = { background: '#161a1e', padding: '15px', borderRadius: '12px', border: '1px solid #2b3139' }
const logHeaderStyle = (expanded: boolean) => ({ padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: expanded ? 'transparent' : '#161a1e' })
const logItemStyle = { display: 'flex', gap: '12px', marginBottom: '16px', borderLeft: '2px solid #2b3139', paddingLeft: '12px' }
const toolCardStyle = { background: '#161a1e', border: '1px solid #2b3139', padding: '12px', borderRadius: '10px' }
const toolInputStyle = { background: '#0b0e11', border: '1px solid #2b3139', color: 'white', padding: '6px', borderRadius: '4px', fontSize: '11px', width: '100%', outline: 'none' }