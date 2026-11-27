// The reading surface: pages in one scrolling view, a spread at a time or as a column, laid out from their shapes before any is filled.
// It knows no format. A source says what the pages are and fills them:
//   pages          [{ aspect, known, w, h, side }]: each page's shape, its size in its own pixels where known, whether the shape is the real one yet, and the side of a spread it asks for ('left', 'right', 'center') where it does
//   marks          a Set of the bookmarked pages
//   want(p, long)  what to ask for a page shown `long` device pixels along its longer edge: a number, more for sharper, Infinity for the page as it is
//   load(p, want)  { done, cancel() }; `done` answers { el, bytes, aspect, w, h } (the last three where the load found the page's real shape)
//   free(p, el)    lets a filled page's element go
// and, where it has them:
//   enough(have, want)   whether what a page is filled with will do for what is wanted now (without it: anything as sharp or sharper)
//   fit(p, el, w, h)     a filled page's box is this size now, in CSS pixels
//   settle(p, el)        the page is at rest in view: what is costly and only matters there (text to select, links)
//   unsettle(p, el)      the page left the view
//   ahead, behind        spreads filled ahead of the one read and kept behind it
//   pairsWide            wide pages pair into spreads too (a book laid out so), where a comic's wide page is a spread already
//   near                 paged, spreads either side of the one shown that stay in the page unseen, for pages that only load there (frames)
// The surface decides which pages are filled, the ones needed soonest first, a few at once, and lets them go again past a memory budget, furthest first.
import { WheelTurns } from './wheel.js'
import { spreads, spreadOfPage, column, pageWidth, rowAt, rowsIn, pageAnchor, scrollForPage } from './layout.js'

const AT_ONCE = 4
// spreads loaded ahead of the one read, and kept behind it
const AHEAD = 8
const BEHIND = 3
// a column keeps the rows within this many screens in the page
const MOUNTED_SCREENS = 2
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8
// sharper pages are asked for once zooming stops this long
const SETTLE_MS = 160
// a zoom that starts asks at once for the pages in view at twice the size it needs yet, so they are on their way while it goes on
const ZOOM_LEAD = 2
// as in Curio's viewer: this much wheel or this many pixels of a right-button drag doubles the size
const WHEEL_DOUBLING = 500
const DRAG_DOUBLING_PX = 160
// text to select and links in a filled page take the pointer themselves; anywhere else a drag pans and a click turns the page
const OWN_POINTER = '.textLayer :is(span, br), .annotationLayer a'

export class Surface {
  /** `host` is an element the surface adds its view to; `onPlace` hears where the reader is ({ page, pages, count }), `onMenu(page)` a right-click on a page, `onZoom()` the zoom changing. */
  constructor(host, { onPlace, onMenu, onZoom }) {
    this.onPlace = onPlace
    this.onMenu = onMenu
    this.onZoom = onZoom
    this.view = document.createElement('div')
    this.view.className = 'surface'
    this.view.tabIndex = 0
    this.strip = document.createElement('div')
    this.strip.className = 'strip'
    this.view.append(this.strip)
    host.append(this.view)
    this.opts = { double: false, cover: true, continuous: false, rtl: false, fit: 'page', gap: 12, pageWidth: 100, budget: 512 << 20, wheelTurns: true, enlarge: true }
    this.wheelTurns = new WheelTurns()
    this.reset()
    this.view.addEventListener('scroll', () => this.scrolled(), { passive: true })
    this.view.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    this.view.addEventListener('pointerdown', (e) => this.down(e))
    this.view.addEventListener('contextmenu', (e) => e.preventDefault())
    this.view.addEventListener('dblclick', (e) => e.target.closest?.(OWN_POINTER) || this.setZoom(1))
    new ResizeObserver(() => this.relayout()).observe(this.view)
  }

