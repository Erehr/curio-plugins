// The Book widget: the selected book's or comic's reading status to set, how far it has been read with text buttons to read on or start over, then what its file says of it as the rows of Properties (authors, series, length, date, publisher, language, ISBN, identifiers as links). Its name, cover, description and genres are Curio's own widgets'.
import { language as shownLanguage, onLanguage, ready, t } from './text.js'

const curio = Curio.connect()
const $ = (id) => document.getElementById(id)
// the status as the field keeps it; an item without one hasn't been started
const STATES = ['unread', 'want', 'reading', 'finished', 'dropped']

// identifiers as calibre keeps them, to the pages calibre links them to; the value goes into a fixed address, encoded
const AMAZON_SITES = { uk: 'co.uk', jp: 'co.jp', au: 'com.au', br: 'com.br', mx: 'com.mx', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in', nl: 'nl' }
const LINKS = {
  amazon: ['Amazon', (v) => `https://www.amazon.com/dp/${v}`],
  goodreads: ['Goodreads', (v) => `https://www.goodreads.com/book/show/${v}`],
  google: ['Google Books', (v) => `https://books.google.com/books?id=${v}`],
  openlibrary: ['Open Library', (v) => `https://openlibrary.org/books/${v}`],
  isfdb: ['ISFDB', (v) => `https://www.isfdb.org/cgi-bin/pl.cgi?${v}`],
  oclc: ['WorldCat', (v) => `https://www.worldcat.org/oclc/${v}`],
  lccn: ['Library of Congress', (v) => `https://lccn.loc.gov/${v}`],
  doi: ['DOI', (v) => `https://doi.org/${v}`],
}

/** An identifier as a row: the site's name and the id, linked to its page where there is one. */
function rowOf(scheme, value) {
  const amazon = /^amazon_([a-z]{2})$/.exec(scheme)
  if (amazon && AMAZON_SITES[amazon[1]]) return { label: `${LINKS.amazon[0]} ${amazon[1].toUpperCase()}`, value, href: `https://www.amazon.${AMAZON_SITES[amazon[1]]}/dp/${encodeURIComponent(value)}` }
  if (scheme === 'uri' || scheme === 'url') return /^https?:\/\//i.test(value) ? { label: t('reader.book.link'), value: new URL(value).hostname, href: value } : { label: t('reader.book.link'), value }
  const known = LINKS[scheme]
  return known ? { label: known[0], value, href: known[1](encodeURIComponent(value)) } : { label: scheme, value }
}

/** `isbn:…, amazon:…` as pairs. */
const identifiers = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => [s.slice(0, s.indexOf(':')).toLowerCase(), s.slice(s.indexOf(':') + 1)]).filter(([k, v]) => k && v)

const number = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString())

/** A day, or the year alone for a book that names only its year (kept as its first of January). */
function day(text) {
  if (!text) return ''
  if (/-01-01$/.test(text)) return text.slice(0, 4)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : text
}

function language(code) {
  try {
    return (code && new Intl.DisplayNames(shownLanguage(), { type: 'language' }).of(code)) || code || ''
  } catch {
    return code || ''
  }
}

function renderProps(el, rows) {
  el.replaceChildren(...rows.filter((r) => r.value != null && r.value !== '').map((r) => {
    const row = document.createElement('div')
    row.className = 'kv'
    const label = Object.assign(document.createElement('span'), { textContent: r.label })
    let val
    if (r.href) {
      val = Object.assign(document.createElement('a'), { href: r.href, textContent: r.value, title: r.value })
      val.addEventListener('click', (e) => {
        e.preventDefault()
        curio.app.openUrl({ url: r.href }).catch(() => {})
      })
    } else {
      val = Object.assign(document.createElement('span'), { textContent: r.value, title: r.value })
    }
    if (r.mono) val.className = 'mono'
    row.append(label, val)
    return row
  }))
}

let current = null
let currentState = 'unread'

