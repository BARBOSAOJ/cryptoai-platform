import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader, MessageCircle, Bell, X } from 'lucide-react'
import { API_AI } from '../../api'

interface Mensaje {
  role: 'user' | 'assistant' | 'alerta'
  content: string
  ts: string
  urgencia?: number
}

interface ChatPanelProps {
  onClose?: () => void
  onNewAlert?: () => void
}

const SUGERENCIAS = [
  '¿Cómo está Bitcoin ahora mismo?',
  'Analiza Ethereum y dame tu opinión',
  '¿Hay señal de entrada en Solana?',
  'Compara BTC y ETH, ¿cuál tiene mejor conviction?',
  '¿Qué indica el Fear & Greed hoy?',
]

export default function ChatPanel({ onClose, onNewAlert }: ChatPanelProps) {
  const [mensajes, setMensajes]     = useState<Mensaje[]>([])
  const [input, setInput]           = useState('')
  const [cargando, setCargando]     = useState(false)
  const [ollamaOk, setOllamaOk]    = useState<boolean | null>(null)
  const bottomRef                   = useRef<HTMLDivElement>(null)
  const inputRef                    = useRef<HTMLTextAreaElement>(null)
  const abortRef                    = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const es = new EventSource(`${API_AI}/chat/alertas?token=${token}`)
    es.onmessage = (e) => {
      if (!e.data || e.data.startsWith(':')) return
      try {
        const alerta = JSON.parse(e.data)
        setMensajes(prev => [...prev, {
          role:     'alerta',
          content:  alerta.mensaje,
          ts:       new Date().toISOString(),
          urgencia: alerta.urgencia ?? 1,
        }])
        onNewAlert?.()
      } catch { /* chunk inválido */ }
    }
    return () => es.close()
  }, [onNewAlert])

  const enviar = async (texto?: string) => {
    const msg = (texto ?? input).trim()
    if (!msg || cargando) return

    setInput('')
    const userMsg: Mensaje = { role: 'user', content: msg, ts: new Date().toISOString() }
    setMensajes(prev => [...prev, userMsg])
    setCargando(true)
    setOllamaOk(null)

    const historial = mensajes.slice(-10).map(m => ({ role: m.role, content: m.content }))

    const assistantMsg: Mensaje = { role: 'assistant', content: '', ts: new Date().toISOString() }
    setMensajes(prev => [...prev, assistantMsg])

    abortRef.current = new AbortController()

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_AI}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mensaje: msg, historial }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            const chunk: string = parsed.content ?? ''
            setMensajes(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + chunk,
              }
              return updated
            })
          } catch { /* chunk incompleto */ }
        }
      }
      setOllamaOk(true)
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setOllamaOk(false)
      setMensajes(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: 'No se pudo conectar con el modelo. Asegúrate de que Ollama está activo (`ollama serve`).',
        }
        return updated
      })
    } finally {
      setCargando(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#060d1a' }}>

      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #111e35',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0
      }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '9px', flexShrink: 0,
          background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Bot size={16} color="#818cf8" strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#c8d8ec' }}>BT — Asesor IA</div>
          <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
            LSTM · Fear &amp; Greed · Reddit
          </div>
        </div>
        {ollamaOk !== null && (
          <div style={{
            fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
            padding: '2px 7px', borderRadius: '5px', flexShrink: 0,
            color: ollamaOk ? '#00d060' : '#ff3b3b',
            background: ollamaOk ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)',
            border: `1px solid ${ollamaOk ? 'rgba(0,208,96,0.2)' : 'rgba(255,59,59,0.2)'}`,
          }}>
            {ollamaOk ? 'OK' : 'ERR'}
          </div>
        )}
        {onClose && (
          <button onClick={onClose} style={{
            width: '28px', height: '28px', borderRadius: '7px', flexShrink: 0,
            background: 'none', border: '1px solid #1a2840', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#486080', transition: 'all 0.15s',
          }}>
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Mensajes */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {mensajes.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', marginTop: '24px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '14px',
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <MessageCircle size={22} color="#818cf8" strokeWidth={1.5} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#7890b0', marginBottom: '4px' }}>
                ¿En qué puedo ayudarte?
              </div>
              <div style={{ fontSize: '11px', color: '#2c4268' }}>
                Análisis · Señales · Órdenes por voz
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
              {SUGERENCIAS.map((s, i) => (
                <button key={i} onClick={() => enviar(s)} style={sugerenciaStyle}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((msg, i) => {
          if (msg.role === 'alerta') {
            const color = msg.urgencia === 2 ? '#f59e0b' : '#818cf8'
            const bg    = msg.urgencia === 2 ? 'rgba(245,158,11,0.06)' : 'rgba(99,102,241,0.06)'
            const border= msg.urgencia === 2 ? 'rgba(245,158,11,0.2)' : 'rgba(99,102,241,0.15)'
            return (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '7px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: bg, border: `1px solid ${border}`,
                }}>
                  <Bell size={12} color={color} strokeWidth={2} />
                </div>
                <div style={{
                  maxWidth: '80%', padding: '8px 12px', borderRadius: '10px',
                  fontSize: '12px', lineHeight: '1.6', color,
                  background: bg, border: `1px solid ${border}`,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            )
          }
          return (
            <div key={i} style={{
              display: 'flex', gap: '8px',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-start'
            }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '7px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'user' ? 'rgba(0,208,96,0.1)' : 'rgba(99,102,241,0.1)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(0,208,96,0.2)' : 'rgba(99,102,241,0.2)'}`,
              }}>
                {msg.role === 'user'
                  ? <User size={13} color="#00d060" strokeWidth={2} />
                  : <Bot size={13} color="#818cf8" strokeWidth={1.75} />
                }
              </div>
              <div style={{
                maxWidth: '80%', padding: '9px 12px', borderRadius: '10px',
                fontSize: '12px', lineHeight: '1.6', color: '#c8d8ec',
                background: msg.role === 'user' ? 'rgba(0,208,96,0.06)' : '#07101e',
                border: `1px solid ${msg.role === 'user' ? 'rgba(0,208,96,0.12)' : '#111e35'}`,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.content}
                {msg.role === 'assistant' && cargando && i === mensajes.length - 1 && msg.content === '' && (
                  <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
                    <span style={dotStyle(0)} /><span style={dotStyle(1)} /><span style={dotStyle(2)} />
                  </span>
                )}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid #111e35', flexShrink: 0,
        display: 'flex', gap: '8px', alignItems: 'flex-end'
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe tu pregunta... (Enter para enviar)"
          rows={1}
          style={{
            flex: 1, background: '#07101e', border: '1px solid #1a2840',
            borderRadius: '9px', color: '#c8d8ec', padding: '9px 12px',
            fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
            resize: 'none', lineHeight: '1.5', maxHeight: '100px', overflowY: 'auto',
          }}
          onInput={e => {
            const t = e.currentTarget
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 100) + 'px'
          }}
        />
        <button
          onClick={() => enviar()}
          disabled={!input.trim() || cargando}
          style={{
            width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
            background: input.trim() && !cargando ? 'rgba(99,102,241,0.2)' : '#0b1424',
            border: `1px solid ${input.trim() && !cargando ? 'rgba(99,102,241,0.35)' : '#1a2840'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !cargando ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {cargando
            ? <Loader size={14} color="#818cf8" strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
            : <Send size={14} color={input.trim() ? '#818cf8' : '#2c4268'} strokeWidth={2} />
          }
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

const sugerenciaStyle: React.CSSProperties = {
  background: '#07101e', border: '1px solid #111e35', borderRadius: '7px',
  padding: '7px 12px', color: '#486080', fontSize: '11px', cursor: 'pointer',
  textAlign: 'left', fontFamily: 'Inter, sans-serif', transition: 'all 0.15s',
}

const dotStyle = (i: number): React.CSSProperties => ({
  width: '4px', height: '4px', borderRadius: '50%', background: '#818cf8',
  display: 'inline-block',
  animation: `blink 1.2s ${i * 0.2}s infinite ease-in-out`,
})
