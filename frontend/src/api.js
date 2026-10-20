import axios from 'axios'

export const API_URL = import.meta.env.VITE_API_URL || '/api/movies'
const apiPath = API_URL.replace(/\/+$/, '')
const apiRoot = apiPath.replace(/\/movies$/, '')
export const AUTH_URL = `${apiRoot}/auth`
export const ADMIN_URL = `${apiRoot}/admin`
export const COLLECTION_URL = `${apiRoot}/collections`

let accessToken = null

const isPathWithin = (pathname, prefix) => {
  const normalizedPrefix = prefix.replace(/\/+$/, '')
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`)
}

export const setAccessToken = (token) => {
  accessToken = token
}

export const api = axios.create()

api.interceptors.request.use((config) => {
  const requestUrl = new URL(config.url || '', window.location.href)
  const backendUrl = new URL(API_URL, window.location.href)
  const isBackendRequest =
    requestUrl.origin === backendUrl.origin &&
    (isPathWithin(requestUrl.pathname, backendUrl.pathname) ||
      isPathWithin(
        requestUrl.pathname,
        new URL(AUTH_URL, window.location.href).pathname
      ) ||
      isPathWithin(
        requestUrl.pathname,
        new URL(ADMIN_URL, window.location.href).pathname
      ) ||
      isPathWithin(
        requestUrl.pathname,
        new URL(COLLECTION_URL, window.location.href).pathname
      ))
  const isPublicAuthRequest =
    requestUrl.pathname.endsWith('/auth/login') ||
    requestUrl.pathname.endsWith('/auth/register')

  if (isBackendRequest && !isPublicAuthRequest && accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const hasAuthHeader = Boolean(error.config?.headers?.Authorization)
    const requestUrl = error.config?.url
      ? new URL(error.config.url, window.location.href)
      : null
    const backendUrl = new URL(API_URL, window.location.href)
    const protectedPaths = [
      new URL(AUTH_URL, window.location.href).pathname,
      new URL(ADMIN_URL, window.location.href).pathname,
      new URL(COLLECTION_URL, window.location.href).pathname,
    ]

    if (
      error.response?.status === 401 &&
      hasAuthHeader &&
      requestUrl?.origin === backendUrl.origin &&
      (isPathWithin(requestUrl.pathname, backendUrl.pathname) ||
        protectedPaths.some((path) => isPathWithin(requestUrl.pathname, path)))
    ) {
      accessToken = null
      try {
        window.sessionStorage.removeItem('noir.accessToken')
      } catch {
        // The context also clears its in-memory session on this event.
      }
      window.dispatchEvent(new Event('noir:auth-expired'))
    }

    return Promise.reject(error)
  }
)
