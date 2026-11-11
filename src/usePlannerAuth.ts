import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'

type Access = 'checking' | 'login' | 'owner' | 'denied' | 'error' | 'config'

export function usePlannerAuth() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
  const localMode = !url && !key
  let client: SupabaseClient | null = null
  if (url && key) {
    try {
      client = createClient(url, key, { auth: { flowType: 'pkce' } })
    } catch {
      // A malformed environment is shown in the setup state below.
    }
  }

  const access = ref<Access>(localMode ? 'owner' : client ? 'checking' : 'config')
  const session = shallowRef<Session | null>(null)
  const authError = ref('')
  const authBusy = ref(false)
  const userId = computed(() => session.value?.user.id)

  let accessRequest = 0
  let unsubscribe: (() => void) | undefined
  let active = false

  async function verifyAccess() {
    if (!client || !session.value) return
    const request = ++accessRequest
    access.value = 'checking'
    authError.value = ''
    try {
      const { data, error } = await client.rpc('planner_has_access')
      if (error) throw error
      if (request === accessRequest) access.value = data === true ? 'owner' : 'denied'
    } catch {
      if (request !== accessRequest) return
      access.value = 'error'
      authError.value = '无法验证日程访问权限。请检查网络或 Supabase 配置。'
    }
  }

  function receiveSession(next: Session | null) {
    const changedUser = session.value?.user.id !== next?.user.id
    session.value = next
    if (!next) {
      accessRequest++
      access.value = 'login'
    } else if (changedUser) {
      void verifyAccess()
    }
  }

  async function signIn() {
    if (!client || authBusy.value) return
    authBusy.value = true
    authError.value = ''
    try {
      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href
      const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
      if (error) throw error
    } catch {
      authError.value = '无法打开 GitHub 登录，请稍后重试。'
    } finally {
      authBusy.value = false
    }
  }

  async function signOut() {
    if (!client || authBusy.value) return
    authBusy.value = true
    authError.value = ''
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      receiveSession(null)
    } catch {
      authError.value = '退出登录失败，请重试。'
    } finally {
      authBusy.value = false
    }
  }

  onMounted(() => {
    active = true
    if (client) {
      const { data: auth } = client.auth.onAuthStateChange((_event, nextSession) => {
        window.setTimeout(() => { if (active) receiveSession(nextSession) }, 0)
      })
      unsubscribe = () => auth.subscription.unsubscribe()
    }
  })

  onUnmounted(() => {
    active = false
    accessRequest++
    unsubscribe?.()
  })

  return { localMode, client, access, session, userId, authError, authBusy, verifyAccess, signIn, signOut }
}
