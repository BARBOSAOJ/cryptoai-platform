import axios from 'axios'

export const API_PRICE = import.meta.env.VITE_API_PRICE || 'http://localhost:8081'
export const API_AI    = import.meta.env.VITE_API_AI    || 'http://localhost:8002'
export const API_AUTH  = import.meta.env.VITE_API_AUTH  || 'http://localhost:8080'

export const apiClient = axios.create({
  baseURL: API_PRICE,
  timeout: 8000,
})

export const aiClient = axios.create({
  baseURL: API_AI,
  timeout: 10000,
})

export const authClient = axios.create({
  baseURL: API_AUTH,
  timeout: 8000,
})

// Inyecta token JWT automáticamente en peticiones autenticadas
apiClient.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Interceptor de respuesta: limpia sesión si el token expira
apiClient.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('userName')
      localStorage.removeItem('userPlan')
      window.dispatchEvent(new Event('session-expired'))
    }
    return Promise.reject(err)
  }
)
