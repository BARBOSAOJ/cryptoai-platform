// src/components/ChartGrid.tsx
import { ChartCard } from './ChartCard';
import type { Coin, MarketDataMap, AiInsightsMap } from '../interfaces';

interface Props {
  layout: 'SINGLE' | 'GRID';
  mainCoin: Coin;
  gridCoins: Coin[];
  marketData: MarketDataMap;
  aiInsights: AiInsightsMap;
}

export const ChartGrid = ({ layout, mainCoin, gridCoins, marketData, aiInsights }: Props) => {
  
  const s = {
    gridContainer: { 
      flex: 1, 
      display: 'grid', 
      // Si es Single: 1 columna. Si es Grid: 2 columnas.
      gridTemplateColumns: layout === 'SINGLE' ? '1fr' : '1fr 1fr', 
      gridTemplateRows: layout === 'SINGLE' ? '1fr' : '1fr 1fr', 
      gap: '1px', 
      background: '#060d1a', // Líneas negras entre gráficos
      overflow: 'hidden'
    }
  };

  // Elegimos qué monedas pintar según el layout
  const coinsToRender = layout === 'SINGLE' ? [mainCoin] : gridCoins;

  return (
    <div style={s.gridContainer}>
      {coinsToRender.map((coin, index) => (
        <ChartCard 
          key={`${coin.id}-${index}`}
          coin={coin}
          price={marketData[coin.id]?.price}
          aiData={aiInsights[coin.id]}
        />
      ))}
    </div>
  );
};
