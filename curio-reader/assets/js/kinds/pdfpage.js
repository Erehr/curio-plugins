// A PDF's pages as the surface's pages: each drawn by pdf.js into a canvas at the size it shows at, with its text to select and its links once it is at rest in view.
// A page's shape needs the page itself from pdf.js, so every page starts at the first one's and takes its own as it arrives.
import { getPageColorMatrix, applyPageColors, getImageRects, getKeptImageRects, getRenderOperatorList } from '../../vendor/foliate-js/pdf.js'
import { FOUND, FOUND_AT } from '../booksearch.js'

// a PDF's unit is a point; a page at its own size shows 96 pixels to the inch
const CSS_PER_POINT = 96 / 72
// the most a page is drawn with; past it the canvas is stretched
const MAX_PIXELS = 16 << 20
const MEASURED_AT_ONCE = 24

export class PdfSource {
  /** `book` is what foliate's `makePDF` made; `on` hears sized(p, aspect, w, h), go(page), link(url) and live(p), a page's text coming into view. */
  constructor(book, on) {
    this.book = book
    this.pdf = book.pdf
    this.on = on
    const first = book.rendition.viewport
    const aspect = first.width / first.height
    this.pages = Array.from({ length: this.pdf.numPages }, () => ({ aspect, known: false, w: 0, h: 0, points: first.width }))
    this.marks = new Set()
    this.thumbs = new Map()
    this.layers = new Map()
    // what a search found, by page: [{ from: [piece, offset], to: [piece, offset] }], and the ranges marking them in the pages in view
    this.hits = new Map()
    this.painted = new Map()
    this.hitAt = null
    // { background, foreground } to draw pages in a style's colours, pictures kept as they are
    this.recolours = true
    this.colours = null
    this.ahead = 3
    this.behind = 1
    this.closed = false
    this.links = {
      goToDestination: (dest) => this.destination(dest).then((p) => p != null && this.on.go(p), () => {}),
      getDestinationHash: () => '#',
      getAnchorUrl: () => '',
      addLinkAttributes: (link, url) => {
        link.href = url
        link.onclick = () => (this.on.link(url), false)
      },
      executeNamedAction: () => {},
      executeSetOCGState: () => {},
    }
  }

  close() {
    this.closed = true
    for (const { url } of this.thumbs.values()) URL.revokeObjectURL(url)
    this.thumbs.clear()
    this.layers.clear()
    this.book.destroy()
  }

  page(p) {
    return this.pdf.getPage(p + 1)
  }

  /** The page a link or an outline entry points to. */
  async destination(dest) {
    const d = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest
    if (!d) return null
    return Number.isInteger(d[0]) ? d[0] : this.pdf.getPageIndex(d[0])
  }

  /** A page's own shape, told to the surface. */
  shape(p, page) {
    const pg = this.pages[p]
    const { width, height } = page.getViewport({ scale: 1 })
    pg.points = width
    const dpr = window.devicePixelRatio || 1
    return { aspect: width / height, w: width * CSS_PER_POINT * dpr, h: height * CSS_PER_POINT * dpr }
  }

  /** Every page's shape, the ones nearest `from` first, a few at a time so drawing isn't held up. */
  async measure(from) {
    const n = this.pages.length
    for (let k = 0, done = 0; k < n; k++) {
      for (const p of k ? [from + k, from - k] : [from]) {
        if (p < 0 || p >= n || this.pages[p].known) continue
        const page = await this.page(p).catch(() => null)
        if (this.closed) return
        if (!page) continue
        const s = this.shape(p, page)
        this.on.sized(p, s.aspect, s.w, s.h)
        if (++done % MEASURED_AT_ONCE === 0) await new Promise((r) => setTimeout(r))
      }
    }
  }

  want(p, long) {
    const a = this.pages[p].aspect
    return Math.min(Math.round(long), Math.floor(Math.sqrt(MAX_PIXELS * Math.max(a, 1 / a))))
  }

  // drawn for the size it shows at, so its pixels are the screen's: a canvas for another size is stretched, and text blurs
  enough(have, want) {
    return have === want
  }

  load(p, want) {
    let task = null
    let cancelled = false
    const done = (async () => {
      const page = await this.page(p)
      if (cancelled) throw new Error('cancelled')
      const shape = this.shape(p, page)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: want / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      const matrix = this.colours && getPageColorMatrix(this.colours)
      const ops = matrix && getRenderOperatorList(page, task)
      try {
        await task.promise
      } catch (e) {
        canvas.width = canvas.height = 0
        throw e
      }
      if (matrix) applyPageColors(canvas, matrix, getKeptImageRects(ops ? getImageRects(ops, viewport.transform) : [], canvas.width, canvas.height))
      const el = document.createElement('div')
      el.className = 'pdf-page'
      el.append(canvas)
      return { el, bytes: canvas.width * canvas.height * 4, ...shape }
    })()
    return { done, cancel: () => ((cancelled = true), task?.cancel()) }
  }

  fit(p, el, w) {
    // the text and link layers are laid out in the page's points times this
    el.style.setProperty('--total-scale-factor', String(w / this.pages[p].points))
  }

