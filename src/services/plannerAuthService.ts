import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export function createPlannerAuthService() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
  if (!url || !key) return { localMode: !url && !key, service: null }

  let client: SupabaseClient
  try {
    client = createClient(url, key, { auth: { flowType: 'pkce' } })
  } catch {
    return { localMode: false, service: null }
  }

  return {
    localMode: false,
    service: {
      client,
      async hasAccess() {
        const { data, error } = await client.rpc('planner_has_access')
        if (error) throw error
        return data === true
      },
      async signIn() {
        const redirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href
        const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
        if (error) throw error
      },
      async signOut() {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) throw error
      },
      subscribe(onSession: (session: Session | null) => void) {
        const { data } = client.auth.onAuthStateChange((_event, session) => onSession(session))
        return () => data.subscription.unsubscribe()
      },
    },
  }
}
