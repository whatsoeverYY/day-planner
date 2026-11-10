import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const url = env.VITE_SUPABASE_URL?.trim() || ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
  if ((url || key) && (!/^https?:\/\//.test(url) || !/^sb_publishable_[\w-]+$/.test(key))) {
    throw new Error('Set a Supabase project URL and a valid sb_publishable_ key together.')
  }
  return {
    base: './',
    plugins: [vue()],
  }
})
