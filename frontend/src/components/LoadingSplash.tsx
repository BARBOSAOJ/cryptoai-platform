import { Cpu } from 'lucide-react';

export default function LoadingSplash() {
  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: 'Inter, sans-serif'
    }}>
      <style>
        {`
          @keyframes pulse {
            0% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 0.5; }
          }
          .ia-logo {
            animation: pulse 2s infinite ease-in-out;
            filter: drop-shadow(0 0 15px rgba(252, 213, 53, 0.4));
          }
        `}
      </style>
      
      <div className="ia-logo" style={{ marginBottom: '30px' }}>
        <Cpu color="#FCD535" size={80} />
      </div>
      
      <div style={{ color: '#FCD535', fontSize: '12px', fontWeight: 'bold', letterSpacing: '3px', marginBottom: '10px' }}>
        SISTEMA IA
      </div>
      <div style={{ color: '#848e9c', fontSize: '11px', letterSpacing: '1px' }}>
        INICIALIZANDO TERMINAL E ENCRIPTACIÓN...
      </div>
    </div>
  );
}
