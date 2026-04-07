import { useState } from 'react'
import { LayoutDashboard, Activity, Layers, Settings, LogOut, TrendingUp } from 'lucide-react'

const NAV = [
  { tab: 'TRADE',     icon: LayoutDashboard },
  { tab: 'MEMES',     icon: Activity },
  { tab: 'PORTFOLIO', icon: Layers },
  { tab: 'CONFIG',    icon: Settings },
] as const

type Tab = 'TRADE' | 'MEMES' | 'PORTFOLIO' | 'CONFIG'

interface SidebarProps {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
  onLogout: () => void
}

export default function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  const [confirmLogout, setConfirmLogout] = useState(false)

  const handleLogoutClick = () => {
    if (confirmLogout) {
      onLogout()
    } else {
      setConfirmLogout(true)
      setTimeout(() => setConfirmLogout(false), 3000)
    }
  }

  return (
    <nav style={navStyle}>
      <div style={brandStyle}>
        <TrendingUp size={18} color="#000" strokeWidth={2.5} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {NAV.map(({ tab, icon: Icon }) => (
          <div key={tab} onClick={() => setActiveTab(tab as Tab)} style={navItemStyle(activeTab === tab)}>
            <Icon size={18} strokeWidth={1.75} />
          </div>
        ))}
      </div>
      <button
        onClick={handleLogoutClick}
        style={{ ...logoutStyle, opacity: confirmLogout ? 1 : 0.5 }}
        title={confirmLogout ? 'Haz clic de nuevo para confirmar' : 'Cerrar sesión'}
      >
        <LogOut size={17} strokeWidth={1.75} color={confirmLogout ? '#ff3b3b' : '#ff3b3b'} />
      </button>
    </nav>
  )
}

const navStyle: React.CSSProperties = {
  width: '62px', background: '#07101e', borderRight: '1px solid #111e35',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '18px 0', gap: '4px'
}
const brandStyle: React.CSSProperties = {
  width: '36px', height: '36px', background: '#fff', borderRadius: '10px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px'
}
const navItemStyle = (active: boolean): React.CSSProperties => ({
  width: '42px', height: '42px', borderRadius: '11px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  color: active ? '#fff' : '#243858',
  background: active ? '#14203c' : 'transparent',
  border: active ? '1px solid #1e1e1e' : '1px solid transparent',
  transition: 'all 0.15s'
})
const logoutStyle: React.CSSProperties = {
  width: '42px', height: '42px', borderRadius: '11px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', cursor: 'pointer',
  marginTop: 'auto', transition: 'opacity 0.2s'
}
