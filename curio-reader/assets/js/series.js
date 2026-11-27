// The Series widget: the other books and comics of the selected one's series, in order, each with how far it was read; a click selects it, a double-click reads it.
import { onLanguage, ready, t } from './text.js'

const curio = Curio.connect()
const $ = (id) => document.getElementById(id)
const LIMIT = 500

let current = null
let shown = ''
let urls = []
let drawSeq = 0

function clearUrls() {
  for (const u of urls) URL.revokeObjectURL(u)
  urls = []
}
window.addEventListener('pagehide', clearUrls)

function thumbEl(id, seq) {
  const fig = Object.assign(document.createElement('figure'), { className: 'curio-thumb' })
  fig.style.width = '40px'
  const box = Object.assign(document.createElement('div'), { className: 'curio-thumb-box' })
  box.style.height = '40px'
  fig.append(box)
  curio.item.thumbnail({ id }).then((blob) => {
    if (seq !== drawSeq) return
    const url = URL.createObjectURL(blob)
    urls.push(url)
    box.replaceChildren(Object.assign(document.createElement('img'), { src: url, alt: '' }))
  }, () => {})
  return fig
}

const quote = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`

function stateOf(f) {
  if (f.read_state === 'finished') return [t('reader.states.finished'), 'finished']
  if (f.read_state === 'dropped') return [t('reader.states.dropped'), '']
  if (f.read_state === 'want') return [t('reader.states.want'), '']
  const p = Number(f.read_progress) || 0
  if (f.read_state === 'reading' || p > 0) return [`${p}%`, 'reading']
  return ['', '']
}

async function show(id) {
  current = id
  const it = await curio.item.get({ id }).catch(() => null)
  if (current !== id || !it) return
  const series = it.fields?.series
  document.title = series ? `${t('reader.book.series')} · ${series}` : ''
  // nothing to show without a series, so the widget hides
  if (!series) {
    document.body.hidden = true
    shown = ''
    drawSeq++
    clearUrls()
    $('list').replaceChildren()
    return
  }
  const found = await curio.item.query({ query: `series = ${quote(series)}`, sort: 'field:series_index', descending: false, limit: LIMIT }).catch(() => ({ items: [] }))
  if (current !== id) return
  // a query answers without the fields, which the numbers and how far each was read come from
  const r = { items: found.items.length ? await curio.item.getMany({ ids: found.items.map((i) => i.id) }).catch(() => found.items) : [] }
  if (current !== id) return
  // a series of one, the book itself, has nothing more to show
  document.body.hidden = r.items.length < 2
  if (r.items.length < 2) {
    shown = ''
    drawSeq++
    clearUrls()
    $('list').replaceChildren()
    return
  }
  const key = `${series}|${r.items.map((i) => `${i.id}:${i.fields?.series_index}:${i.fields?.read_state}:${i.fields?.read_progress}`).join(',')}`
  if (key === shown) return mark()
  shown = key
  const seq = ++drawSeq
  clearUrls()
  $('list').replaceChildren(...r.items.map((i) => {
    const f = i.fields || {}
    const row = document.createElement('div')
    row.className = 'row'
    row.dataset.id = i.id
    const img = thumbEl(i.id, seq)
    const num = Object.assign(document.createElement('span'), { className: 'num', textContent: f.series_index != null ? String(Number(f.series_index)) : '' })
    const title = Object.assign(document.createElement('span'), { className: 'title', textContent: f.title || i.name.replace(/\.[^.]+$/, '') })
    title.title = i.name
    const [text, cls] = stateOf(f)
    const state = Object.assign(document.createElement('span'), { className: `state ${cls}`, textContent: text })
    row.append(img, num, title, state)
    row.addEventListener('click', () => curio.selection.set({ ids: [i.id] }).catch(() => {}))
    row.addEventListener('dblclick', () => curio.viewer.open({ id: i.id }).catch(() => {}))
    return row
  }))
  mark()
}

function mark() {
  for (const row of $('list').children) row.classList.toggle('current', row.dataset.id === String(current))
}

// its text in the window's language before it first draws, and drawn again in another
onLanguage(() => {
  shown = ''
  if (current) show(current)
})

curio.on('plugin.selection', ({ data }) => data.item && ready.then(() => show(data.item.id)))
curio.on('items.changed', ({ data }) => {
  const listed = new Set([...$('list').children].map((r) => r.dataset.id).concat(String(current)))
  if (current && data.ids?.some((i) => listed.has(String(i)))) show(current)
})