  reset() {
    for (const r of this.running?.values() || []) r.job.cancel()
    for (const [p, slot] of this.slots || []) if (slot.el) this.source.free?.(p, slot.el)
    this.source = null
    this.zoom = 1
    this.current = 0
    this.groups = []
    this.rows = new Map()
    this.slots = new Map()
    this.running = new Map()
    this.jobs = []
    this.bytes = 0
    this.inView = null
    clearTimeout(this.settling)
    cancelAnimationFrame(this.resizing)
    this.resizing = 0
    this.epoch = (this.epoch || 0) + 1
    this.strip.replaceChildren()
  }

  /** Shows a source's pages from `page` on. */
  open(source, opts, page = 0) {
    this.reset()
    this.source = source
    Object.assign(this.opts, opts)
    this.build()
    this.goTo(page)
  }

  close() {
    this.reset()
  }

  /** Changes how pages are shown, keeping the page read in view. */
  set(opts) {
    const page = this.page()
    Object.assign(this.opts, opts)
    this.build()
    this.goTo(page)
  }

  get pages() {
    return this.source?.pages || []
  }

  get count() {
    return this.pages.length
  }

  /** The first page of the spread read now. */
  page() {
    return this.groups[this.current]?.[0] ?? 0
  }

  group() {
    const o = this.opts
    this.groups = spreads(this.pages.map((p) => p.aspect), { double: o.double, cover: o.cover, rtl: o.rtl, wideAlone: !this.source.pairsWide, sides: this.pages.some((p) => p.side) ? this.pages.map((p) => p.side) : null })
    this.spreadAt = spreadOfPage(this.groups, this.pages.length)
  }

  build() {
    this.clearRows()
    this.group()
    this.view.classList.toggle('continuous', this.opts.continuous)
    this.view.classList.toggle('rtl', this.opts.rtl)
    this.measure()
  }

  /** Sizes of every row for the view as it is now. */
  measure() {
    const o = this.opts
    this.W = this.view.clientWidth || 1
    this.H = this.view.clientHeight || 1
    const gap = o.continuous ? o.gap : 0
    // pages kept at their own size: a page's pixel to a pixel of the screen, where its size is known
    const dpr = window.devicePixelRatio || 1
    const caps = o.enlarge ? null : this.groups.map((g) => (g.every((p) => this.pages[p].h) ? Math.max(...g.map((p) => this.pages[p].h)) / dpr : Infinity))
    // in a column every page is as wide as the others; the page width is a share of the view's
    const share = Math.min(100, Math.max(10, o.pageWidth || 100)) / 100
    this.col = column(this.groups, this.pages.map((p) => p.aspect), { width: Math.floor(this.W * share), height: this.H, fit: o.continuous ? 'width' : o.fit, gap, zoom: this.zoom, caps })
    if (o.continuous) {
      this.stripW = Math.max(this.W, this.col.widest)
      this.stripH = this.col.total
    }
    this.strip.style.width = `${this.stripW || this.W}px`
  }

  // rows stay in the page while their pages are the same: an element taken out and put back loads again where it is a frame
  clearRows() {
    for (const el of this.rows.values()) el.remove()
    this.rows.clear()
  }

  /** A page's real shape, found apart from filling it; many may come at once, so they are laid out together. */
  sized(p, aspect, w = 0, h = 0) {
    const pg = this.pages[p]
    if (!pg) return
    const same = Math.abs(pg.aspect - aspect) < 1e-3
    const capped = !this.opts.enlarge && pg.h !== h
    Object.assign(pg, { known: true, w, h }, same ? {} : { aspect })
    if ((same && !capped) || this.resizing) return
    this.resizing = requestAnimationFrame(() => {
      this.resizing = 0
      this.relayout(true)
    })
  }

  /** Every page filled again, as what fills them changed (a PDF's colours). */
  refill() {
    for (const r of this.running.values()) r.job.cancel()
    this.running.clear()
    for (const [p, slot] of this.slots) if (slot.el) this.source.free?.(p, slot.el)
    this.slots.clear()
    this.bytes = 0
    this.relayout()
  }

