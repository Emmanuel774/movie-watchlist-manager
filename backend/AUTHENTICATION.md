# Backend authentication

## Configuration

Set `AUTH_TOKEN_SECRET` in the backend's secret environment configuration to a randomly generated value of at least 32 bytes. Do not commit it or use a checked-in fallback. If it is absent or too short, registration remains available, but login and authenticated endpoints return a configuration error. Existing database, CORS, port, and TMDB configuration remains unchanged.

## Deployment configuration

Configure the following values in the environment for the corresponding Render service. Examples are placeholders; supply actual values through Render's environment settings or another trusted secret manager, never in source control.

### Backend Render service

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection URI for the application database. |
| `AUTH_TOKEN_SECRET` | Secret used to sign and verify authentication tokens. Generate a strong random secret of at least 32 bytes. |
| `TMDB_API_KEY` | API key used by the backend for TMDB requests. |
| `FRONTEND_URL` | Origin of the deployed frontend, for example `https://<frontend-service>.onrender.com`. Set this to the frontend origin only, without a path or trailing slash. |
| `PORT` | HTTP port. Render normally supplies this value; the application uses `5001` as a local default. |

### Frontend Render service

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend movie API base URL, for example `https://<backend-service>.onrender.com/api/movies`. |

`VITE_API_URL` is read by Vite during compilation, so configure it on the frontend service **before its production build**. It must point to the deployed backend API base URL ending in `/api/movies`; the frontend derives the authentication and administration API paths from this base.

### One-time administrator provisioning

`INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are inputs to the one-time backend `npm run create-admin` provisioning script. They are not ordinary runtime credentials and are not needed by the normal backend or frontend services after provisioning. Supply them only to the trusted environment used to run the script, then remove them. See [Initial administrator](#initial-administrator) for details.

Never commit actual secret values or `.env` files. Keep `MONGO_URI`, `AUTH_TOKEN_SECRET`, `TMDB_API_KEY`, and the one-time provisioning credentials in trusted secret configuration. `VITE_API_URL` is a public service URL, not a secret, but should still be configured in the frontend service rather than hardcoded to a deployment-specific host in source.

Registration is limited to 10 attempts per source IP per hour, and login to 10 attempts per source IP per 15 minutes. The Express app trusts one reverse-proxy hop so the limiters can use the client IP behind the existing Render proxy; deployments with a different proxy topology should verify this setting.

The current React client keeps the bearer token in tab-scoped `sessionStorage` and calls `/me` to validate it after a reload. This improves persistence over memory-only storage, but it is not protected from same-origin JavaScript and therefore does not provide HttpOnly-cookie security. The smallest stronger persistence change is to have the backend issue and clear a `Secure`, `HttpOnly`, `SameSite` cookie (with appropriate CSRF protection), accept that cookie in authentication middleware, and stop returning/using browser-readable bearer tokens.

## Endpoints

All endpoints are mounted under `/api/auth`.

| Method and path | Request body | Result |
|---|---|---|
| `POST /register` | `{"email":"person@example.com","password":"StrongPassword123"}` | Creates a normal user and returns only their id, email, and role. Registration ignores any supplied role. |
| `POST /login` | `{"email":"person@example.com","password":"StrongPassword123"}` | Returns a 15-minute HS256 bearer token and the public user fields. Invalid credentials use the same generic response. |
| `POST /logout` | No body; send `Authorization: Bearer <token>` | Increments the account token version, invalidating all outstanding tokens for that account. |
| `POST /change-password` | `{"currentPassword":"StrongPassword123","newPassword":"AnotherStrong456"}` and a bearer token | Requires the current password and invalidates all existing tokens after a successful change. |
| `GET /me` | No body; send `Authorization: Bearer <token>` | Verifies the token and returns the public user fields. |

Passwords must be at least 12 characters and include an uppercase letter, a lowercase letter, and a number. Passwords are limited to 72 UTF-8 bytes to avoid bcrypt truncation ambiguity.

## Administrator dashboard and user management

All endpoints below are mounted under `/api/admin` and require a valid bearer token belonging to an administrator. Their responses contain only public account fields; password hashes and token versions are never returned.

| Method and path | Request body | Result |
|---|---|---|
| `GET /dashboard` | None | Returns live movie and user totals, including role totals. |
| `GET /users` | None | Returns registered users with email, role, and timestamps. |
| `POST /users` | `{"email":"person@example.com","password":"StrongPassword123"}` | Creates a normal user. The role field is not accepted. |
| `PATCH /users/:id` | `{"email":"new@example.com","role":"admin"}` | Updates only email and/or role. Roles are restricted to `admin` and `normal`. |
| `DELETE /users/:id` | None | Deletes the account; subsequent authentication fails because the user no longer exists. |

Role changes increment the account token version, invalidating its outstanding tokens. The current administrator cannot change their own role or delete their own account. Demoting or deleting another administrator is serialized with a MongoDB transaction and a shared roster guard, so concurrent administrator changes cannot remove the last administrator. This requires a MongoDB deployment with transaction support; affected operations fail closed with `503` if transactions are unavailable. Administrator-created accounts receive a password set by the administrator; provide it to the user through a secure channel, since this project does not include email delivery or a forced first-login password-change flow.

## Initial administrator

The one-time `npm run create-admin` command reads `MONGO_URI`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_PASSWORD` from the backend process environment. Supply the administrator credentials through a trusted secret manager or temporary, protected environment configuration; do not put them in source control or command-line arguments. The command refuses to create another administrator once one exists and never prints the credentials. Remove the temporary provisioning credentials after use.

## Token invalidation and rollout notes

Bearer tokens are stateless and expire after 15 minutes. There is no token blacklist. Logout and password changes increment a user-level token version; every authenticated request checks it against MongoDB, invalidating all outstanding tokens for that user, including tokens on other devices. Authenticated requests therefore require a database lookup.

Movie creation, update, and deletion require an administrator bearer token. Movie listing and TMDB discovery/search/details/video-preview endpoints remain public for the current homepage and browsing flow. TMDB resolution returns details to unauthenticated and normal users without persisting metadata; administrators may persist resolved metadata. The frontend must send the login token for admin write controls and handle `401`/`403` responses.
