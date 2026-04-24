// ============================================================
// Roof Manager — Square Merchant Token Resolver
// Returns a valid per-user Square OAuth access token + location,
// refreshing it via the stored refresh_token when expired.
// ============================================================

export interface SquareMerchantCreds {
  accessToken: string
  locationId: string
  merchantId: string
}

export interface SquareTokenError {
  error: string
  status: number
}

const SQUARE_API_BASE = 'https://connect.squareup.com'
const REFRESH_SKEW_SECONDS = 120 // refresh if token expires within 2 minutes

export async function getMerchantSquareCreds(
  env: any,
  customerId: number
): Promise<SquareMerchantCreds | SquareTokenError> {
  const row = await env.DB.prepare(
    `SELECT square_merchant_id, square_merchant_access_token, square_merchant_refresh_token,
            square_merchant_token_expires_at, square_merchant_location_id
     FROM customers WHERE id = ?`
  ).bind(customerId).first<any>()

  if (!row?.square_merchant_access_token) {
    return {
      error: 'Square is not connected for this account. Go to Settings → Connect Square to enable payment links.',
      status: 400
    }
  }

  if (!row.square_merchant_location_id) {
    return {
      error: 'Square is connected but no location was found. Reconnect Square in Settings.',
      status: 400
    }
  }

  let accessToken: string = row.square_merchant_access_token
  const expiresAt = row.square_merchant_token_expires_at

  if (expiresAt && isExpiringSoon(expiresAt) && row.square_merchant_refresh_token) {
    const refreshed = await refreshSquareToken(env, customerId, row.square_merchant_refresh_token)
    if ('accessToken' in refreshed) {
      accessToken = refreshed.accessToken
    } else {
      return refreshed
    }
  }

  return {
    accessToken,
    locationId: row.square_merchant_location_id,
    merchantId: row.square_merchant_id || ''
  }
}

function isExpiringSoon(expiresAt: string): boolean {
  try {
    const expiryMs = new Date(expiresAt).getTime()
    if (Number.isNaN(expiryMs)) return false
    return expiryMs - Date.now() < REFRESH_SKEW_SECONDS * 1000
  } catch {
    return false
  }
}

async function refreshSquareToken(
  env: any,
  customerId: number,
  refreshToken: string
): Promise<{ accessToken: string } | SquareTokenError> {
  const clientId = env.SQUARE_APPLICATION_ID
  const clientSecret = env.SQUARE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { error: 'Square OAuth is not configured on the server.', status: 503 }
  }

  try {
    const resp = await fetch(`${SQUARE_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    })
    const data: any = await resp.json()
    if (!resp.ok || !data.access_token) {
      return {
        error: 'Square access token expired and could not be refreshed. Reconnect Square in Settings.',
        status: 401
      }
    }

    await env.DB.prepare(
      `UPDATE customers SET
         square_merchant_access_token = ?,
         square_merchant_refresh_token = ?,
         square_merchant_token_expires_at = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      data.access_token,
      data.refresh_token || refreshToken,
      data.expires_at || null,
      customerId
    ).run()

    return { accessToken: data.access_token }
  } catch {
    return {
      error: 'Failed to refresh Square token. Reconnect Square in Settings.',
      status: 502
    }
  }
}
