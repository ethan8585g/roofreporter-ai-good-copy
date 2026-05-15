// Roof Manager — native shell API client.
// All requests go to https://www.roofmanager.ca and rely on cookie auth.
// Capacitor lets the WebView share cookies with itself but NOT with Safari,
// so once we log in here, every subsequent navigation in the same WebView
// (including when we hand off to /customer, /admin, etc.) stays authed.

export const BASE = 'https://www.roofmanager.ca'

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    credentials: 'include',
  }
  if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

export const api = {
  // ---- customer auth ----
  customerLogin: (email, password) => request('/api/customer-auth/login', { method: 'POST', body: { email, password } }),
  customerGoogle: (idToken) => request('/api/customer-auth/google', { method: 'POST', body: { idToken } }),
  customerApple: (identityToken, authorizationCode, fullName, email) =>
    request('/api/customer-auth/apple', { method: 'POST', body: { identityToken, authorizationCode, fullName, email } }),
  customerMe: () => request('/api/customer-auth/me'),
  customerLogout: () => request('/api/customer-auth/logout', { method: 'POST' }),
  // ---- admin auth ----
  adminLogin: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  adminMe: () => request('/api/auth/me'),
}