  /** Lays the pages out again (the view's size, a page's real shape, the zoom), keeping the place; `regroup` when shapes changed, which can pair pages into other spreads. */
  relayout(regroup = false) {
    // hidden behind the grid, the view has no size to lay out for
    if (!this.pages.length || this.view.hidden) return
    const page = this.page()
    const anchor = this.opts.continuous ? pageAnchor(this.col, this.groups, this.view.scrollTop) : null
    if (regroup) {
      this.clearRows()
      this.group()
      this.current = this.spreadAt[page] ?? 0
    }
    this.measure()
    if (anchor) {
      this.strip.style.height = `${this.stripH}px`
      this.view.scrollTop = scrollForPage(this.col, this.spreadAt, anchor)
      this.draw()
    } else {
      this.showSpread(this.current, { keepScroll: true })
    }
    this.schedule()
  }

  goTo(page) {
    const s = this.spreadAt[Math.max(0, Math.min(page, this.pages.length - 1))] ?? 0
    if (this.opts.continuous) {
      this.strip.style.height = `${this.stripH}px`
      this.current = s
      this.view.scrollTop = this.col.tops[s] - (this.opts.gap || 0)
      this.view.scrollLeft = (this.stripW - this.W) / 2
      this.draw()
      this.schedule()
      this.told()
    } else {
      this.showSpread(s)
    }
  }

  /** The source's bookmarks changed: their ribbons follow. */
  marked() {
    for (const pg of this.strip.querySelectorAll('.pg')) pg.classList.toggle('marked', this.source.marks.has(Number(pg.dataset.page) - 1))
  }

  /** Paged: one spread, centred in the view when it is smaller, scrolled to its start (or its end, going back). */
  showSpread(s, { atEnd = false, keepScroll = false } = {}) {
    s = Math.max(0, Math.min(s, this.groups.length - 1))
    const changed = s !== this.current
    this.current = s
    const w = this.col.widths[s] || 0
    const h = this.col.heights[s] || 0
    this.stripW = Math.max(this.W, w)
    this.stripH = Math.max(this.H, h)
    this.strip.style.width = `${this.stripW}px`
    this.strip.style.height = `${this.stripH}px`
    const near = this.source.near || 0
    for (const [r, el] of this.rows) {
      if (Math.abs(r - s) > near) {
        el.remove()
        this.rows.delete(r)
      }
    }
    for (let r = Math.max(0, s - near); r <= Math.min(this.groups.length - 1, s + near); r++) {
      if (r === s) continue
      // in the page so it loads, where the spread shown is, unseen until it is turned to
      this.place(r, (this.stripW - this.col.widths[r]) / 2, 0)
      this.rows.get(r).classList.add('waiting')
    }
    this.place(s, (this.stripW - w) / 2, (this.stripH - h) / 2)
    this.rows.get(s).classList.remove('waiting')
    if (!keepScroll || changed) {
      this.view.scrollTop = atEnd ? this.stripH : 0
      this.view.scrollLeft = (this.stripW - this.W) / 2
    }
    this.schedule()
    this.told()
  }

  told() {
    const g = this.groups[this.current] || []
    this.onPlace?.({ page: g[0] ?? 0, pages: g, count: this.pages.length })
  }