async function show(id) {
  current = id
  const it = await curio.item.get({ id }).catch(() => null)
  if (current !== id || !it) return
  const f = it.fields || {}
  const state = STATES.includes(f.read_state) ? f.read_state : f.read_progress ? 'reading' : 'unread'
  currentState = state
  const known = f.read_progress != null && f.read_progress !== ''
  const progress = state === 'finished' ? 100 : Math.max(0, Math.min(100, Number(f.read_progress) || 0))
  $('progress-bar').style.width = `${progress}%`
  $('progress').hidden = progress === 0
  $('status').textContent = t(`reader.states.${state}`)
  // how far, with the page for a book of pages; nothing where it was never read
  const kept = (await curio.plugin.itemState.get({ id }).catch(() => ({}))).value || {}
  if (current !== id) return
  const page = Number.isInteger(kept.page) && f.pages ? t('reader.book.pageOf', { page: kept.page + 1, pages: f.pages }) : ''
  $('where').textContent = state === 'finished' ? t('reader.states.finished') : known || page ? [known ? `${progress}%` : '', page].filter(Boolean).join(' \u00b7 ') : ''
  $('continue').textContent = state === 'finished' ? t('reader.book.readAgain') : progress > 0 ? t('reader.book.resume') : t('reader.book.read')
  $('reset').hidden = !(progress > 0 || kept.page > 0 || kept.cfi)
  const series = f.series ? `${f.series}${f.series_index != null ? ` #${Number(f.series_index)}` : ''}` : ''
  const rows = [{ label: t('reader.book.author'), value: f.author }, { label: t('reader.book.series'), value: series }, { label: t('reader.book.pages'), value: number(f.pages), mono: true }, { label: t('reader.book.words'), value: number(f.words), mono: true }, { label: t('reader.book.published'), value: day(f.published), mono: true }, { label: t('reader.book.publisher'), value: f.publisher }, { label: t('reader.book.language'), value: language(f.language) }]
  // the ISBN to WorldCat, as calibre links it, then the rest of the identifiers
  if (f.isbn) rows.push({ label: 'ISBN', value: f.isbn, href: `https://www.worldcat.org/isbn/${encodeURIComponent(f.isbn)}`, mono: true })
  for (const [scheme, value] of identifiers(f.identifiers)) if (scheme !== 'isbn') rows.push({ ...rowOf(scheme, value), mono: true })
  renderProps($('facts'), rows)
}

/** Back to the start: the place and how far, not the status. */
async function startOver(id) {
  const kept = (await curio.plugin.itemState.get({ id }).catch(() => ({}))).value || {}
  const { page, cfi, fraction, ...rest } = kept
  await curio.plugin.itemState.set({ id, value: rest }).catch(() => {})
  await curio.item.update({ ids: [id], fields: { read_progress: null } }).catch(() => {})
}

$('continue').addEventListener('click', async () => {
  const id = current
  if (!id) return
  const it = await curio.item.get({ id }).catch(() => null)
  const state = it?.fields?.read_state
  // reading a finished book again starts it over; taking up a dropped one goes on from where it was left
  if (state === 'finished') {
    await startOver(id)
    await curio.item.update({ ids: [id], fields: { read_state: 'reading' } }).catch(() => {})
  } else if (state === 'dropped') await curio.item.update({ ids: [id], fields: { read_state: 'reading' } }).catch(() => {})
  curio.viewer.open({ id })
})

$('status').addEventListener('click', async () => {
  if (!current) return
  const r = $('status').getBoundingClientRect()
  const res = await curio.ui.choose({
    options: STATES.map((value) => ({ value, label: t(`reader.states.${value}`) })),
    value: currentState,
    at: { x: r.left, y: r.top, w: r.width, h: r.height },
  }).catch(() => ({ chosen: false }))
  if (!res?.chosen || !current) return
  const to = res.value
  curio.item.update({ ids: [current], fields: { read_state: to === 'unread' ? null : to, ...(to === 'finished' ? { read_progress: 100 } : {}) } }).catch(() => {})
})

$('reset').addEventListener('click', () => current && startOver(current))

/** Its own words, and the book's again, in the window's language. */
function words() {
  $('status').textContent = t(`reader.states.${currentState}`)
  $('reset').textContent = t('reader.book.startOver')
  if (current) show(current)
}
ready.then(words)
onLanguage(words)

curio.on('plugin.selection', ({ data }) => data.item && ready.then(() => show(data.item.id)))
curio.on('items.changed', ({ data }) => current && data.ids?.some((i) => String(i) === String(current)) && show(current))
