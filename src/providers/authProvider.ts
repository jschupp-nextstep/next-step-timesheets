import type { AuthProvider } from '@refinedev/core'

import { supabaseClient } from '../utility/supabaseClient'

export type Identity =
  | { role: 'admin'; id: string; email: string }
  | { role: 'coach'; id: string; email: string; coachId: string; name: string }

const magicLinkRedirectTo = () => `${window.location.origin}${window.location.pathname}#/update-password`

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
    const email = data.user.email ?? ''
    const { data: coach } = await supabaseClient
      .from('coaches')
      .select('id, name')
      .eq('email', email)
      .maybeSingle()
    if (coach) {
      return { role: 'coach', id: data.user.id, email, coachId: coach.id, name: coach.name }
    }
    return { role: 'admin', id: data.user.id, email }
  },
}
