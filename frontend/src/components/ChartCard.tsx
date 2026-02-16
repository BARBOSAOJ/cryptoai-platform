// src/components/ChartCard.tsx
import { Cpu } from 'lucide-react';
import { Coin, AiAnalysis } from '../interfaces';

interface Props {
  coin: Coin;
  price: number;
  aiData?: AiAnalysis;
}

export const ChartCard = ({ coin, price, aiData }: Props) => {
  
  // Estilos locales
  const s = {
    card: { background: '#131722', position: 'relative' as const, display: 'flex', flexDirection: 'column' as const, height: '100%', borderRight: '1px solid #2a2e39', borderBottom: '1px solid #2a2e39' },
    header: { height: '35px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', borderBottom: '1px solid #2a2e39', background: '#131722' },
    aiBadge: { 
      fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '3px', 
      display: 'flex', alignItems: 'center', gap: '4px',
      background: aiData?.action_color === 'GREEN' ? '#089981' : aiData?.action_color === 'RED' ? '#f23645' : '#444',
      color: 'white'
    }
  };

  return (
    <div style={s.card}>
      {/* Cabecera del Gráfico */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
           {/* Icono de moneda (fallback a BTC si falla) */}
          <img 
            src={`https://assets.coincap.io/assets/icons/${coin.name.toLowerCase()}@2x.png`} 
            onError={(e) => e.currentTarget.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/1200px-Bitcoin.svg.png'}
            style={{ width: '16px', height: '16px', borderRadius: '50%' }} 
          />
          <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#d1d4dc' }}>{coin.id}</span>
          <span style={{ fontSize: '12px', color: '#2962FF' }}>${price || '---'}</span>
        </div>

        {/* Etiqueta IA */}
        {aiData ? (
          <div style={s.aiBadge}>
            <Cpu size={10} /> {aiData.signal}
          </div>
        ) : (
          <span style={{ fontSize: '10px', color: '#555' }}>Conectando IA...</span>
        )}
      </div>

      {/* Iframe TradingView */}
      <div style={{ flex: 1, position: 'relative' }}>
        <iframe
          src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=BINANCE%3A${coin.id}&interval=1&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC&locale=es&utm_source=localhost&utm_medium=widget&utm_campaign=chart&utm_term=BINANCE%3A${coin.id}`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title={`${coin.name} Chart`}
        />
        
        {/* Overlay Flotante IA (Detalle) */}
        {aiData && (
          <div style={{ position: 'absolute', bottom: '10px', left: '10px', zIndex: 5, background: 'rgba(0,0,0,0.6)', padding: '5px 10px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
            <div style={{ fontSize: '10px', color: '#bbb' }}>Confianza Modelo</div>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#FCD535' }}>{aiData.confidence}</div>
          </div>
        )}
      </div>
    </div>
  );
};
