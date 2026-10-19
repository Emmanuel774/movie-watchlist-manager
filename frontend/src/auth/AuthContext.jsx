import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { api, AUTH_URL, setAccessToken } from '../api.js'
import { AuthContext } from './authStore.js'

const TOKEN_STORAGE_KEY = 'noir.accessToken'
const STORAGE_WARNING =
  'Session storage is unavailable. You can sign in for this tab, but reloading will sign you out.'

const readStoredToken = () => {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

const canReadSessionStorage = () => {
  try {
    window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

const isPublicUser = (user) =>
  user &&
  typeof user.id === 'string' &&
  typeof user.email === 'string' &&
  ['admin', 'normal'].includes(user.role)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authNotice, setAuthNotice] = useState('')
  const [isLoading, setIsLoading] = useState(() => Boolean(readStoredToken()))
  const [persistenceWarning, setPersistenceWarning] = useState(() =>
    canReadSessionStorage() ? '' : STORAGE_WARNING
  )

  const clearSession = useCallback((notice = '') => {
    setAccessToken(null)
    setUser(null)
    setAuthNotice(notice)
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      setPersistenceWarning(
        'This browser could not clear saved session data. Close this tab to end the local session.'
      )
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const handleExpiredSession = () => {
      clearSession()
    }
    window.addEventListener('noir:auth-expired', handleExpiredSession)

    const token = readStoredToken()
    if (!token) {
      return () => {
        isCurrent = false
        window.removeEventListener('noir:auth-expired', handleExpiredSession)
      }
    }

    setAccessToken(token)
    api
      .get(`${AUTH_URL}/me`)
      .then(({ data }) => {
        if (isCurrent && isPublicUser(data?.user)) {
          setUser(data.user)
        } else if (isCurrent) {
          clearSession()
        }
      })
      .catch(() => {
        if (isCurrent) clearSession()
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
      window.removeEventListener('noir:auth-expired', handleExpiredSession)
    }
  }, [clearSession])

  const login = useCallback(async (credentials) => {
    const { data } = await api.post(`${AUTH_URL}/login`, credentials)

    if (
      data?.tokenType !== 'Bearer' ||
      typeof data.token !== 'string' ||
      !isPublicUser(data.user)
    ) {
      throw new Error('The server returned an invalid sign-in response.')
    }

    setAccessToken(data.token)
    setUser(data.user)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token)
      setPersistenceWarning('')
    } catch {
      setPersistenceWarning(
        'Session storage is unavailable. You will remain signed in only until this tab is closed or refreshed.'
      )
    }

    return data.user
  }, [])

  const register = useCallback(async (credentials) => {
    const { data } = await api.post(`${AUTH_URL}/register`, credentials)
    return data.user
  }, [])

  const refreshCurrentUser = useCallback(async () => {
    const { data } = await api.get(`${AUTH_URL}/me`)
    if (!isPublicUser(data?.user)) {
      clearSession()
      throw new Error('The server returned an invalid user response.')
    }
    setUser(data.user)
    return data.user
  }, [clearSession])

  const logout = useCallback(async () => {
    try {
      await api.post(`${AUTH_URL}/logout`)
      clearSession()
      return true
    } catch {
      clearSession(
        'Signed out on this device, but the server could not confirm token invalidation.'
      )
      return false
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      authNotice,
      persistenceWarning,
      login,
      register,
      logout,
      refreshCurrentUser,
      clearSession,
    }),
    [
      user,
      isLoading,
      authNotice,
      persistenceWarning,
      login,
      register,
      logout,
      refreshCurrentUser,
      clearSession,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
