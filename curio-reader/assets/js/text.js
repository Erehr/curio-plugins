// Self-contained locale loader for the Reader plugin: reads locales/en.json and the active language from document.documentElement.lang, updating on curio-language.
const BASE = new URL('../../locales/', import.meta.url)
const PLURAL_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const listeners = new Set()

let lang = document.documentElement.lang || 'en'
let en = {}
let own = {}
let rules = new Intl.PluralRules('en')

async function loadFile(code) {
  try {
    const r = await fetch(new URL(`${code}.json`, BASE))
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function load(code) {
  lang = code || 'en'
  const base = lang.includes('-') ? lang.split('-')[0] : null
  own = lang === 'en' ? {} : (await loadFile(lang)) || (base ? await loadFile(base) : null) || {}
  try {
    rules = new Intl.PluralRules(lang)
  } catch {
    rules = new Intl.PluralRules('en')
  }
}

export const ready = (async () => {
  en = (await loadFile('en')) || {}
  await load(document.documentElement.lang || 'en')
})()

window.addEventListener('curio-language', async (e) => {
  const next = e.detail?.language || document.documentElement.lang || 'en'
  if (next === lang) return
  await load(next)
  for (const fn of listeners) fn(lang)
})

function lookup(obj, key) {
  let cur = obj
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

function pickForm(msg, plural) {
  if (plural == null || !msg.includes('|')) return msg
  const forms = msg.split('|').map((s) => s.trim())
  if (forms.length === 1) return forms[0]
  if (forms.length === 2) return plural === 1 ? forms[0] : forms[1]
  const cats = PLURAL_ORDER.filter((c) => rules.resolvedOptions().pluralCategories.includes(c))
  const idx = cats.indexOf(rules.select(plural))
  return forms[idx >= 0 && idx < forms.length ? idx : forms.length - 1]
}

export const language = () => lang

/** The text of `key` with its named values; `plural` picks a count's form. */
export function t(key, named, plural) {
  const raw = lookup(own, key) ?? lookup(en, key)
  if (raw == null) return key
  const form = pickForm(raw, plural)
  return named ? form.replace(/\{(\w+)\}/g, (_, k) => (named[k] != null ? String(named[k]) : `{${k}}`)) : form
}

/** The text of `key` for `n` things, the number shown with its digits grouped. */
export const tc = (key, n, named = {}) => t(key, { ...named, count: n.toLocaleString() }, n)

/** A size in bytes as the system writes numbers. */
export function sizeText(bytes) {
  let v = Number(bytes) || 0
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0, minimumFractionDigits: i ? 1 : 0 })} ${UNITS[i]}`
}

/** A shortcut chord formatted with spaced pluses. */
export const keyText = (chord) => (chord ? chord.split('+').map((k) => k.trim()).join(' + ') : '')

/** Calls `fn` whenever the window's language changes. */
export const onLanguage = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
