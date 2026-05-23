import { useState } from 'react'
import { LayoutDashboard, Layers, Settings, LogOut, TrendingUp, Bot } from 'lucide-react'

const NAV = [
  { tab: 'TRADE',     icon: LayoutDashboard },
  { tab: 'PORTFOLIO', icon: Layers },
  { tab: 'BOT',       icon: Bot },
  { tab: 'CONFIG',    icon: Settings },
] as const

type Tab = 'TRADE' | 'PORTFOLIO' | 'BOT' | 'CONFIG'

interface SidebarProps {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
  onLogout: () => void
}

function obtenerRolDesdeToken(): string {
  const token = localStorage.getItem('token')
  if (!token) return 'USER'
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const groups: string[] = payload.groups || []
    return groups.includes('ADMIN') ? 'ADMIN' : 'USER'
  } catch {
    return 'USER'
  }
}

export default function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  const [confirmLogout, setConfirmLogout] = useState(false)
  const rol = obtenerRolDesdeToken()
  const esAdmin = rol === 'ADMIN'

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

      {/* Badge de rol */}
      <div style={{
        width: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '2px', marginBottom: '8px'
      }}>
        <span style={{
          fontSize: '8px', fontFamily: 'JetBrains Mono, monospace',
          color: esAdmin ? '#818cf8' : '#00d060',
          background: esAdmin ? 'rgba(129,140,248,0.12)' : 'rgba(0,208,96,0.08)',
          border: `1px solid ${esAdmin ? 'rgba(129,140,248,0.3)' : 'rgba(0,208,96,0.2)'}`,
          padding: '2px 4px', borderRadius: '4px', letterSpacing: '0.5px',
          textAlign: 'center', width: '100%'
        }}>
          {esAdmin ? 'ADMIN' : 'USER'}
        </span>
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
