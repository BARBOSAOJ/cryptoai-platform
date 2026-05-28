import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, MessageCircle, Bell, X, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_AI } from '../../api'

interface Mensaje {
  role: 'user' | 'assistant' | 'alerta'
  content: string
  ts: string
  urgencia?: number
}

interface BtAction {
  action: string
  symbol?: string
  to?: string
}

interface ChatPanelProps {
  onClose?: () => void
  onNewAlert?: () => void
  onAction?: (action: BtAction) => void
}

const SUGERENCIAS = [
  '¿Cómo está Bitcoin ahora mismo?',
  'Analiza Ethereum y dame tu opinión',
  '¿Hay señal de entrada en Solana?',
  'Compara BTC y ETH, ¿cuál tiene mejor conviction?',
  '¿Qué indica el Fear & Greed hoy?',
]

const msgVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.22, ease: [0.25,0.46,0.45,0.94] } },
  exit:   { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
}

const suggestVariants = {
  hidden: { opacity: 0, x: -8 },
  show:   (i: number) => ({ opacity: 1, x: 0, transition: { delay: i * 0.05, duration: 0.2 } }),
}

export default function ChatPanel({ onClose, onNewAlert, onAction }: ChatPanelProps) {
  const [mensajes, setMensajes]     = useState<Mensaje[]>([])
  const [input, setInput]           = useState('')
  const [cargando, setCargando]     = useState(false)
  const [analizando, setAnalizando] = useState(false)
  const [ollamaOk, setOllamaOk]    = useState<boolean | null>(null)
  const [saludando, setSaludando]   = useState(false)
  const [autonomo, setAutonomo]     = useState(false)
  const [cicloActivo, setCicloActivo] = useState(false)
  const bottomRef                   = useRef<HTMLDivElement>(null)
  const inputRef                    = useRef<HTMLTextAreaElement>(null)
  const abortRef                    = useRef<AbortController | null>(null)
  const greetingFired               = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes])

  // Initial briefing
  useEffect(() => {
    if (greetingFired.current) return
    greetingFired.current = true
    const token = localStorage.getItem('token')
    if (!token) return
    setSaludando(true)
    const btMsg: Mensaje = { role: 'assistant', content: '', ts: new Date().toISOString() }
    setMensajes([btMsg])

    fetch(`${API_AI}/chat/inicio`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async res => {
      if (!res.ok || !res.body) { setMensajes([]); return }
      const reader = res.body.getReader()
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
            if (parsed.ping) continue
            const chunk: string = parsed.content ?? ''
            if (!chunk) continue
            setMensajes(prev => {
              const updated = [...prev]
              updated[0] = { ...updated[0], content: updated[0].content + chunk }
              return updated
            })
          } catch { /* noop */ }
        }
      }
    }).catch(() => setMensajes([]))
      .finally(() => setSaludando(false))
  }, [])

  // Estado autónomo inicial
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch(`${API_AI}/chat/autonomo/estado`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setAutonomo(d.activo ?? false)).catch(() => {})
  }, [])

  // Ciclo autónomo cada 5 minutos cuando está activo
  useEffect(() => {
    if (!autonomo) return
    const runCiclo = async () => {
      const token = localStorage.getItem('token')
      if (!token) return
      setCicloActivo(true)
      try {
        const res = await fetch(`${API_AI}/chat/autonomo/ciclo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (data.operaciones?.length > 0) {
          data.operaciones.forEach((op: any) => {
            setMensajes(prev => [...prev, {
              role: 'alerta',
              content: `BT ${op.tipo === 'BUY' ? 'abrió' : 'cerró'} ${op.symbol.replace('USDT','')} $${op.amount.toFixed(2)} — ${op.razon}`,
              ts: new Date().toISOString(),
              urgencia: 2,
            }])
          })
        }
      } catch {} finally {
        setCicloActivo(false)
      }
    }
    runCiclo()
    const t = setInterval(runCiclo, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [autonomo])

  const toggleAutonomo = async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    const cmd = autonomo ? 'desactiva modo autónomo' : 'activa modo autónomo'
    setAutonomo(!autonomo)
    // Envía como mensaje al chat para que BT confirme
    setMensajes(prev => [...prev, { role: 'user', content: cmd, ts: new Date().toISOString() }])
    setCargando(true)
    try {
      const res = await fetch(`${API_AI}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mensaje: cmd, historial: [] }),
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const btMsg: Mensaje = { role: 'assistant', content: '', ts: new Date().toISOString() }
      setMensajes(prev => [...prev, btMsg])
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (raw === '[DONE]') break
          try {
            const chunk = JSON.parse(raw)
            if (chunk.content) {
              setMensajes(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + chunk.content }
                return copy
              })
            }
          } catch {}
        }
      }
    } catch {} finally {
      setCargando(false)
    }
  }

  // Alertas SSE
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const es = new EventSource(`${API_AI}/chat/alertas?token=${token}`)
    es.onmessage = (e) => {
      if (!e.data || e.data.startsWith(':')) return
      try {
        const alerta = JSON.parse(e.data)
        setMensajes(prev => [...prev, {
          role: 'alerta', content: alerta.mensaje,
          ts: new Date().toISOString(), urgencia: alerta.urgencia ?? 1,
        }])
        onNewAlert?.()
      } catch { /* noop */ }
    }
    return () => es.close()
  }, [onNewAlert])

  const enviar = useCallback(async (texto?: string) => {
    const msg = (texto ?? input).trim()
    if (!msg || cargando) return

    setInput('')
    setMensajes(prev => [...prev, { role: 'user', content: msg, ts: new Date().toISOString() }])
    setCargando(true)
    setAnalizando(false)
    setOllamaOk(null)

    const historial = mensajes.slice(-10).map(m => ({ role: m.role, content: m.content }))
    setMensajes(prev => [...prev, { role: 'assistant', content: '', ts: new Date().toISOString() }])

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
            if (parsed.ping) { setAnalizando(true); continue }
            if (parsed.action) { onAction?.(parsed); continue }
            const chunk: string = parsed.content ?? ''
            if (!chunk) continue
            setAnalizando(false)
            setMensajes(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + chunk,
              }
              return updated
            })
          } catch { /* noop */ }
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
          content: 'No se pudo conectar con el modelo. Asegúrate de que Ollama está activo.',
        }
        return updated
      })
    } finally {
      setCargando(false)
      setAnalizando(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [input, cargando, mensajes])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
  }

  const isEmpty = mensajes.length === 0

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-base)',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(99,102,241,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ position: 'relative' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(99,102,241,0.15)',
          }}>
            <Bot size={16} color="#818cf8" strokeWidth={1.75} />
          </div>
          {/* Pulse online indicator */}
          <span style={{
            position: 'absolute', bottom: 1, right: 1,
            width: 8, height: 8, borderRadius: '50%',
            background: '#00d060',
            boxShadow: '0 0 6px #00d060',
          }} />
          <span style={{
            position: 'absolute', bottom: 1, right: 1,
            width: 8, height: 8, borderRadius: '50%',
            background: '#00d060',
            animation: 'ping 1.8s cubic-bezier(0,0,0.2,1) infinite',
          }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: 'var(--text-1)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            BT — Asesor IA
            {ollamaOk !== null && (
              <motion.span
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
                  padding: '2px 6px', borderRadius: 4,
                  color: ollamaOk ? '#00d060' : '#ff3b3b',
                  background: ollamaOk ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)',
                  border: `1px solid ${ollamaOk ? 'rgba(0,208,96,0.2)' : 'rgba(255,59,59,0.2)'}`,
                }}
              >
                {ollamaOk ? 'OK' : 'ERR'}
              </motion.span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'JetBrains Mono, monospace' }}>
            LSTM · Fear&amp;Greed · Reddit · RAG
          </div>
        </div>

        {/* Botón modo autónomo */}
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={toggleAutonomo}
          title={autonomo ? 'BT autónomo activo — click para desactivar' : 'Activar modo autónomo'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            background: autonomo ? 'rgba(251,146,60,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${autonomo ? 'rgba(251,146,60,0.4)' : 'rgba(255,255,255,0.08)'}`,
            color: autonomo ? '#fb923c' : 'var(--text-4)',
            transition: 'all 0.15s',
          }}
        >
          <Zap size={11} strokeWidth={2.5} style={{ animation: cicloActivo ? 'spin 1s linear infinite' : 'none' }} />
          <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px' }}>
            {autonomo ? 'AUTO' : 'MANUAL'}
          </span>
        </motion.button>

        {onClose && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: 'none', border: '1px solid var(--border-2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-3)', transition: 'all var(--transition)',
          }}>
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '14px 14px 8px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>

        {/* Empty state */}
        <AnimatePresence>
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, marginTop: 20 }}
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: 'rgba(99,102,241,0.08)',
                  border: '1px solid rgba(99,102,241,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 24px rgba(99,102,241,0.12)',
                }}
              >
                <MessageCircle size={24} color="#818cf8" strokeWidth={1.5} />
              </motion.div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>
                  ¿En qué puedo ayudarte?
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>
                  Análisis · Señales · Órdenes · Cartera
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                {SUGERENCIAS.map((s, i) => (
                  <motion.button
                    key={i}
                    custom={i}
                    variants={suggestVariants}
                    initial="hidden"
                    animate="show"
                    whileHover={{ x: 4, borderColor: 'rgba(99,102,241,0.3)', color: '#c8d8ec' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => enviar(s)}
                    style={{
                      background: 'var(--bg-panel)', border: '1px solid var(--border)',
                      borderRadius: 7, padding: '8px 12px', color: 'var(--text-3)',
                      fontSize: 11, cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'Inter, sans-serif', transition: 'all var(--transition)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <Zap size={11} color="var(--indigo)" strokeWidth={2} style={{ flexShrink: 0 }} />
                    {s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message list */}
        <AnimatePresence initial={false}>
          {mensajes.map((msg, i) => {
            if (msg.role === 'alerta') {
              const isHigh = msg.urgencia === 2
              const col    = isHigh ? '#f59e0b' : '#818cf8'
              const bg     = isHigh ? 'rgba(245,158,11,0.06)' : 'rgba(99,102,241,0.06)'
              const border = isHigh ? 'rgba(245,158,11,0.22)' : 'rgba(99,102,241,0.18)'
              return (
                <motion.div key={`alert-${i}`} variants={msgVariants} initial="hidden" animate="show" exit="exit">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: bg, border: `1px solid ${border}`,
                      animation: isHigh ? 'pulse 1.5s infinite' : undefined,
                    }}>
                      <Bell size={11} color={col} strokeWidth={2} />
                    </div>
                    <div style={{
                      maxWidth: '82%', padding: '8px 12px', borderRadius: 10,
                      fontSize: 12, lineHeight: 1.65, color: col,
                      background: bg, border: `1px solid ${border}`,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {msg.content}
                    </div>
                  </div>
                </motion.div>
              )
            }

            const isUser  = msg.role === 'user'
            const isLast  = i === mensajes.length - 1
            const isEmpty = msg.content === ''

            return (
              <motion.div
                key={`msg-${i}`}
                variants={msgVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <div style={{
                  display: 'flex', gap: 8,
                  flexDirection: isUser ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 27, height: 27, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isUser ? 'rgba(0,208,96,0.1)' : 'rgba(99,102,241,0.1)',
                    border: `1px solid ${isUser ? 'rgba(0,208,96,0.22)' : 'rgba(99,102,241,0.22)'}`,
                    boxShadow: isUser ? '0 0 8px rgba(0,208,96,0.08)' : '0 0 8px rgba(99,102,241,0.08)',
                  }}>
                    {isUser
                      ? <User size={13} color="#00d060" strokeWidth={2} />
                      : <Bot  size={13} color="#818cf8" strokeWidth={1.75} />
                    }
                  </div>

                  {/* Bubble */}
                  <div style={{
                    maxWidth: '82%', padding: '9px 13px', borderRadius: 11,
                    fontSize: 12, lineHeight: 1.7, color: 'var(--text-1)',
                    background: isUser
                      ? 'linear-gradient(135deg, rgba(0,208,96,0.08), rgba(0,208,96,0.04))'
                      : 'linear-gradient(135deg, var(--bg-panel), var(--bg-card))',
                    border: `1px solid ${isUser ? 'rgba(0,208,96,0.14)' : 'var(--border)'}`,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    boxShadow: isUser
                      ? '0 2px 12px rgba(0,208,96,0.06)'
                      : '0 2px 12px rgba(0,0,0,0.2)',
                  }}>

                    {/* Loading states */}
                    {!isUser && isEmpty && isLast && (
                      saludando || analizando ? (
                        <span style={{
                          fontSize: 10, color: 'var(--text-4)',
                          fontFamily: 'JetBrains Mono, monospace',
                          animation: 'pulse 1.5s infinite',
                        }}>
                          {saludando ? 'analizando mercado...' : 'procesando...'}
                        </span>
                      ) : cargando ? (
                        <TypingDots />
                      ) : null
                    )}

                    {msg.content}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        display: 'flex', gap: 8, alignItems: 'flex-end',
        background: 'linear-gradient(0deg, rgba(99,102,241,0.03) 0%, transparent 100%)',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pregunta al mercado... (Enter para enviar)"
          rows={1}
          style={{
            flex: 1, background: 'var(--bg-input)',
            border: `1px solid ${input ? 'rgba(99,102,241,0.3)' : 'var(--border-2)'}`,
            borderRadius: 9, color: 'var(--text-1)', padding: '9px 12px',
            fontSize: 12, fontFamily: 'Inter, sans-serif', outline: 'none',
            resize: 'none', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto',
            transition: 'border-color var(--transition), box-shadow var(--transition)',
            boxShadow: input ? '0 0 0 3px rgba(99,102,241,0.08)' : 'none',
          }}
          onInput={e => {
            const t = e.currentTarget
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 100) + 'px'
          }}
        />
        <motion.button
          onClick={() => enviar()}
          disabled={!input.trim() || cargando}
          whileHover={input.trim() && !cargando ? { scale: 1.08 } : {}}
          whileTap={input.trim() && !cargando ? { scale: 0.93 } : {}}
          style={{
            width: 37, height: 37, borderRadius: 9, flexShrink: 0,
            background: input.trim() && !cargando ? 'rgba(99,102,241,0.2)' : 'var(--bg-input)',
            border: `1px solid ${input.trim() && !cargando ? 'rgba(99,102,241,0.38)' : 'var(--border-2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !cargando ? 'pointer' : 'not-allowed',
            transition: 'all var(--transition)',
            boxShadow: input.trim() && !cargando ? '0 0 12px rgba(99,102,241,0.18)' : 'none',
          }}
        >
          {cargando
            ? <Loader2 size={14} color="#818cf8" strokeWidth={2} className="spin" />
            : <Send size={14} color={input.trim() ? '#818cf8' : 'var(--text-5)'} strokeWidth={2} />
          }
        </motion.button>
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, delay: i * 0.18, repeat: Infinity, ease: 'easeInOut' }}
          style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', background: '#818cf8' }}
        />
      ))}
    </span>
  )
}
