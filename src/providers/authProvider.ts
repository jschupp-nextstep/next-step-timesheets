import type { AuthProvider } from '@refinedev/core'

import { supabaseClient } from '../utility/supabaseClient'

// A person can be both a scheduler and a coach (same email in both tables);
// coachId is set on a scheduler identity in that case so the scheduler
// layout can offer the coach screens too.
export type Identity =
  | { role: 'admin'; id: string; email: string }
  | { role: 'scheduler'; id: string; email: string; schedulerId: string; name: string; coachId?: string; coachActive?: boolean }
  // coachActive false = deactivated: can sign in and read history, but RLS
  // (0023, coach_is_active()) refuses new/changed entries, claims, swaps.
  | { role: 'coach'; id: string; email: string; coachId: string; name: string; coachActive: boolean }
  // Signed in, but on no roster -- since 0017, no longer silently an admin.
  | { role: 'none'; id: string; email: string }

// Deliberately no `#/update-password` here. This app uses HashRouter, and
// Supabase delivers magic-link/recovery tokens as their own URL fragment
// (`#access_token=...`) -- a URL only has one `#`, so appending our route
// onto it would corrupt Supabase's fragment into unparseable garbage
// (`/update-password#access_token` becomes the "key" instead of
// `access_token`). Redirect to the bare origin instead and let
// MagicLinkRedirectHandler (in App.tsx) route to /update-password once a
// session actually exists.
const magicLinkRedirectTo = () => `${window.location.origin}${window.location.pathname}`

export const authProvider: AuthProvider = {
  login: async (params) => {
    if (params.magicLink) {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email: params.email,
        options: { emailRedirectTo: magicLinkRedirectTo() },
      })
      if (error) {
        return { success: false, error: { name: 'MagicLinkError', message: error.message } }
      }
      return {
        success: true,
        successNotification: {
          message: 'Check your email',
          description: 'We sent you a sign-in link.',
        },
      }
    }
    const { email, password } = params
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password })
    if (error) {
      return { success: false, error: { name: 'LoginError', message: error.message } }
    }
    return { success: true, redirectTo: '/' }
  },
  logout: async () => {
    await supabaseClient.auth.signOut()
    return { success: true, redirectTo: '/login' }
  },
  check: async () => {
    const { data } = await supabaseClient.auth.getSession()
    if (data.session) {
      return { authenticated: true }
    }
    return { authenticated: false, redirectTo: '/login' }
  },
  forgotPassword: async ({ email }) => {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: magicLinkRedirectTo(),
    })
    if (error) {
      return { success: false, error: { name: 'ForgotPasswordError', message: error.message } }
    }
    return {
      success: true,
      successNotification: {
        message: 'Check your email',
        description: 'A password reset link has been sent to your email.',
      },
    }
  },
  updatePassword: async ({ password }) => {
    const { error } = await supabaseClient.auth.updateUser({ password })
    if (error) {
      return { success: false, error: { name: 'UpdatePasswordError', message: error.message } }
    }
    return { success: true, redirectTo: '/' }
  },
  onError: async (error) => {
    return { error }
  },
  getIdentity: async (): Promise<Identity | null> => {
    const { data } = await supabaseClient.auth.getUser()
    if (!data.user) return null
    const email = (data.user.email ?? '').toLowerCase()
    // Roles come from the database's own checks (admins allowlist,
    // schedulers, coaches.email) so the UI can never disagree with RLS.
    // A failed lookup must never read as "no role": right after sign-in a
    // request can go out before the session is attached and error, which
    // used to land a real admin on the "no access" screen until a reload.
    // Retry a few times, then throw (so it isn't cached as 'none').
    const lookup = () =>
      Promise.all([
        supabaseClient.rpc('is_admin'),
        supabaseClient.from('schedulers').select('id, name').eq('email', email).eq('is_active', true).maybeSingle(),
        supabaseClient.from('coaches').select('id, name, is_active').eq('email', email).maybeSingle(),
      ])
    let results = await lookup()
    for (let attempt = 1; attempt < 4 && results.some((r) => r.error); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      results = await lookup()
    }
    const failed = results.find((r) => r.error)
    if (failed?.error) throw new Error(`Couldn't check your access: ${failed.error.message}`)
    const [{ data: isAdmin }, { data: scheduler }, { data: coach }] = results
    if (isAdmin) return { role: 'admin', id: data.user.id, email }
    if (scheduler) {
      return {
        role: 'scheduler',
        id: data.user.id,
        email,
        schedulerId: scheduler.id,
        name: scheduler.name,
        coachId: coach?.id,
        coachActive: coach?.is_active,
      }
    }
    if (coach) {
      return { role: 'coach', id: data.user.id, email, coachId: coach.id, name: coach.name, coachActive: coach.is_active }
    }
    return { role: 'none', id: data.user.id, email }
  },
}

// The coach record behind this login, if any -- a coach, or a scheduler
// who also coaches. Coach-facing pages use this instead of checking role.
export const coachIdOf = (identity: Identity | undefined): string | undefined =>
  identity?.role === 'coach' || identity?.role === 'scheduler' ? identity.coachId : undefined

// True when this login's coach record is deactivated (read-only coach).
export const isInactiveCoach = (identity: Identity | undefined): boolean =>
  !!coachIdOf(identity) && (identity?.role === 'coach' || identity?.role === 'scheduler') && identity.coachActive === false
