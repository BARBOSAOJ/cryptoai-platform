// src/components/Watchlist.tsx
import type { Coin, MarketDataMap } from '../interfaces';
import { WATCHLIST_COINS } from '../interfaces';

interface Props {
  marketData: MarketDataMap;
  selectedCoinId: string;
  onSelectCoin: (coin: Coin) => void;
}

export const Watchlist = ({ marketData, selectedCoinId, onSelectCoin }: Props) => {
  
  const s = {
    container: { width: '260px', borderRight: '1px solid #2a2e39', background: '#1c2a42', display: 'flex', flexDirection: 'column' as const },
    header: { padding: '15px', borderBottom: '1px solid #2a2e39', display: 'flex', alignItems: 'center', gap: '10px', color: '#b8cce0' },
    list: { flex: 1, overflowY: 'auto' as const },
    item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 15px', cursor: 'pointer', borderBottom: '1px solid #2a2e39', transition: 'background 0.2s', color: '#b8cce0' },
    badge: { fontSize: '10px', padding: '2px 4px', borderRadius: '3px', fontWeight: 'bold', background: '#FCD535', color: 'black', marginLeft: '6px' }
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={{ color: '#FCD535', fontWeight: 'bold', fontSize: '20px' }}>⚡</div>
        <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>MARKET PRO</span>
      </div>

      <div style={s.list}>
        {WATCHLIST_COINS.map(coin => {
          const price = marketData[coin.id]?.price || 0;
          const isSelected = selectedCoinId === coin.id;
          
          // Simulamos cambio porcentual aleatorio para efecto visual "vivo"
          const change = (Math.random() * 2 - 1).toFixed(2);
          const isPos = parseFloat(change) > 0;

          return (
            <div 
              key={coin.id}
              style={{ ...s.item, background: isSelected ? '#243858' : 'transparent' }}
              onClick={() => onSelectCoin(coin)}
            >
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center' }}>
                  {coin.name}
                  {coin.type === 'MEME' && <span style={s.badge}>M</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#6878a8' }}>{coin.id}</div>
              </div>
              
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                  ${price > 1 ? price.toFixed(2) : price.toFixed(6)}
                </div>
                <div style={{ fontSize: '11px', color: isPos ? '#089981' : '#f23645' }}>
                  {isPos ? '+' : ''}{change}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Panel Fake de Equity */}
      <div style={{ padding: '20px', borderTop: '1px solid #2a2e39', background: '#162440', color: '#b8cce0' }}>
        <div style={{ fontSize: '11px', color: '#6878a8', marginBottom: '5px' }}>BALANCE TOTAL</div>
        <div style={{ fontSize: '20px', fontWeight: 'bold' }}>$12,450.00</div>
      </div>
    </div>
  );
};
