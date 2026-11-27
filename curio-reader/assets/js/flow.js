// A book whose text flows, scrolled: its sections one under another in one column, each in a frame as wide as the column and as tall as its text.
// Only the sections near the view are in the page. One not laid out yet takes the height its text suggests (its paragraphs' lengths, read from the file without laying it out, at what the sections already measured came to), and its own once it is; whatever changes size, what is read stays where it is.
// books.js drives it as it drives foliate-js's view for turned pages, so it answers to the same names: open, init, goTo, next, prev, search, the `relocate`, `load`, `link` and `external-link` events, and a renderer to set the layout and styles on.
import * as CFI from '../vendor/foliate-js/epubcfi.js'
import { SectionProgress, TOCProgress } from '../vendor/foliate-js/progress.js'
import { stack, rowAt, rowsIn } from './layout.js'
import { searchBook, rangeOf, mark, FOUND, FOUND_CSS } from './booksearch.js'

// sections are in the page from this many screens above the view to this many below it, and leave it further out
const ABOVE = 1
const BELOW = 2
const KEPT = 3
const FRAMES_MAX = 6
// a section that keeps changing height as its frame does (heights in `vh`) is left as it is after this many in a second
const RESIZES_MAX = 12
const STEP_PX = 80
// a section smaller than this isn't a chapter to learn the text's height from; one not laid out yet is at least this tall
const CHAPTER_BYTES = 2048
const GUESS_MIN_PX = 160
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, pre, td, th, figcaption, div'
const SURVEYED_AT_ONCE = 8

/** What a section's height comes from, read from its document as parsed: the length of each paragraph, and how many pictures. */
function shapeOf(doc) {
  const lens = []
  for (const el of doc.body.querySelectorAll(BLOCKS)) {
    // a block holding blocks is counted by them
    if (el.querySelector(BLOCKS)) continue
    const n = el.textContent.trim().length
    if (n) lens.push(n)
  }
  if (!lens.length) {
    const n = doc.body.textContent.trim().length
    if (n) lens.push(n)
  }
  return { lens: Uint32Array.from(lens), pictures: doc.body.querySelectorAll('img, svg').length }
}
const EDGE_PX = 2

class History {
  constructor(go) {
    this.go = go
    this.list = []
    this.at = -1
  }

  pushState(x) {
    if (this.list[this.at] === x) return
    this.list.length = ++this.at
    this.list[this.at] = x
  }

  replaceState(x) {
    if (this.at >= 0) this.list[this.at] = x
  }

  get canGoBack() {
    return this.at > 0
  }

  back() {
    if (this.at > 0) this.go(this.list[--this.at])
  }
}

export class FlowView extends EventTarget {
  constructor() {
    super()
    this.el = document.createElement('div')
    this.el.className = 'flow'
    this.el.tabIndex = 0
    this.strip = document.createElement('div')
    this.strip.className = 'strip'
    this.el.append(this.strip)
    this.renderer = this
    this.history = new History((target) => this.go(target))
    this.attrs = {}
    this.css = ''
    this.items = []
    this.col = stack([], 0)
    this.hits = new Map()
    this.anchor = null
    this.pending = null
    this.el.addEventListener('scroll', () => this.scrolled(), { passive: true })
    // a place still being gone to gives way to the reader's own scrolling
    for (const type of ['wheel', 'pointerdown', 'keydown']) this.el.addEventListener(type, () => (this.pending = null), { passive: true })
    this.resizes = new ResizeObserver(() => this.relayout())
    this.resizes.observe(this.el)
  }

  // books.js puts the view in the page, takes it out and gives it the keyboard
  get node() {
    return this.el
  }

  remove() {
    this.el.remove()
  }

  focus() {
    this.el.focus({ preventScroll: true })
  }

