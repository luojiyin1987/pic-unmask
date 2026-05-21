import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Lang } from './i18n'
import { getT } from './i18n'

interface I18nCtx {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('migan-lang') as Lang | null
    if (saved === 'zh' || saved === 'en') return saved
    const browser = navigator.language.toLowerCase()
    if (browser.startsWith('zh')) return 'zh'
    return 'en'
  })

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    localStorage.setItem('migan-lang', next)
  }, [])

  const t = useCallback(
    (key: string) => getT(lang)(key as any),
    [lang]
  )

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
