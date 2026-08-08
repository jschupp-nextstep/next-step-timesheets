import { useEffect, useState } from 'react'

// A tab left open across a deploy would otherwise keep running the old
// build indefinitely -- there's nothing that would ever prompt a reload on
// its own. Re-check periodically and on refocus (the moment someone's about
// to actually use the app again, after possibly having left the tab open
// for days) rather than only at initial load.
const CHECK_INTERVAL_MS = 10 * 60 * 1000

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
        if (!res.ok) return
        const data: { buildId?: string } = await res.json()
        if (!cancelled && data.buildId && data.buildId !== __BUILD_ID__) {
          setUpdateAvailable(true)
        }
      } catch {
        // Offline or a transient network hiccup -- not worth surfacing to
        // the user, the next scheduled check will just try again.
      }
    }

    check()
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    window.addEventListener('focus', check)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [])

  return updateAvailable
}
