import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ADMIN_URL, api } from '../api.js'
import { useAuth } from '../auth/useAuth.js'
import './admin.css'

const passwordPolicy =
  'Use at least 12 characters with uppercase and lowercase letters and a number (maximum 72 UTF-8 bytes).'

const getRequestMessage = (error, fallback) =>
  error.response?.data?.message || error.message || fallback

export default function AdminDashboard() {
  const { user, refreshCurrentUser } = useAuth()
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [savingUserId, setSavingUserId] = useState('')
  const [deletingUserId, setDeletingUserId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const requestDashboardData = useCallback(async () => {
    const [dashboardResponse, usersResponse] = await Promise.all([
        api.get(`${ADMIN_URL}/dashboard`),
        api.get(`${ADMIN_URL}/users`),
      ])
    const nextStats = dashboardResponse.data?.stats
    const nextUsers = usersResponse.data?.users
    if (
      !nextStats ||
      !['totalMovies', 'totalUsers', 'totalAdmins', 'totalNormalUsers'].every(
        (key) => Number.isFinite(nextStats[key])
      ) ||
      !Array.isArray(nextUsers)
    ) {
      throw new Error('The server returned invalid dashboard data.')
    }
    return { nextStats, nextUsers }
  }, [])

  const setDashboardData = useCallback(({ nextStats, nextUsers }) => {
    setError('')
    setStats(nextStats)
    setUsers(nextUsers)
    setDrafts(
      Object.fromEntries(
        nextUsers.map((entry) => [
          entry.id,
          { email: entry.email, role: entry.role },
        ])
      )
    )
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      setDashboardData(await requestDashboardData())
    } catch (requestError) {
      setError(getRequestMessage(requestError, 'Unable to load admin data.'))
    } finally {
      setIsLoading(false)
    }
  }, [requestDashboardData, setDashboardData])

  useEffect(() => {
    let isCurrent = true
    requestDashboardData()
      .then((data) => {
        if (!isCurrent) return
        setError('')
        setStats(data.nextStats)
        setUsers(data.nextUsers)
        setDrafts(
          Object.fromEntries(
            data.nextUsers.map((entry) => [
              entry.id,
              { email: entry.email, role: entry.role },
            ])
          )
        )
      })
      .catch((requestError) => {
        if (isCurrent) {
          setError(getRequestMessage(requestError, 'Unable to load admin data.'))
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [requestDashboardData])

  const createUser = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')

    if (
      password.length < 12 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password) ||
      new TextEncoder().encode(password).length > 72
    ) {
      setError(passwordPolicy)
      return
    }

    setIsCreating(true)
    try {
      await api.post(`${ADMIN_URL}/users`, { email: email.trim(), password })
      setEmail('')
      setPassword('')
      setNotice('Normal user account created. Share its temporary password securely.')
      await loadDashboard()
    } catch (requestError) {
      setError(getRequestMessage(requestError, 'Unable to create user.'))
    } finally {
      setIsCreating(false)
    }
  }

  const updateUser = async (entry) => {
    const draft = drafts[entry.id]
    if (!draft) return
    setError('')
    setNotice('')
    setSavingUserId(entry.id)

    try {
      await api.patch(`${ADMIN_URL}/users/${entry.id}`, {
        email: draft.email,
        role: draft.role,
      })
      if (entry.id === user.id) await refreshCurrentUser()
      setNotice(`Updated ${draft.email}.`)
      await loadDashboard()
    } catch (requestError) {
      setError(getRequestMessage(requestError, 'Unable to update user.'))
    } finally {
      setSavingUserId('')
    }
  }

  const deleteUser = async (entry) => {
    if (entry.id === user.id) return
    if (!window.confirm(`Delete the account for ${entry.email}? This cannot be undone.`)) {
      return
    }

    setError('')
    setNotice('')
    setDeletingUserId(entry.id)
    try {
      await api.delete(`${ADMIN_URL}/users/${entry.id}`)
      setNotice(`Deleted ${entry.email}.`)
      await loadDashboard()
    } catch (requestError) {
      setError(getRequestMessage(requestError, 'Unable to delete user.'))
    } finally {
      setDeletingUserId('')
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link className="auth-brand" to="/" aria-label="NOIR movie management">
          <span className="noir-mark" aria-hidden="true">N</span>
          <span>NOIR</span>
        </Link>
        <nav className="admin-header-actions" aria-label="Admin navigation">
          <Link to="/">Movie management</Link>
          <span className="admin-current-user">{user.email}</span>
        </nav>
      </header>

      <section className="admin-content" aria-labelledby="admin-heading">
        <div className="admin-intro">
          <p className="admin-eyebrow">NOIR · CONTROL ROOM</p>
          <h1 id="admin-heading">Admin dashboard</h1>
          <p>Keep the collection current and manage the people who make it theirs.</p>
        </div>

        {error && <p className="auth-error admin-message" role="alert">{error}</p>}
        {notice && <p className="auth-success admin-message" role="status">{notice}</p>}

        <section className="admin-stat-grid" aria-label="Platform statistics">
          {[
            ['Total movies', stats?.totalMovies],
            ['Registered users', stats?.totalUsers],
            ['Administrators', stats?.totalAdmins],
            ['Normal users', stats?.totalNormalUsers],
          ].map(([label, value]) => (
            <article className="admin-stat-card" key={label}>
              <p>{label}</p>
              <strong aria-label={`${label}: ${isLoading ? 'loading' : value ?? 'unavailable'}`}>
                {isLoading ? '—' : value ?? '—'}
              </strong>
              <span>LIVE COUNT</span>
            </article>
          ))}
        </section>

        <section className="admin-panel" aria-labelledby="create-user-heading">
          <div className="admin-section-heading">
            <div>
              <p className="admin-eyebrow">ACCOUNT ACCESS</p>
              <h2 id="create-user-heading">Create a normal user</h2>
            </div>
            <span className="admin-section-index">01 / USERS</span>
          </div>
          <p className="admin-section-copy">
            New accounts are always created with the normal-user role. The password is not sent by email;
            share it with the user through a secure channel.
          </p>
          <form className="admin-create-form" onSubmit={createUser}>
            <div className="admin-field">
              <label htmlFor="admin-new-email">Email address</label>
              <input
                id="admin-new-email"
                type="email"
                autoComplete="off"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-new-password">Temporary password</label>
              <input
                id="admin-new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="admin-password-policy"
                required
              />
            </div>
            <button className="admin-primary-button" type="submit" disabled={isCreating}>
              {isCreating ? 'CREATING…' : 'CREATE NORMAL USER'}
            </button>
          </form>
          <p className="admin-form-hint" id="admin-password-policy">{passwordPolicy}</p>
        </section>

        <section className="admin-panel" aria-labelledby="users-heading">
          <div className="admin-section-heading">
            <div>
              <p className="admin-eyebrow">PEOPLE IN YOUR ORBIT</p>
              <h2 id="users-heading">User management</h2>
            </div>
            <span className="admin-section-index">
              {isLoading ? 'LOADING' : `${users.length} ACCOUNTS`}
            </span>
          </div>
          <p className="admin-section-copy">
            Update email addresses and roles, or remove accounts. You cannot change your own role or delete your own account.
          </p>

          {isLoading ? (
            <p className="admin-empty" role="status">Loading registered users…</p>
          ) : users.length === 0 ? (
            <p className="admin-empty">No registered users were found.</p>
          ) : (
            <div className="admin-user-list">
              {users.map((entry) => {
                const isSelf = entry.id === user.id
                const draft = drafts[entry.id] || { email: entry.email, role: entry.role }
                const isBusy = savingUserId === entry.id || deletingUserId === entry.id

                return (
                  <article className="admin-user-card" key={entry.id}>
                    <div className="admin-user-meta">
                      <span className={`admin-role-badge${entry.role === 'admin' ? ' is-admin' : ''}`}>
                        {entry.role === 'admin' ? 'ADMIN' : 'NORMAL'}
                      </span>
                      <time dateTime={entry.createdAt}>
                        Joined {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : 'date unavailable'}
                      </time>
                      {isSelf && <span className="admin-you-badge">YOU</span>}
                    </div>
                    <div className="admin-user-fields">
                      <div className="admin-field">
                        <label htmlFor={`admin-email-${entry.id}`}>Email address</label>
                        <input
                          id={`admin-email-${entry.id}`}
                          type="email"
                          maxLength={254}
                          value={draft.email}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [entry.id]: { ...draft, email: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="admin-field">
                        <label htmlFor={`admin-role-${entry.id}`}>Role</label>
                        <select
                          id={`admin-role-${entry.id}`}
                          value={draft.role}
                          disabled={isSelf}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [entry.id]: { ...draft, role: event.target.value },
                            }))
                          }
                        >
                          <option value="normal">Normal user</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </div>
                    </div>
                    <div className="admin-user-actions">
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => updateUser(entry)}
                      >
                        {savingUserId === entry.id ? 'SAVING…' : 'SAVE CHANGES'}
                      </button>
                      <button
                        className="admin-danger-button"
                        type="button"
                        disabled={isSelf || isBusy}
                        title={isSelf ? 'You cannot delete your own administrator account.' : undefined}
                        onClick={() => deleteUser(entry)}
                      >
                        {deletingUserId === entry.id ? 'DELETING…' : 'DELETE USER'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
