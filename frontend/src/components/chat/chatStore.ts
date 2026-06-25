import { useSyncExternalStore } from 'react'

// Store de módulo para la conversación con BT.
// Vive fuera del ciclo de vida de ChatPanel, de modo que la conversación
// se mantiene aunque el componente se desmonte al cambiar de pestaña.

export interface Mensaje {
  role: 'user' | 'assistant' | 'alerta'
  content: string
  ts: string
  urgencia?: number
}

type Updater = Mensaje[] | ((prev: Mensaje[]) => Mensaje[])

let mensajes: Mensaje[] = []
let greeted = false
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(l => l())

export const chatStore = {
  getMensajes: () => mensajes,
  setMensajes: (updater: Updater) => {
    mensajes = typeof updater === 'function' ? updater(mensajes) : updater
    emit()
  },
  hasGreeted: () => greeted,
  markGreeted: () => { greeted = true },
  reset: () => { mensajes = []; greeted = false; emit() },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
}

/** Hook que expone los mensajes con la misma firma que useState. */
export function useChatMensajes(): [Mensaje[], (u: Updater) => void] {
  const value = useSyncExternalStore(chatStore.subscribe, chatStore.getMensajes, chatStore.getMensajes)
  return [value, chatStore.setMensajes]
}
