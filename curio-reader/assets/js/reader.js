// The reader's shell in Curio's viewer: which item is open, the settings, the side strip, and what is kept; it knows no format.
// What is open is a reading, one face for every kind of file: comic.js for comics and picture archives, fixedbook.js for books of fixed pages (PDFs, fixed layout EPUBs), books.js for books whose text flows.
// A reading gives open(item, kept, it, opened), close(), save(), tools(), tool(id, menu, value), key(e), settingsChanged(), view_() (its choices: side, sideTab, rtl), setOwn(change), sideable, firstTab(),
// and for the side strip goTo(key), pageMenu(page, pages), toggleMark(), removeMark(key), renameMark(key, label), search(query), stopSearch().
import { Side, SIDE_MIN, SIDE_MAX } from './side.js'
import { Comic } from './comic.js'
import { BOOK_EXTS, openBook } from './bookfile.js'
import { ReadState } from './readstate.js'
import { DEFAULTS, current } from './defaults.js'
import { keyText, onLanguage, ready, t } from './text.js'

const curio = Curio.connect()
const main = document.getElementById('main')
const note = document.getElementById('note')
const sideEl = document.getElementById('side')

let settings = { ...DEFAULTS }
// the viewer keys as the person has bound them (Settings › Shortcuts), for the hints that name them
let keys = {}
let item = null
let reading = null
// what is open, for probes run in this page through the web view's debugging port
globalThis.readerProbe = () => reading

const readState = new ReadState(curio, () => settings.readState)
const side = new Side(sideEl, {
  pictures: null,
  on: {
    go: (key) => reading?.goTo(key),
    menu: (p, pages) => reading?.pageMenu(p, pages),
    toggle: () => reading?.toggleMark(),
    remove: (key) => reading?.removeMark(key),
    rename: (key, label) => reading?.renameMark(key, label),
    tab: (tab) => reading?.setOwn({ sideTab: tab }),
    resizing: (w) => document.body.style.setProperty('--side-w', `${w}px`),
    resized: (w) => changeSettings({ sideWidth: w }),
    search: (q) => reading.search(q),
    stopSearch: () => reading?.stopSearch?.(),
    keyOf: (id) => keyText(keys[id] || ''),
  },
})
const shell = {
  curio,
  side,
  readState,
  say,
  layoutSide,
  toggleSide,
  changeSettings,
  settings: () => settings,
  remembered: (kind) => settings[`${kind}View`] || {},
  // what was last chosen in a comic, a picture archive, a PDF or a book: how the next one of its kind opens
  remember: (kind, change) => changeSettings({ [`${kind}View`]: { ...(settings[`${kind}View`] || {}), ...change } }),
  setTools: (tools) => curio.viewer.setTools(tools),
  keyOf: (id) => keyText(keys[id] || ''),
  saved: (id, value) => curio.plugin.itemState.set({ id, value }).catch(() => {}),
  // a key a frame in the page didn't use goes on to Curio, as one pressed in the page itself does
  passKey: (e) => dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, cancelable: true })),
  find: () => {
    if (!reading?.view_().side) toggleSide()
    side.find()
  },
}
const comic = new Comic(main, shell)
// the readings for books come with pdf.js's and foliate-js's code, loaded when a book is first opened, while its file is
const made = {}
let bookCode = null
async function bookReading(fixed) {
  const [{ FixedBook }, { Books }] = await bookCode
  const key = fixed ? 'fixed' : 'books'
  return (made[key] ||= fixed ? new FixedBook(main, shell) : new Books(main, shell))
}

/** Words over the page area, or an element in its place. */
function say(what) {
  if (what instanceof Node) {
    note.replaceChildren(what)
    main.hidden = true
  } else note.textContent = what
  note.hidden = !what
}

curio.on('plugin.item', async ({ data }) => {
  reading?.close()
  reading = null
  item = data
  const id = data.id
  side.load([], [])
  readState.stop()
  main.hidden = false
  layoutSide()
  say('')
  ready.then(() => item?.id === id && !reading && say(t('reader.opening')))
  const isBook = BOOK_EXTS.includes((data.ext || '').toLowerCase())
  let next = comic
  if (isBook) bookCode ||= Promise.all([import('./fixedbook.js'), import('./books.js')])
  try {
    const [kept, it] = await Promise.all([curio.plugin.itemState.get({ id }).then((r) => r.value || {}, () => ({})), curio.item.get({ id }).catch(() => null), ready])
    if (item?.id !== id) return
    readState.start(id, it?.fields)
    const opened = isBook ? await openBook(curio, data, it) : null
    if (item?.id !== id) return opened?.book.destroy?.()
    // pages drawn at a set size read as a comic's do; text that flows has its own reading
    if (opened) next = await bookReading(opened.fixed)
    if (item?.id !== id) return opened.book.destroy?.()
    reading = next
    await next.open(data, kept, it, opened)
    if (item?.id !== id) return
    layoutSide()
  } catch (e) {
    if (item?.id !== id) return
    next.close()
    reading = null
    layoutSide()
    say(isBook ? t('reader.cantOpenBook', { error: e.message || e }) : t('reader.cantOpenArchive', { error: e.message || e }))
    curio.viewer.setTools({})
  }
})

/** The strip beside the pages while reading, at the reading edge. */
function layoutSide() {
  const v = reading?.view_() || {}
  const open = !!(reading?.sideable && v.side)
  const b = document.body.classList
  b.toggle('side-open', open)
  b.toggle('side-right', !!v.rtl)
  document.body.style.setProperty('--side-w', `${Math.min(SIDE_MAX, Math.max(SIDE_MIN, settings.sideWidth || DEFAULTS.sideWidth))}px`)
  if (!open) return side.hide()
  side.show(v.sideTab || reading.firstTab())
  side.resized()
}

function toggleSide() {
  if (!reading?.sideable) return
  reading.setOwn({ side: !reading.view_().side })
  layoutSide()
  reading.tools()
}

curio.on('plugin.keys', ({ data }) => {
  keys = data.viewer || {}
  side.drawMarks()
})

curio.on('plugin.tool', ({ data }) => {
  if (data.id === 'side') toggleSide()
  else reading?.tool(data.id, data.menu, data.value)
})

document.addEventListener('keydown', (e) => {
  if (reading?.key(e)) e.preventDefault()
})

/** A setting changed here: kept, and shown at once, as Curio tells only the plugin's other pages. */
function changeSettings(values) {
  return curio.plugin.settings.set({ values }).then(took, () => {})
}

function took(s) {
  settings = current(s)
  reading?.settingsChanged()
  layoutSide()
}
curio.on('plugin.settingsChanged', ({ data }) => took(data))
curio.on('plugin.beforeExit', () => reading?.save(true))
curio.on('plugin.hide', () => reading?.save(true))
curio.plugin.settings.get().then(took)
// the side strip's own words once the text has come, and everything's again in another language
ready.then(() => side.words())
onLanguage(() => {
  side.words()
  reading?.languageChanged?.()
})
