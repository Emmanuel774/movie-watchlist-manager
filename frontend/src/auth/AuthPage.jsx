import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth.js'

const passwordRule =
  'Use at least 12 characters, including uppercase and lowercase letters and a number.'

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { authNotice, login, register } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Enter a valid email address.'
    }
    if (isRegister) {
      if (Array.from(password).length < 12) return passwordRule
      if (new TextEncoder().encode(password).length > 72) {
        return 'Password must be no more than 72 UTF-8 bytes.'
      }
      if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        return passwordRule
      }
    } else if (!password) {
      return 'Enter your password.'
    }
    return ''
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)
    try {
      const credentials = { email: email.trim(), password }
      if (isRegister) {
        await register(credentials)
        navigate('/login', {
          replace: true,
          state: { message: 'Your account is ready. Sign in to continue.' },
        })
      } else {
        await login(credentials)
        navigate(location.state?.from || '/', { replace: true })
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to complete your request. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-film-grain" aria-hidden="true" />
      <header className="auth-topbar">
        <Link to="/login" className="auth-brand" aria-label="NOIR home">
          <span className="noir-mark" aria-hidden="true">N</span>
          <span>NOIR</span>
        </Link>
        <span className="auth-top-note">A PRIVATE CINEMA JOURNAL</span>
      </header>

      <div className="auth-layout">
        <section className="auth-editorial" aria-label="NOIR introduction">
          <p className="auth-eyebrow"><span /> STORIES STAY WITH US</p>
          <h1>Make room<br />for <em>great</em> stories.</h1>
          <p className="auth-editorial-copy">
            Keep the films you love close, discover what to watch next, and
            make every movie night feel like an opening scene.
          </p>
          <div className="auth-editorial-rule" />
          <p className="auth-editorial-caption">YOUR COLLECTION. YOUR POINT OF VIEW.</p>
        </section>

        <section className="auth-card" aria-labelledby="auth-heading">
          <div className="auth-card-topline">
            <span>{isRegister ? 'BEGIN YOUR COLLECTION' : 'WELCOME BACK'}</span>
            <span className="auth-card-index">NO. 01</span>
          </div>
          <h2 id="auth-heading">{isRegister ? 'Join the screening.' : 'The lights are low.'}</h2>
          <p className="auth-card-intro">
            {isRegister
              ? 'Create your NOIR account and start collecting.'
              : 'Sign in to return to your movie universe.'}
          </p>

          {(location.state?.message || authNotice) && (
            <p className="auth-success" role="status">
              {location.state?.message || authNotice}
            </p>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}

          <form className="auth-form" onSubmit={submit} noValidate>
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <div className="auth-label-line">
              <label htmlFor="auth-password">Password</label>
              {isRegister && <span>12+ CHARACTERS</span>}
            </div>
            <div className="auth-password-wrap">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={isRegister ? 'password-hint' : undefined}
                required
              />
              <button
                className="auth-password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            {isRegister && <p className="auth-hint" id="password-hint">{passwordRule}</p>}

            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? 'PLEASE WAIT…'
                : isRegister
                  ? 'CREATE ACCOUNT'
                  : 'ENTER NOIR'}
              {!isSubmitting && <span aria-hidden="true">↗</span>}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? 'Already have an account?' : 'New to NOIR?'}
            {' '}
            <Link to={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <p className="auth-private-note">
            By continuing, you agree to keep your viewing space yours.
          </p>
        </section>
      </div>
      <footer className="auth-footer">
        <span>NOIR <span aria-hidden="true">·</span> THE ART OF WHAT’S NEXT</span>
        <span>EST. FOR THE LOVE OF FILM</span>
      </footer>
    </main>
  )
}
