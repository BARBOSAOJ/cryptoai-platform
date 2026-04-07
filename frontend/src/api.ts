import axios from 'axios'
import type { UserProfile, UserSettings, PriceAlert } from './interfaces'

export const API_PRICE = import.meta.env.VITE_API_PRICE || 'http://localhost:8081'
export const API_AI    = import.meta.env.VITE_API_AI    || 'http://localhost:8002'
export const API_AUTH  = import.meta.env.VITE_API_AUTH  || 'http://localhost:8080'

// ─── Instancias Axios ──────────────────────────────────────────────────────────

export const apiClient = axios.create({ baseURL: API_PRICE, timeout: 8000 })
export const aiClient  = axios.create({ baseURL: API_AI,    timeout: 10000 })
export const authClient = axios.create({ baseURL: API_AUTH, timeout: 8000 })

// Inyecta token JWT en peticiones a market-service y user-service
const authInjector = (config: any) => {
  const token = localStorage.getItem('token')
  if (token) config.headers = { ...config.headers, Authorization: `Bearer ${token}` }
  return config
}

apiClient.interceptors.request.use(authInjector)
authClient.interceptors.request.use(authInjector)

// Limpia sesión si token expira
const expiredHandler = (err: any) => {
  if (err.response?.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('userName')
    localStorage.removeItem('userPlan')
    window.dispatchEvent(new Event('session-expired'))
  }
  return Promise.reject(err)
}
apiClient.interceptors.response.use(res => res, expiredHandler)
authClient.interceptors.response.use(res => res, expiredHandler)

// ─── API helpers: user-service ─────────────────────────────────────────────────

export const userApi = {
  getProfile:           ()                           => authClient.get<UserProfile>('/user/profile'),
  updateProfile:        (body: Partial<UserProfile>) => authClient.put('/user/profile', body),
  changePassword:       (currentPassword: string, newPassword: string) =>
                          authClient.post('/user/change-password', { currentPassword, newPassword }),

  getSettings:          ()                           => authClient.get<UserSettings>('/user/settings'),
  updateSettings:       (body: Partial<UserSettings>) => authClient.put('/user/settings', body),

  saveBinanceKeys:      (apiKey: string, secret: string) =>
                          authClient.post('/user/settings/binance-keys', { apiKey, secret }),
  deleteBinanceKeys:    ()                           => authClient.delete('/user/settings/binance-keys'),
  hasBinanceKeys:       ()                           => authClient.get<{ hasKeys: boolean }>('/user/settings/binance-has-keys'),

  getAlerts:            ()                           => authClient.get<PriceAlert[]>('/user/alerts'),
  createAlert:          (body: Omit<PriceAlert, 'id' | 'triggered' | 'createdAt'>) =>
                          authClient.post<PriceAlert>('/user/alerts', body),
  deleteAlert:          (id: number)                 => authClient.delete(`/user/alerts/${id}`),
  triggerAlert:         (id: number)                 => authClient.put(`/user/alerts/${id}/trigger`),
}