  /** A row in the page at `left`, `top`, with an element for each of its pages and what fills them where loaded. */
  place(s, left, top) {
    let el = this.rows.get(s)
    if (!el) {
      el = document.createElement('div')
      // not `row`, which the kit lays out with a gap
      el.className = 'spread'
      for (const p of this.groups[s]) {
        const pg = document.createElement('div')
        pg.className = 'pg'
        pg.dataset.page = p + 1
        if (this.source.marks.has(p)) pg.classList.add('marked')
        const slot = this.slots.get(p)
        if (slot?.el) pg.append(slot.el)
        if (slot?.failed) pg.classList.add('failed')
        el.append(pg)
      }
      this.strip.append(el)
      this.rows.set(s, el)
    }
    const h = this.col.heights[s]
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${this.col.widths[s]}px`, height: `${h}px` })
    el.querySelectorAll('.pg').forEach((pg, i) => {
      const p = this.groups[s][i]
      const w = pageWidth(h, this.pages[p].aspect)
      pg.style.width = `${w}px`
      const filled = this.slots.get(p)?.el
      if (filled) this.source.fit?.(p, filled, w, h)
    })
  }

  /** A column: only the rows near the view are in the page. */
  draw() {
    if (!this.opts.continuous) return
    const top = this.view.scrollTop
    const [first, last] = rowsIn(this.col, top - this.H * MOUNTED_SCREENS, top + this.H * (MOUNTED_SCREENS + 1))
    for (const [r, el] of this.rows) {
      if (r < first || r > last) {
        el.remove()
        this.rows.delete(r)
      }
    }
    for (let r = first; r <= last; r++) this.place(r, (this.stripW - this.col.widths[r]) / 2, this.col.tops[r])
  }

  scrolled() {
    if (!this.opts.continuous || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.source) return
      this.draw()
      const at = Math.max(0, rowAt(this.col, this.view.scrollTop + this.H / 3))
      if (at !== this.current) {
        this.current = at
        this.told()
      }
      this.schedule()
    })
  }

  /** What to load now: the pages in view, then those ahead in reading order, then those behind, each at the size it shows at. */
  schedule() {
    clearTimeout(this.settle)
    if (this.view.hidden || !this.source) return
    const dpr = window.devicePixelRatio || 1
    const want = []
    const add = (s, rank) => {
      if (s < 0 || s >= this.groups.length) return
      const h = this.col.heights[s]
      const lead = rank === 0 ? this.lead || 1 : 1
      for (const p of this.groups[s]) want.push({ p, rank, want: this.source.want(p, Math.max(h, h * this.pages[p].aspect) * dpr * lead) })
    }
    let first = this.current
    let last = this.current
    if (this.opts.continuous) {
      ;[first, last] = rowsIn(this.col, this.view.scrollTop, this.view.scrollTop + this.H)
      if (last < first) [first, last] = [this.current, this.current]
    }
    for (let s = first; s <= last; s++) add(s, 0)
    for (let k = 1; k <= (this.source.ahead ?? AHEAD); k++) add(last + k, k)
    for (let k = 1; k <= (this.source.behind ?? BEHIND); k++) add(first - k, k + 0.5)
    this.jobs = want.filter((j) => !this.has(j.p, j.want)).sort((a, b) => a.rank - b.rank)
    const wanted = new Set(this.jobs.map((j) => j.p))
    for (const [p, r] of this.running) {
      if (!wanted.has(p)) {
        r.job.cancel()
        this.running.delete(p)
      }
    }
    this.keep = new Set(want.map((j) => j.p))
    // a larger picture already on its way serves: asking again for the smaller one would cancel it
    if (!this.source.enough) this.jobs = this.jobs.filter((j) => !(this.running.get(j.p)?.want >= j.want))
    this.pump()
    this.settleSoon(first, last)
  }

  has(p, want) {
    const slot = this.slots.get(p)
    if (!slot) return false
    return slot.failed || (this.source.enough ? this.source.enough(slot.want, want) : slot.want >= want)
  }

  /** Once things stop moving, the pages in view are settled and the others aren't. */
  settleSoon(first, last) {
    if (!this.source.settle) return
    this.inView = [first, last]
    clearTimeout(this.settling)
    this.settling = setTimeout(() => {
      if (!this.source) return
      const [a, b] = this.inView
      for (const [p, slot] of this.slots) {
        if (!slot.el) continue
        const s = this.spreadAt[p]
        if (s >= a && s <= b && this.rows.has(s)) this.source.settle(p, slot.el)
        else this.source.unsettle?.(p, slot.el)
      }
    }, SETTLE_MS)
  }

  pump() {
    for (const j of this.jobs) {
      if (this.running.size >= AT_ONCE) break
      const r = this.running.get(j.p)
      if (r && r.want === j.want) continue
      if (r) r.job.cancel()
      this.load(j.p, j.want)
    }
  }

  async load(p, want) {
    const run = { want, job: this.source.load(p, want) }
    this.running.set(p, run)
    const epoch = this.epoch
    const res = await run.job.done.catch(() => null)
    if (this.epoch !== epoch || this.running.get(p) !== run) return
    this.running.delete(p)
    if (res) this.put(p, res, want)
    else this.slots.set(p, { failed: true, want, bytes: 0 })
    this.jobs = this.jobs.filter((j) => j.p !== p || !this.has(p, j.want))
    this.pump()
  }

  /** What a load made takes its page's place, replacing a coarser one; a page whose shape wasn't known gets it now. */
  put(p, res, want) {
    const old = this.slots.get(p)
    this.bytes += res.bytes - (old?.bytes || 0)
    this.slots.set(p, { el: res.el, want, bytes: res.bytes })
    const pg = this.pages[p]
    if (!pg.known && res.aspect) {
      const same = Math.abs(pg.aspect - res.aspect) < 1e-3
      const capped = !this.opts.enlarge && !!res.h && pg.h !== res.h
      pg.known = true
      if (!same) pg.aspect = res.aspect
      if (res.w && res.h) [pg.w, pg.h] = [res.w, res.h]
      if (!same || capped) this.relayout(true)
    }
    const el = this.rows.get(this.spreadAt[p])
    const holder = el?.querySelectorAll('.pg')[this.groups[this.spreadAt[p]].indexOf(p)]
    if (holder) {
      holder.classList.remove('failed')
      if (old?.el && old.el !== res.el && old.el.isConnected) old.el.replaceWith(res.el)
      else if (!res.el.isConnected) holder.append(res.el)
      this.source.fit?.(p, res.el, holder.offsetWidth, holder.offsetHeight)
      if (this.inView) this.settleSoon(...this.inView)
    }
    if (old?.el && old.el !== res.el) {
      old.el.remove()
      this.source.free?.(p, old.el)
    }
    this.trim()
  }

  /** Past the budget, the pages furthest from the one read go, keeping those wanted now. */
  trim() {
    if (this.bytes <= this.opts.budget) return
    const far = [...this.slots.keys()].filter((p) => !this.keep?.has(p)).sort((a, b) => Math.abs(this.spreadAt[b] - this.current) - Math.abs(this.spreadAt[a] - this.current))
    for (const p of far) {
      if (this.bytes <= this.opts.budget) break
      const slot = this.slots.get(p)
      this.bytes -= slot.bytes
      if (slot.el) {
        slot.el.remove()
        this.source.free?.(p, slot.el)
      }
      this.slots.delete(p)
    }
  }

  /** Next or previous in reading order: in a column a screen, paged the rest of a tall spread and then the next one. Answers whether it moved. */
  next(dir = 1) {
    const v = this.view
    const room = dir > 0 ? v.scrollHeight - v.clientHeight - v.scrollTop : v.scrollTop
    if (room > 2) {
      v.scrollTop += dir * Math.min(room, this.H * 0.9)
      return true
    }
    if (this.opts.continuous) return false
    return this.turn(dir, { atEnd: dir < 0 })
  }

  /** The next or previous spread, at once. */
  turn(dir, opts) {
    const s = this.current + dir
    if (s < 0 || s >= this.groups.length) return false
    if (this.opts.continuous) {
      this.view.scrollTop = this.col.tops[s] - this.opts.gap
      return true
    }
    this.showSpread(s, opts)
    return true
  }

  atEdge(dir) {
    const v = this.view
    const room = dir > 0 ? v.scrollHeight - v.clientHeight - v.scrollTop : v.scrollTop
    if (room > 2) return false
    return this.opts.continuous || (dir > 0 ? this.current >= this.groups.length - 1 : this.current <= 0)
  }

  /** Zoom to `z` times the fitted size, keeping the point under (`x`, `y`) in the view where it is. */
  setZoom(z, x = this.W / 2, y = this.H / 2) {
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
    if (z === this.zoom || !this.source) return
    const v = this.view
    const fx = (v.scrollLeft + x) / (this.stripW || 1)
    const fy = (v.scrollTop + y) / (this.stripH || 1)
    const growing = z > this.zoom
    this.zoom = z
    const anchor = this.opts.continuous ? null : this.current
    this.measure()
    if (anchor === null) {
      this.strip.style.height = `${this.stripH}px`
      this.draw()
    } else {
      this.showSpread(anchor, { keepScroll: true })
    }
    v.scrollLeft = fx * this.stripW - x
    v.scrollTop = fy * this.stripH - y
    this.draw()
    // pages a source draws itself (a PDF's) wait for the zoom to stop: drawing them twice as large costs more than it saves
    if (growing && !this.lead && !this.source.enough) {
      this.lead = ZOOM_LEAD
      this.schedule()
    }
    clearTimeout(this.settle)
    this.settle = setTimeout(() => {
      this.lead = 0
      this.schedule()
    }, SETTLE_MS)
    this.onZoom?.()
  }

  wheel(e) {
    // zoomed in, the wheel does what it does over a picture in Curio's viewer (Settings › Controls; an older Curio doesn't say, and nothing changes)
    const curio = this.zoom > 1 ? document.documentElement.dataset.curioWheel : null
    if (e.ctrlKey || (curio === 'zoom' && !e.shiftKey)) {
      e.preventDefault()
      const r = this.view.getBoundingClientRect()
      this.setZoom(this.zoom * 2 ** (-e.deltaY / WHEEL_DOUBLING), e.clientX - r.left, e.clientY - r.top)
      return
    }
    if (curio === 'scroll' || this.opts.continuous || !this.opts.wheelTurns || e.shiftKey) return
    const dir = Math.sign(e.deltaY)
    // a tall page scrolls first and turns at its edge; a page zoomed in turns at once, as Curio's viewer steps to the next picture
    if (!dir || (curio !== 'navigate' && !this.atScrollEdge(dir))) return this.wheelTurns.reset()
    e.preventDefault()
    this.wheelTurns.feed(e, (d) => this.turn(d, { atEnd: d < 0 }), this.H)
  }

  atScrollEdge(dir) {
    const v = this.view
    return dir > 0 ? v.scrollTop + v.clientHeight >= v.scrollHeight - 2 : v.scrollTop <= 0
  }

  /** Left button: drag to pan, click a half to turn (paged); right button: drag up and down to zoom about where it started. */
  down(e) {
    if (e.button !== 0 && e.button !== 2) return
    if (e.button === 0 && e.target.closest?.(OWN_POINTER)) return
    const v = this.view
    const r = v.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop, zoom: this.zoom }
    let moved = false
    const move = (ev) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved && Math.hypot(dx, dy) < 5) return
      moved = true
      if (e.button === 2) {
        this.setZoom(start.zoom * 2 ** (-dy / DRAG_DOUBLING_PX), start.x - r.left, start.y - r.top)
      } else {
        v.scrollLeft = start.left - dx
        v.scrollTop = start.top - dy
      }
    }
    const up = (ev) => {
      v.releasePointerCapture?.(ev.pointerId)
      v.removeEventListener('pointermove', move)
      v.removeEventListener('pointerup', up)
      v.removeEventListener('pointercancel', up)
      v.classList.remove('dragging')
      if (!moved && e.button === 2) {
        // the view holds the pointer while a button is down, so the page is found where it was let go
        const pg = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pg')
        if (pg) this.onMenu?.(Number(pg.dataset.page) - 1)
      }
      if (!moved && e.button === 0 && !this.opts.continuous) {
        const left = ev.clientX - r.left < r.width / 2
        this.turn(left !== this.opts.rtl ? -1 : 1)
      }
    }
    v.setPointerCapture?.(e.pointerId)
    v.classList.add('dragging')
    v.addEventListener('pointermove', move)
    v.addEventListener('pointerup', up)
    v.addEventListener('pointercancel', up)
  }
}