  /** The page's text, to select and to mark what a search found, and its links. */
  async settle(p, el) {
    if (this.layers.has(el)) return
    const layer = { text: document.createElement('div'), links: document.createElement('div'), divs: [] }
    this.layers.set(el, layer)
    layer.text.className = 'textLayer'
    layer.links.className = 'annotationLayer'
    try {
      const page = await this.page(p)
      const viewport = page.getViewport({ scale: 1 })
      const text = new globalThis.pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: layer.text, viewport })
      await text.render()
      if (this.layers.get(el) !== layer) return
      layer.divs = text.textDivs
      // a selection dragged past the last line ends there, as pdf.js's own viewer has it
      const end = document.createElement('div')
      end.className = 'endOfContent'
      layer.text.append(end)
      el.append(layer.text, layer.links)
      layer.page = p
      this.paint(p, layer)
      this.on.live(p)
      await new globalThis.pdfjsLib.AnnotationLayer({ page, viewport, div: layer.links, linkService: this.links }).render({ annotations: await page.getAnnotations() })
    } catch {
      // a page without its text or links still shows
    }
  }

  unsettle(p, el) {
    const layer = this.layers.get(el)
    if (!layer) return
    this.layers.delete(el)
    layer.text.remove()
    layer.links.remove()
    this.paint(p, null)
  }

  free(p, el) {
    this.unsettle(p, el)
    const canvas = el.querySelector('canvas')
    if (canvas) canvas.width = canvas.height = 0
    // what pdf.js keeps of a page to draw it again goes with it
    this.page(p).then((page) => !this.closed && page.cleanup(), () => {})
  }

  selected() {
    return String(getSelection() || '').trim()
  }

  // search: the pages' text as pdf.js cuts it, results by page, marked in the pages in view
  async *find(query) {
    const { search } = await import('../../vendor/foliate-js/search.js')
    const n = this.pages.length
    for (let p = 0; p < n; p++) {
      const { strs, at } = await this.text(p).catch(() => ({ strs: [], at: [] }))
      if (this.closed) return
      if (p % 8 === 7 || p === n - 1) yield { progress: (p + 1) / n }
      const found = [...search(strs, query, { mode: 'contains', granularity: 'grapheme', sensitivity: 'base', locales: 'en' })]
      if (!found.length) continue
      // an end on a line's break moves to the text beside it
      const start = (i, o) => {
        while (i < at.length - 1 && at[i] < 0) [i, o] = [i + 1, 0]
        return [at[i], o]
      }
      const end = (i, o) => {
        while (i > 0 && at[i] < 0) [i, o] = [i - 1, strs[i - 1].length]
        return [at[i], o]
      }
      this.hits.set(p, found.map(({ range: r }) => ({ from: start(r.startIndex, r.startOffset), to: end(r.endIndex, r.endOffset) })))
      const layer = [...this.layers.values()].find((l) => l.page === p)
      if (layer) this.paint(p, layer)
      yield { page: p, items: found.map((f, k) => ({ k, excerpt: f.excerpt })) }
    }
  }

  clearFound() {
    this.hits.clear()
    this.painted.clear()
    this.hitAt = null
    globalThis.CSS?.highlights?.delete(FOUND)
    globalThis.CSS?.highlights?.delete(FOUND_AT)
  }

  /** A page's text came into view, or left it: what the search found there is marked, or its marks go. */
  paint(p, layer) {
    if (!globalThis.CSS?.highlights) return
    const ranges = []
    for (const h of (layer && this.hits.get(p)) || []) {
      const [a, b] = [layer.divs[h.from[0]]?.firstChild, layer.divs[h.to[0]]?.firstChild]
      const r = document.createRange()
      try {
        r.setStart(a, Math.min(h.from[1], a.length))
        r.setEnd(b, Math.min(h.to[1], b.length))
        ranges.push(r)
      } catch {
        // a piece the layer cut otherwise than the text: kept as a gap so the results keep their numbers
        ranges.push(null)
      }
    }
    if (ranges.length) this.painted.set(p, ranges)
    else this.painted.delete(p)
    const all = [...this.painted.values()].flat().filter(Boolean)
    if (all.length) CSS.highlights.set(FOUND, new Highlight(...all))
    else CSS.highlights.delete(FOUND)
  }

  /** One result stands out; answers where it is in the window, once its page's text is in view. */
  showHit(p, k) {
    this.hitAt = { p, k }
    if (!globalThis.CSS?.highlights) return null
    const r = this.painted.get(p)?.[k]
    if (!r) return CSS.highlights.delete(FOUND_AT), null
    CSS.highlights.set(FOUND_AT, new Highlight(r))
    return r.getBoundingClientRect()
  }

  /** A page's text as pdf.js cuts it, with a space where a line ends so words on two lines stay apart: `strs` to search, and for each the text layer's piece it is (`at`, -1 for a line's end). */
  async text(p) {
    const page = await this.page(p)
    const { items } = await page.getTextContent()
    const strs = []
    const at = []
    let i = 0
    for (const it of items) {
      if (it.str === undefined) continue
      strs.push(it.str)
      at.push(i++)
      if (it.hasEOL) {
        strs.push(' ')
        at.push(-1)
      }
    }
    return { strs, at }
  }

  /** A page drawn small, for the grid and the side strip. */
  async urlOf(p, size) {
    size = size || 1024
    const had = this.thumbs.get(p)
    if (had && had.size >= size) return had.url
    const url = URL.createObjectURL(await this.book.getPageThumbnail(p, size))
    if (had) URL.revokeObjectURL(had.url)
    this.thumbs.set(p, { url, size })
    return url
  }
}
