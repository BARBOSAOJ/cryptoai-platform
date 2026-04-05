interface Props {
  symbol: string
  insight?: any
}

export default function ChartPanel({ symbol, insight }: Props) {
  const isBuy = insight?.signal?.includes('COMPRAR')
  const confidence = parseInt(insight?.confidence || '50')

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {/* TradingView widget */}
      <iframe
        key={symbol}
        src={`https://s.tradingview.com/widgetembed/?frameElementId=tv_${symbol}&symbol=BINANCE:${symbol}&interval=1&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=131722&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC&locale=es`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title={`${symbol} Chart`}
        allowFullScreen
      />

      {/* Overlay AI badge */}
      {insight?.signal && (
        <div style={{
          position: 'absolute', bottom: '16px', left: '16px', zIndex: 5,
          background: 'rgba(6,6,6,0.85)', backdropFilter: 'blur(8px)',
          border: `1px solid ${isBuy ? 'rgba(0,208,96,0.25)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '10px', padding: '10px 14px'
        }}>
          <div style={{ fontSize: '9px', color: '#333', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '4px' }}>
            Señal IA
          </div>
          <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.3px', marginBottom: '6px' }}>
            {insight.signal}
          </div>
          <div style={{ height: '2px', width: '80px', background: '#111', borderRadius: '1px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${confidence}%`,
              background: isBuy ? '#00d060' : '#fff',
              borderRadius: '1px', transition: '1s'
            }} />
          </div>
          <div style={{ fontSize: '9px', color: '#333', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px' }}>
            {confidence}% confianza
          </div>
        </div>
      )}
    </div>
  )
}