  async open(book) {
    this.book = book
    this.sections = book.sections
    this.items = book.sections.map((s, index) => ({ index, shown: s.linear !== 'no', size: s.size > 0 ? s.size : 0, h: 0, measured: false, shape: null, lines: 0, frame: null, doc: null, watch: null, resized: [] }))
    this.progress = new SectionProgress(book.sections, 1500, 1600)
    if (book.splitTOCHref && book.getTOCFragment) {
      const ids = book.sections.map((s) => s.id)
      const [splitHref, getFragment] = [book.splitTOCHref.bind(book), book.getTOCFragment.bind(book)]
      this.tocProgress = new TOCProgress()
      await this.tocProgress.init({ toc: book.toc ?? [], ids, splitHref, getFragment })
      this.pageProgress = new TOCProgress()
      await this.pageProgress.init({ toc: book.pageList ?? [], ids, splitHref, getFragment })
    }
    // properties books still write with EPUB 2's prefix
    this.unprefix = ({ detail }) => {
      if (detail.type === 'text/css') detail.data = Promise.resolve(detail.data).then((css) => css.replace(/([{\s;])-epub-/gi, '$1'))
    }
    book.transformTarget?.addEventListener('data', this.unprefix)
    this.relayout()
  }

  close() {
    this.closed = true
    this.resizes.disconnect()
    for (const item of this.items) this.unmount(item)
    this.book?.transformTarget?.removeEventListener('data', this.unprefix)
    this.strip.replaceChildren()
  }

  async init({ lastLocation }) {
    if (lastLocation != null && (await this.go(lastLocation))) this.history.pushState(lastLocation)
    else await this.goTo(0)
  }

  // the layout books.js sets on a renderer: the text's width and its margins
  setAttribute(name, value) {
    if (this.attrs[name] === value) return
    this.attrs[name] = value
    if (this.book && !this.queued) this.queued = queueMicrotask(() => ((this.queued = null), this.relayout())) || true
  }

  removeAttribute(name) {
    delete this.attrs[name]
  }

  /** The stylesheet every section gets, over the book's own. */
  setStyles(css) {
    if (css === this.css) return
    this.css = css
    this.measureText()
    for (const item of this.items) {
      item.measured = false
      const style = item.doc?.getElementById('curio-style')
      if (style) style.textContent = this.sheet()
    }
  }

  px(name, fallback = 0) {
    const v = parseFloat(this.attrs[name])
    return Number.isFinite(v) ? v : fallback
  }

  // a section's document is as tall as its text, whatever the book says of heights; pictures stay within a screen
  sheet() {
    const side = this.px('margin-left')
    return `html { display: flow-root !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: hidden !important; padding: 0 ${side}px !important; box-sizing: border-box !important; }
body { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }
img, svg, video, canvas { max-width: 100% !important; max-height: ${Math.max(200, this.H - 2 * this.gap)}px !important; object-fit: contain; }
${FOUND_CSS}
${this.css}`
  }

  /** The view's size or the text's width changed: every section is as wide as the column again, and is measured again as it is laid out. */
  relayout() {
    if (!this.book || this.closed) return
    this.W = this.el.clientWidth || 1
    this.H = this.el.clientHeight || 1
    const side = this.px('margin-left')
    this.gap = this.px('margin-top', 24)
    const width = Math.max(120, Math.min(this.W, this.px('max-inline-size', this.W) + 2 * side))
    const was = this.width
    this.width = Math.floor(width)
    this.measureText()
    if (was && was !== this.width) {
      // text in a narrower column is taller by about as much
      for (const item of this.items) {
        item.measured = false
        item.h *= was / this.width
      }
    }
    this.strip.style.width = `${this.W}px`
    for (const item of this.items) {
      const style = item.doc?.getElementById('curio-style')
      if (style) style.textContent = this.sheet()
    }
    this.settle()
  }

  /** How tall a section not laid out yet is taken to be: as it last was, or what its text comes to, or its size at the pixels per byte of those measured. */
  guess(item) {
    if (item.h > 0) return item.h
    return Math.max(GUESS_MIN_PX, item.shape ? this.textHeight(item) * this.perText : item.size * this.perByte)
  }

  /** The height a section's text would take as plain paragraphs at this width: its lines, a gap after each paragraph, a share of the view for each picture. */
  textHeight(item) {
    const m = this.metrics
    if (!item.lines) for (const n of item.shape.lens) item.lines += Math.ceil(n / m.perLine)
    return item.lines * m.line + item.shape.lens.length * m.line * 0.6 + item.shape.pictures * Math.min(this.H, m.text) * 0.6
  }

  /** The size of a line of text and how many letters it holds, from the stylesheet and the column's width: about two letters to an em. */
  measureText() {
    const font = 16 * (parseFloat(/font-size:\s*([\d.]+)%/.exec(this.css)?.[1]) || 100) / 100
    const line = font * (parseFloat(/line-height:\s*([\d.]+)/.exec(this.css)?.[1]) || 1.5)
    const text = Math.max(60, (this.width || 600) - 2 * this.px('margin-left'))
    this.metrics = { line, text, perLine: Math.max(10, (text / font) * 2) }
    for (const item of this.items) item.lines = 0
  }

  /** What the estimates are scaled by: the middle one of the chapters measured, as a title page or a picture is nothing like the text. */
  rates() {
    const middle = (list) => list.sort((a, b) => a - b)[list.length >> 1]
    const chapters = this.items.filter((item) => item.measured && item.size >= CHAPTER_BYTES)
    // before any is measured: text as it is taken to be set, and a third of a book's bytes markup
    this.perByte = chapters.length ? middle(chapters.map((item) => item.h / item.size)) : (this.metrics.line / this.metrics.perLine) * 0.7
    const read = chapters.filter((item) => item.shape)
    this.perText = read.length ? middle(read.map((item) => item.h / this.textHeight(item))) : 1
  }

  /** Reads every section's shape from the file, the ones nearest `from` first, a few at a time; the column takes the better estimates as they come. */
  async survey(from) {
    const n = this.items.length
    let done = 0
    for (let k = 0; k < n; k++) {
      for (const i of k ? [from + k, from - k] : [from]) {
        const item = this.items[i]
        if (!item || item.shape || !this.sections[i].createDocument) continue
        const doc = await Promise.resolve(this.sections[i].createDocument()).catch(() => null)
        if (this.closed) return
        if (doc?.body) item.shape = shapeOf(doc)
        if (++done % SURVEYED_AT_ONCE) continue
        this.settle()
        await new Promise((r) => setTimeout(r))
      }
    }
    this.settle()
  }

  /** The column laid out again from what is known now, the place kept. */
  settle() {
    if (this.closed) return
    this.restack()
    this.restore()
    this.mountSoon()
  }

  restack() {
    this.rates()
    this.col = stack(this.items.map((item) => (!item.shown ? 0 : item.measured ? item.h : this.guess(item))), this.gap)
    this.strip.style.height = `${this.col.total}px`
    for (const item of this.items) if (item.frame) this.position(item)
  }

  position(item) {
    Object.assign(item.frame.style, { left: `${Math.max(0, (this.W - this.width) / 2)}px`, top: `${this.col.tops[item.index]}px`, width: `${this.width}px`, height: `${this.col.heights[item.index]}px` })
  }

  /** The section at a height in the column: the one there, or the next one that takes room. */
  at(y) {
    let i = Math.max(0, rowAt(this.col, y))
    while (i < this.items.length - 1 && !this.col.heights[i]) i++
    return i
  }

  mountSoon() {
    if (this.mounting) return
    this.mounting = requestAnimationFrame(() => {
      this.mounting = 0
      this.mount()
    })
  }

  /** The sections near the view are in the page; those far from it leave. */
  mount() {
    if (this.closed || !this.items.length) return
    const top = this.el.scrollTop
    const [first, last] = rowsIn(this.col, top - this.H * ABOVE, top + this.H * (1 + BELOW))
    const [keepFirst, keepLast] = rowsIn(this.col, top - this.H * KEPT, top + this.H * (1 + KEPT))
    const at = this.at(top)
    const mounted = this.items.filter((item) => item.frame)
    for (const item of mounted) if (item.index < keepFirst || item.index > keepLast) this.unmount(item)
    for (let i = first; i <= last; i++) {
      const item = this.items[i]
      if (item.shown && !item.frame) this.load(item)
    }
    const far = this.items.filter((item) => item.frame).sort((a, b) => Math.abs(b.index - at) - Math.abs(a.index - at))
    while (far.length > FRAMES_MAX) this.unmount(far.shift())
  }

  async load(item) {
    const frame = document.createElement('iframe')
    // the page's policy keeps a book's scripts from running; the reader's own listeners in the frame need scripts allowed
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    frame.setAttribute('scrolling', 'no')
    // a document without the reader's stylesheet yet is drawn on white
    frame.style.visibility = 'hidden'
    item.frame = frame
    this.position(item)
    frame.addEventListener('load', () => item.frame === frame && this.loaded(item))
    this.strip.append(frame)
    const src = await Promise.resolve(this.sections[item.index].load()).catch(() => null)
    if (item.frame !== frame) return
    if (src) frame.src = src
    else this.unmount(item)
  }

  unmount(item) {
    if (!item.frame) return
    item.watch?.disconnect()
    item.watch = null
    item.frame.remove()
    item.frame = null
    item.doc = null
    if (this.anchor?.item === item.index) this.anchor = { item: item.index, node: null, dy: this.col.tops[item.index] - this.el.scrollTop }
    this.sections[item.index].unload?.()
  }

  loaded(item) {
    const doc = item.frame.contentDocument
    if (!doc?.documentElement || doc.URL === 'about:blank') return
    item.doc = doc
    const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
    style.id = 'curio-style'
    style.textContent = this.sheet()
    ;(doc.head || doc.documentElement).append(style)
    item.frame.style.visibility = ''
    this.links(item, doc)
    this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: item.index } }))
    item.watch = new doc.defaultView.ResizeObserver(() => this.measure(item))
    item.watch.observe(doc.documentElement)
    this.measure(item)
    this.paint(item)
    this.arrive()
    this.located()
  }

  /** A section's own height, now that it is laid out, or laid out again. */
  measure(item) {
    if (!item.doc?.documentElement) return
    const h = Math.max(1, Math.ceil(item.doc.documentElement.getBoundingClientRect().height))
    if (item.measured && h === item.h) return
    const now = performance.now()
    item.resized = item.resized.filter((t) => now - t < 1000)
    if (item.resized.push(now) > RESIZES_MAX) return
    item.h = h
    item.measured = true
    this.settle()
    this.arrive()
  }

  /** What is at the top of the view, to keep there: an element of the section's text and where it is in the view, or the section's own top while it isn't laid out. */
  capture() {
    if (!this.items.length) return
    const top = this.el.scrollTop
    const i = this.at(top)
    const item = this.items[i]
    const start = this.col.tops[i]
    this.anchor = { item: i, node: null, dy: start - top }
    if (!item.doc) return
    const x = this.width / 2
    const from = Math.max(0, top - start)
    for (const y of [from + 4, from + 24, from + 60, from + 120]) {
      const el = item.doc.elementFromPoint(x, Math.min(y, this.col.heights[i] - 1))
      if (!el || el === item.doc.documentElement || el === item.doc.body) continue
      this.anchor = { item: i, node: el, dy: start + el.getBoundingClientRect().top - top }
      return
    }
  }

  /** After sizes changed: the scroll that puts what was at the top of the view back there. */
  restore() {
    const a = this.anchor
    if (!a || this.pending) return
    const y = a.node?.isConnected ? a.node.getBoundingClientRect().top : 0
    const to = this.col.tops[a.item] + y - a.dy
    if (Math.abs(this.el.scrollTop - to) >= 0.5) this.el.scrollTop = to
  }

  scrolled() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.closed) return
      this.capture()
      this.mount()
      this.located()
    })
  }

  /** The range of a section's text the view shows, for the place. */
  shownRange(item) {
    const doc = item.doc
    if (!doc?.body) return null
    const start = this.col.tops[item.index]
    const h = this.col.heights[item.index]
    const top = this.el.scrollTop
    const side = this.px('margin-left')
    const caret = (x, y) => {
      y = Math.min(Math.max(1, y), h - 1)
      if (doc.caretPositionFromPoint) {
        const c = doc.caretPositionFromPoint(x, y)
        return c?.offsetNode ? [c.offsetNode, c.offset] : null
      }
      const r = doc.caretRangeFromPoint?.(x, y)
      return r ? [r.startContainer, r.startOffset] : null
    }
    const a = caret(side + 2, top - start + 2)
    const b = caret(this.width - side - 2, top + this.H - start - 2)
    const range = doc.createRange()
    try {
      if (a) range.setStart(...a)
      else range.setStart(doc.body, 0)
      if (b) range.setEnd(...b)
      else range.setEnd(doc.body, doc.body.childNodes.length)
      if (range.collapsed && a) range.setEnd(...a)
    } catch {
      range.selectNodeContents(doc.body)
    }
    return range
  }

  cfiOf(index, range) {
    const base = this.sections[index].cfi ?? CFI.fake.fromIndex(index)
    return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base
  }

  /** Where the reader is, told as foliate-js's view tells it. */
  located() {
    if (this.closed || this.pending || !this.items.length) return
    const top = this.el.scrollTop
    const i = this.at(top + EDGE_PX)
    const item = this.items[i]
    // a place is a place in text: a section still loading tells its own once it has it
    if (!item.doc) return
    const h = this.col.heights[i] || 1
    const range = this.shownRange(item)
    const progress = this.progress.getProgress(i, Math.min(1, Math.max(0, (top - this.col.tops[i]) / h)), Math.min(1, this.H / h))
    const cfi = this.cfiOf(i, range)
    this.history.replaceState(cfi)
    this.dispatchEvent(new CustomEvent('relocate', { detail: { ...progress, tocItem: this.tocProgress?.getProgress(i, range), pageItem: this.pageProgress?.getProgress(i, range), cfi, range } }))
  }

  resolve(target) {
    try {
      if (typeof target === 'number') return { index: target }
      if (typeof target?.fraction === 'number') {
        const [index, anchor] = this.progress.getSection(target.fraction)
        return { index, anchor }
      }
      if (CFI.isCFI.test(target)) {
        if (this.book.resolveCFI) return this.book.resolveCFI(target)
        const parts = CFI.parse(target)
        const index = CFI.fake.toIndex((parts.parent ?? parts).shift())
        return { index, anchor: (doc) => CFI.toRange(doc, parts) }
      }
      return this.book.resolveHref(target)
    } catch {
      return null
    }
  }

  /** Goes to a section, a CFI, an address in the book or a share of it; answers what it resolved to. */
  async go(target) {
    const to = await this.resolve(target)
    const item = to && this.items[to.index]
    if (!item) return null
    if (!item.shown) {
      // a section outside the book's reading order (its notes) joins the column once it is gone to
      item.shown = true
      this.restack()
    }
    this.pending = { item: item.index, anchor: to.anchor }
    this.anchor = null
    if (!this.surveyed) this.surveyed = this.survey(item.index)
    this.el.scrollTop = this.col.tops[item.index]
    this.mount()
    this.arrive()
    return to
  }

  async goTo(target) {
    const to = await this.go(target)
    if (to) this.history.pushState(target)
    return to
  }

  goToFraction(fraction) {
    return this.goTo({ fraction })
  }

  /** The place gone to is in a section that is laid out now: the view goes to it, and holds it as the rest settles. */
  arrive() {
    const p = this.pending
    const item = p && this.items[p.item]
    if (!item?.doc || !item.measured) return
    let y = 0
    try {
      const at = typeof p.anchor === 'function' ? p.anchor(item.doc) : p.anchor
      if (typeof at === 'number') y = at * item.h
      else if (at) {
        const box = at.getClientRects?.()[0] ?? at.getBoundingClientRect?.()
        const el = at.nodeType === 1 ? at : at.startContainer?.nodeType === 1 ? at.startContainer : at.startContainer?.parentElement
        y = box && (box.width || box.height) ? box.top : (el?.getBoundingClientRect().top ?? 0)
      }
    } catch {
      // a place the section doesn't have: its start
    }
    this.pending = null
    // right at the place, not a little above it, so the place told back is the one gone to
    this.el.scrollTop = this.col.tops[item.index] + Math.max(0, y)
    this.capture()
    this.located()
  }

  get atStart() {
    return this.el.scrollTop <= EDGE_PX
  }

  get atEnd() {
    return this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - EDGE_PX
  }

  next(distance) {
    this.el.scrollTop += distance ?? this.H * 0.9
  }

  prev(distance) {
    this.el.scrollTop -= distance ?? this.H * 0.9
  }

  goLeft() {
    return this.book.dir === 'rtl' ? this.next(STEP_PX) : this.prev(STEP_PX)
  }

  goRight() {
    return this.book.dir === 'rtl' ? this.prev(STEP_PX) : this.next(STEP_PX)
  }

  /** A link in a section: out of the book, to a note, or to another place in it, as foliate-js's view tells them. */
  links(item, doc) {
    const section = this.sections[item.index]
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a) return
      e.preventDefault()
      const raw = a.getAttribute('href')
      const href = section?.resolveHref?.(raw) ?? raw
      if (this.book.isExternal?.(href)) return this.dispatchEvent(new CustomEvent('external-link', { detail: { a, href }, cancelable: true }))
      if (this.dispatchEvent(new CustomEvent('link', { detail: { a, href }, cancelable: true }))) this.goTo(href)
    })
  }

  // search: results by section as foliate-js's view gives them, marked in the sections in the page
  async *search({ query }) {
    this.clearSearch()
    const run = (this.searching = (this.searching || 0) + 1)
    for await (const r of searchBook(this.book, query)) {
      if (run !== this.searching || this.closed) return
      if (r.progress != null) {
        yield r
        continue
      }
      this.hits.set(r.index, r.items.map((it) => it.cfi))
      this.paint(this.items[r.index])
      const base = this.sections[r.index].cfi ?? CFI.fake.fromIndex(r.index)
      yield { index: r.index, label: this.tocProgress?.getProgress(r.index)?.label ?? '', subitems: r.items.map((it) => ({ cfi: CFI.joinIndir(base, it.cfi), excerpt: it.excerpt })) }
    }
    yield 'done'
  }

  clearSearch() {
    this.searching = (this.searching || 0) + 1
    this.hits.clear()
    for (const item of this.items) this.paint(item)
  }

  paint(item) {
    if (item.doc) mark(item.doc, FOUND, (this.hits.get(item.index) || []).map((cfi) => rangeOf(item.doc, cfi)).filter(Boolean))
  }
}
