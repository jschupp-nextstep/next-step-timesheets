// Minimal JWT payload decoder -- no signature verification, since this only
// ever reads claims off a token Supabase itself already gave us over a
// trusted connection (never used to authorize anything server-side).
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!base64) return null
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}
