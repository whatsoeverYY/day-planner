import type { Session } from '@supabase/supabase-js'
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { createPlannerAuthService } from '../services/plannerAuthService'

type Access = 'checking' | 'login' | 'owner' | 'denied' | 'error' | 'config'

export function usePlannerAuth() {
  const { localMode, service } = createPlannerAuthService()
  const access = ref<Access>(localMode ? 'owner' : service ? 'checking' : 'config')
  const session = shallowRef<Session | null>(null)
  const authError = ref('')
  const authBusy = ref(false)
  const userId = computed(() => session.value?.user.id)

  let accessRequest = 0
  let unsubscribe: (() => void) | undefined
  let active = false

  async function verifyAccess() {
    if (!service || !session.value) return
    const request = ++accessRequest
    access.value = 'checking'
    authError.value = ''
    try {
      const hasAccess = await service.hasAccess()
      if (request === accessRequest) access.value = hasAccess ? 'owner' : 'denied'
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
    if (!service || authBusy.value) return
    authBusy.value = true
    authError.value = ''
    try {
      await service.signIn()
    } catch {
      authError.value = '无法打开 GitHub 登录，请稍后重试。'
    } finally {
      authBusy.value = false
    }
  }

  async function signOut() {
    if (!service || authBusy.value) return
    authBusy.value = true
    authError.value = ''
    try {
      await service.signOut()
      receiveSession(null)
    } catch {
      authError.value = '退出登录失败，请重试。'
    } finally {
      authBusy.value = false
    }
  }

  onMounted(() => {
    active = true
    unsubscribe = service?.subscribe(nextSession => {
      window.setTimeout(() => { if (active) receiveSession(nextSession) }, 0)
    })
  })

  onUnmounted(() => {
    active = false
    accessRequest++
    unsubscribe?.()
  })

  return {
    localMode,
    client: service?.client ?? null,
    access,
    session,
    userId,
    authError,
    authBusy,
    verifyAccess,
    signIn,
    signOut,
  }
}
