import type { AuthProvider } from '@refinedev/core'

import { supabaseClient } from '../utility/supabaseClient'

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
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
    const redirectTo = `${window.location.origin}${window.location.pathname}#/update-password`
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo })
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
    return { success: true, redirectTo: '/login' }
  },
  onError: async (error) => {
    return { error }
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser()
    if (!data.user) return null
    return { id: data.user.id, email: data.user.email ?? '' }
  },
}
