import { Zap, Shield, Database } from 'lucide-react'

export default function Settings({ setRefreshInterval, currentInterval }: any) {
  const handleChange = (e: any) => {
    const value = parseInt(e.target.value);
    setRefreshInterval(value);
  };

  return (
    <div style={{ padding: '50px', maxWidth: '800px' }}>
      <h2 style={{ marginBottom: '40px', fontWeight: '900', letterSpacing: '1px' }}>AJUSTES DEL TERMINAL</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <section style={configBox}>
          <Zap size={24} color="#FCD535" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold' }}>Agresividad del Algoritmo</div>
            <div style={{ fontSize: '12px', color: '#848e9c' }}>Define la velocidad de escaneo de la red neuronal.</div>
          </div>
          <select
            value={currentInterval}
            onChange={handleChange}
            style={inputStyle}
          >
            <option value={5000}>Conservador (5s)</option>
            <option value={3000}>Moderado (3s)</option>
            <option value={1000}>Agresivo (1s)</option>
          </select>
        </section>

        <section style={configBox}>
          <Shield size={24} color="#089981" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold' }}>Seguridad Institucional</div>
            <div style={{ fontSize: '12px', color: '#848e9c' }}>Encriptación RSA-2048 activa para todas las peticiones.</div>
          </div>
          <div style={{ color: '#089981', fontSize: '12px', fontWeight: 'bold' }}>ACTIVO</div>
        </section>
      </div>
    </div>
  )
}

const configBox = { background: '#0b0e11', padding: '25px', borderRadius: '16px', border: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '25px' }
const inputStyle = { background: '#161a1e', border: '1px solid #2b3139', color: '#fff', padding: '10px', borderRadius: '8px', cursor: 'pointer' }