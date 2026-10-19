import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, AUTH_URL } from '../api.js'
import { useAuth } from './useAuth.js'

export default function ChangePasswordPage() {
  const { clearSession, persistenceWarning, user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (newPassword.length < 12 ||
        !/[a-z]/.test(newPassword) ||
        !/[A-Z]/.test(newPassword) ||
        !/\d/.test(newPassword) ||
        new TextEncoder().encode(newPassword).length > 72) {
      setError('Use at least 12 characters with uppercase and lowercase letters and a number (maximum 72 UTF-8 bytes).')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.post(`${AUTH_URL}/change-password`, {
        currentPassword,
        newPassword,
      })
      clearSession('Password changed. Sign in with your new password.')
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'Unable to change your password. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="password-page">
      <header className="password-header">
        <Link className="auth-brand" to="/">
          <span className="noir-mark" aria-hidden="true">N</span>
          <span>NOIR</span>
        </Link>
        <span className="password-account">{user.email}</span>
      </header>

      <section className="password-card" aria-labelledby="password-heading">
        <Link className="password-back" to="/">← BACK TO YOUR COLLECTION</Link>
        <p className="auth-eyebrow"><span /> ACCOUNT SECURITY</p>
        <h1 id="password-heading">Change password</h1>
        <p className="password-intro">
          Confirm your current password to set a new one. You’ll be signed out
          on all devices after the change.
        </p>
        {persistenceWarning && <p className="auth-warning" role="status">{persistenceWarning}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'UPDATING…' : 'UPDATE PASSWORD'}
            {!isSubmitting && <span aria-hidden="true">↗</span>}
          </button>
        </form>
      </section>
    </main>
  )
}
