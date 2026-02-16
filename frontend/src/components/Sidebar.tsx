import { Zap, PieChart, Settings, LogOut } from 'lucide-react'

export default function Sidebar({ activeTab, setActiveTab, onLogout }: any) {
  return (
    <nav style={{ width: '80px', background: '#161a1e', borderRight: '1px solid #2b3139', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0' }}>
      <div style={{ color: '#FCD535', marginBottom: '40px' }}><Zap size={32} fill="#FCD535" /></div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div onClick={() => setActiveTab('TRADE')} style={{ cursor: 'pointer', color: activeTab === 'TRADE' ? '#FCD535' : '#848e9c' }}><Zap size={24} /></div>
        <div onClick={() => setActiveTab('MEMES')} style={{ cursor: 'pointer', color: activeTab === 'MEMES' ? '#FCD535' : '#848e9c' }}><PieChart size={24} /></div>
        <div onClick={() => setActiveTab('CONFIG')} style={{ cursor: 'pointer', color: activeTab === 'CONFIG' ? '#FCD535' : '#848e9c' }}><Settings size={24} /></div>
      </div>
      <button onClick={onLogout} style={{ background: 'none', border: 'none', color: '#f23645', cursor: 'pointer' }}><LogOut size={24} /></button>
    </nav>
  )
}
