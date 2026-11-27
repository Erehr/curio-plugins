// A fixed layout EPUB's pages as the surface's pages: each page's own document in a frame at the size it was made for, scaled to the box it shows in.
// A frame loads only while it is in the page and again each time it is put back, so its size is taken, and what it needs from the reader set up, on every load.
import { searchBook, rangeOf, mark, FOUND, FOUND_AT, FOUND_CSS } from '../booksearch.js'

const FALLBACK = { width: 1000, height: 1400 }
// a frame's cost isn't known; this keeps a handful within the budget
const FRAME_BYTES = 24 << 20

/** `width=600, height=800` as a size, or null. */
function sizeIn(text) {
  const w = /width\s*=\s*([\d.]+)/i.exec(text || '')?.[1]
  const h = /height\s*=\s*([\d.]+)/i.exec(text || '')?.[1]
  return w > 0 && h > 0 ? { width: Number(w), height: Number(h) } : null
}

/** The size a page's document was made for: an SVG's viewBox, its viewport `meta`, the book's own, a lone picture's. */
function viewportOf(doc, book) {
  const root = doc.documentElement
  if (root?.localName === 'svg') {
    const [, , w, h] = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  const meta = sizeIn(doc.querySelector('meta[name="viewport"]')?.getAttribute('content'))
  if (meta) return meta
  if (book) return book
  const img = doc.querySelector('img')
  if (img?.naturalWidth) return { width: img.naturalWidth, height: img.naturalHeight }
  return FALLBACK
}

export class FrameSource {
  /** `book` is a fixed layout EPUB as foliate-js opened it; `on` hears sized(p, aspect, w, h), go(page), link(url), live(p), and from inside a page's frame key(e), wheel(e, frame), click(e, frame), menu(p). */
  constructor(book, on) {
    this.book = book
    this.on = on
    const v = book.rendition?.viewport
    this.bookSize = typeof v === 'string' ? sizeIn(v) : v?.width > 0 && v?.height > 0 ? { width: Number(v.width), height: Number(v.height) } : null
    const first = this.bookSize || FALLBACK
    this.pages = book.sections.map((s) => ({ aspect: first.width / first.height, known: false, w: 0, h: 0, vw: first.width, vh: first.height, side: s.pageSpread || null }))
    this.marks = new Set()
    this.ahead = 1
    this.behind = 1
    this.near = 1
    this.pairsWide = true
    // the documents in the page now, by page
    this.docs = new Map()
    this.hits = new Map()
    this.hitAt = null
  }

  close() {
    this.docs.clear()
    this.book.destroy?.()
  }

  want() {
    return 1
  }

  load(p) {
    let cancelled = false
    const done = (async () => {
      const src = await this.book.sections[p].load()
      if (cancelled) throw new Error('cancelled')
      const el = document.createElement('div')
      el.className = 'frame-page'
      const frame = document.createElement('iframe')
      // the page's policy already keeps a book's scripts from running; this keeps its forms and windows out too, and the reader's own listeners in the frame need scripts allowed
      frame.setAttribute('sandbox', 'allow-same-origin allow-scripts')
      frame.setAttribute('scrolling', 'no')
      const pg = this.pages[p]
      Object.assign(frame.style, { width: `${pg.vw}px`, height: `${pg.vh}px` })
      frame.style.visibility = 'hidden'
      frame.addEventListener('load', () => ((frame.style.visibility = ''), this.loaded(p, el, frame)))
      frame.src = src
      el.append(frame)
      return { el, bytes: FRAME_BYTES }
    })()
    return { done, cancel: () => (cancelled = true) }
  }

  loaded(p, el, frame) {
    const doc = frame.contentDocument
    if (!doc?.documentElement || doc.URL === 'about:blank') return
    const pg = this.pages[p]
    const size = viewportOf(doc, this.bookSize)
    pg.vw = size.width
    pg.vh = size.height
    Object.assign(frame.style, { width: `${pg.vw}px`, height: `${pg.vh}px` })
    this.fit(p, el, el.offsetWidth)
    const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
    style.textContent = `html { overflow: hidden !important; } ${FOUND_CSS}`
    ;(doc.head || doc.documentElement).append(style)
    this.docs.set(p, doc)
    doc.defaultView.addEventListener('pagehide', () => this.docs.get(p) === doc && this.docs.delete(p))
    this.wire(p, doc, frame)
    const dpr = window.devicePixelRatio || 1
    this.on.sized(p, pg.vw / pg.vh, pg.vw * dpr, pg.vh * dpr)
    this.paint(p)
    this.on.live(p)
  }

  /** What the page's own listeners would hear, from inside a frame, which they don't. */
  wire(p, doc, frame) {
    doc.addEventListener('keydown', (e) => this.on.key(e))
    doc.addEventListener('wheel', (e) => this.on.wheel(e, frame), { passive: false })
    // the page's own listeners (menus placed at the pointer, closed by a press) hear the pointer over a frame too
    const pass = (e) => {
      const r = frame.getBoundingClientRect()
      const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1
      window.dispatchEvent(new PointerEvent(e.type, { clientX: r.left + e.clientX * k, clientY: r.top + e.clientY * k, button: e.button, buttons: e.buttons, pointerType: e.pointerType }))
    }
    doc.addEventListener('pointermove', pass, { passive: true })
    doc.addEventListener('pointerdown', pass, { passive: true })
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a) return e.defaultPrevented || e.button !== 0 || !doc.getSelection()?.isCollapsed || this.on.click(e, frame)
      e.preventDefault()
      const section = this.book.sections[p]
      const raw = a.getAttribute('href')
      const href = section.resolveHref?.(raw) ?? raw
      if (this.book.isExternal?.(href)) return this.on.link(href)
      const to = this.book.resolveHref?.(href)?.index
      if (Number.isInteger(to)) this.on.go(to)
    })
    doc.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.on.menu(p)
    })
  }

  fit(p, el, w) {
    const frame = el.firstElementChild
    if (frame && w) frame.style.transform = `scale(${w / this.pages[p].vw})`
  }

  free(p, el) {
    el.remove()
    this.docs.delete(p)
    this.book.sections[p].unload?.()
  }

  /** What is selected in a page in view. */
  selected() {
    for (const doc of this.docs.values()) {
      const text = String(doc.getSelection() || '').trim()
      if (text) return text
    }
    return ''
  }

  // search: results by page as CFIs within the page's document, marked in the frames in the page now
  async *find(query) {
    for await (const r of searchBook(this.book, query)) {
      if (r.progress != null) {
        yield r
        continue
      }
      this.hits.set(r.index, r.items.map((it) => it.cfi))
      this.paint(r.index)
      yield { page: r.index, items: r.items.map((it, k) => ({ k, excerpt: it.excerpt })) }
    }
  }

  clearFound() {
    this.hits.clear()
    this.hitAt = null
    for (const p of this.docs.keys()) this.paint(p)
  }

  paint(p) {
    const doc = this.docs.get(p)
    if (!doc) return
    const ranges = (this.hits.get(p) || []).map((cfi) => rangeOf(doc, cfi))
    mark(doc, FOUND, ranges.filter(Boolean))
    const at = this.hitAt?.p === p ? ranges[this.hitAt.k] : null
    mark(doc, FOUND_AT, at ? [at] : [])
    return at
  }

  /** One result stands out; answers where it is in the window, once its page is in a frame. */
  showHit(p, k) {
    const was = this.hitAt
    this.hitAt = { p, k }
    if (was && was.p !== p) this.paint(was.p)
    const at = this.paint(p)
    const frame = at && this.docs.get(p).defaultView.frameElement
    if (!frame) return null
    const r = frame.getBoundingClientRect()
    const s = frame.offsetWidth ? r.width / frame.offsetWidth : 1
    const b = at.getBoundingClientRect()
    return { left: r.left + b.left * s, right: r.left + b.right * s, top: r.top + b.top * s, bottom: r.top + b.bottom * s }
  }
}
