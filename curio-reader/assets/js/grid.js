// The pages of an archive as thumbnails, in cells, justified rows or columns, as Curio's own grid lays items out: for galleries more than for reading.
// Only the cells near the view are in the page, each asked for at the size it shows at, nearest first; the pictures far away are let go.
import { thumbs, sizeToAsk } from './layout.js'

const AT_ONCE = 6
const MOUNTED_SCREENS = 1.5
const KEPT_SCREENS = 5
const SIZE_MIN = 96
const SIZE_MAX = 720
const GAP = 8
// as the reading view: this much Ctrl + wheel doubles the size
const WHEEL_DOUBLING = 500

export class Grid {
  /** `pictures` gives the pages and their addresses; `onOpen(page)` reads from a page, `onMenu(page, selected)` asks for its menu, `onSelect(count)` hears the selection change, `onSized(size)` a size set with Ctrl + wheel. */
  constructor(host, { pictures, onOpen, onMenu, onSelect, onSized }) {
    this.pictures = pictures
    this.onOpen = onOpen
    this.onSized = onSized
    this.onMenu = onMenu
    this.onSelect = onSelect
    this.view = document.createElement('div')
    this.view.className = 'grid'
    this.view.tabIndex = 0
    this.view.hidden = true
    this.strip = document.createElement('div')
    this.strip.className = 'strip'
    this.view.append(this.strip)
    host.append(this.view)
    this.style = 'grid'
    this.size = 200
    this.reset()
    this.view.addEventListener('scroll', () => this.queueDraw(), { passive: true })
    this.view.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    this.view.addEventListener('click', (e) => this.click(e))
    this.view.addEventListener('contextmenu', (e) => this.context(e))
    new ResizeObserver(() => this.shown && this.layout()).observe(this.view)
  }

  reset() {
    for (const r of this.running?.values() || []) r.im.src = ''
    this.cells = new Map()
    this.loaded = new Map()
    this.running = new Map()
    this.selected = new Set()
    this.current = new Set()
    this.last = null
    this.strip.replaceChildren()
    this.box = null
  }

  get shown() {
    return !this.view.hidden
  }

  /** Shows the grid with `page` in view. */
  show(opts, page = 0) {
    this.style = opts.gridStyle || this.style
    this.size = opts.gridSize || this.size
    this.view.hidden = false
    this.layout()
    const y = this.box.y[page] ?? 0
    this.view.scrollTop = Math.max(0, y - (this.view.clientHeight - (this.box.h[page] || 0)) / 2)
    this.draw()
  }

  hide() {
    this.view.hidden = true
    for (const r of this.running.values()) r.im.src = ''
    this.running.clear()
  }

  /** The archive changed: nothing of the last one stays. */
  clear() {
    this.reset()
    this.view.hidden = true
  }

  set(opts) {
    this.style = opts.gridStyle || this.style
    this.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, opts.gridSize || this.size))
    if (this.shown) this.layout()
  }

  layout() {
    const top = this.view.scrollTop
    const ratio = this.box?.total ? top / this.box.total : 0
    this.box = thumbs(this.pictures.pages.map((p) => p.aspect), { width: this.view.clientWidth, size: this.size, gap: GAP, style: this.style })
    this.strip.style.height = `${this.box.total}px`
    for (const [p, el] of this.cells) this.position(p, el)
    if (this.box.total) this.view.scrollTop = ratio * this.box.total
    this.draw()
  }

  position(p, el) {
    const b = this.box
    Object.assign(el.style, { left: `${b.x[p]}px`, top: `${b.y[p]}px`, width: `${b.w[p]}px`, height: `${b.h[p]}px` })
  }

  queueDraw() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  /** The cells near the view in the page, their pictures asked for nearest first. */
  draw() {
    if (!this.box || !this.shown) return
    const H = this.view.clientHeight
    const top = this.view.scrollTop
    const from = top - H * MOUNTED_SCREENS
    const to = top + H * (1 + MOUNTED_SCREENS)
    const b = this.box
    const n = b.y.length
    const near = []
    for (let p = 0; p < n; p++) {
      const inside = b.y[p] + b.h[p] > from && b.y[p] < to
      let el = this.cells.get(p)
      if (!inside) {
        if (el) {
          el.remove()
          this.cells.delete(p)
        }
        continue
      }
      if (!el) {
        el = document.createElement('div')
        el.className = 'cell'
        el.dataset.page = p + 1
        el.classList.toggle('selected', this.selected.has(p))
        el.classList.toggle('marked', this.pictures.marks.has(p))
        el.classList.toggle('current', this.current.has(p))
        const im = this.loaded.get(p)?.im
        if (im) el.append(im)
        this.strip.append(el)
        this.cells.set(p, el)
      }
      this.position(p, el)
      near.push(p)
    }
    // pictures far from the view are let go
    const keepFrom = top - H * KEPT_SCREENS
    const keepTo = top + H * (1 + KEPT_SCREENS)
    for (const [p, l] of this.loaded) {
      if (b.y[p] + b.h[p] < keepFrom || b.y[p] > keepTo) {
        l.im.remove()
        l.im.src = ''
        this.loaded.delete(p)
      }
    }
    const mid = top + H / 2
    this.jobs = near.filter((p) => !this.enough(p)).sort((a, z) => Math.abs(b.y[a] - mid) - Math.abs(b.y[z] - mid))
    for (const [p, r] of this.running) {
      if (!this.cells.has(p)) {
        r.im.src = ''
        this.running.delete(p)
      }
    }
    this.pump()
  }

  wantOf(p) {
    const pg = this.pictures.pages[p]
    return sizeToAsk(Math.max(this.box.w[p], this.box.h[p]) * (window.devicePixelRatio || 1), Math.max(pg.w, pg.h), false)
  }

  enough(p) {
    const l = this.loaded.get(p)
    if (!l) return false
    const want = this.wantOf(p)
    return l.size === 0 || (want !== 0 && l.size >= want)
  }

  pump() {
    for (const p of this.jobs || []) {
      if (this.running.size >= AT_ONCE) break
      if (this.running.has(p)) continue
      this.load(p, this.wantOf(p))
    }
  }

  async load(p, size) {
    const run = { im: new Image() }
    this.running.set(p, run)
    let ok = true
    try {
      run.im.decoding = 'async'
      run.im.draggable = false
      run.im.src = await this.pictures.urlOf(p, size)
      await run.im.decode()
    } catch {
      ok = false
    }
    if (this.running.get(p) !== run) return
    this.running.delete(p)
    const el = this.cells.get(p)
    if (ok) {
      const old = this.loaded.get(p)?.im
      this.loaded.set(p, { im: run.im, size })
      if (old && old.isConnected) old.replaceWith(run.im)
      else el?.append(run.im)
    } else {
      el?.classList.add('failed')
    }
    this.jobs = (this.jobs || []).filter((j) => j !== p)
    this.pump()
  }

  /** The bookmarked pages changed. */
  marked() {
    for (const [p, el] of this.cells) el.classList.toggle('marked', this.pictures.marks.has(p))
  }

  /** The pages being read, outlined and scrolled into view when they are out of it. */
  showCurrent(pages) {
    this.current = new Set(pages)
    for (const [p, el] of this.cells) el.classList.toggle('current', this.current.has(p))
    const p = pages[0]
    if (!this.box || !this.shown || p == null) return
    const v = this.view
    const top = this.box.y[p]
    const bottom = this.box.y[pages[pages.length - 1]] + this.box.h[pages[pages.length - 1]]
    if (top < v.scrollTop || bottom > v.scrollTop + v.clientHeight) v.scrollTop = Math.max(0, top - (v.clientHeight - (bottom - top)) / 2)
  }

  pageOf(e) {
    const cell = e.target.closest?.('.cell')
    return cell ? Number(cell.dataset.page) - 1 : -1
  }

  select(p, { toggle = false, range = false } = {}) {
    if (range && this.last != null) {
      const [a, z] = this.last < p ? [this.last, p] : [p, this.last]
      for (let i = a; i <= z; i++) this.selected.add(i)
    } else if (toggle) {
      if (this.selected.has(p)) this.selected.delete(p)
      else this.selected.add(p)
      this.last = p
    } else {
      this.selected = new Set([p])
      this.last = p
    }
    for (const [i, el] of this.cells) el.classList.toggle('selected', this.selected.has(i))
    this.onSelect?.(this.selected.size)
  }

  clearSelection() {
    if (!this.selected.size) return false
    this.selected.clear()
    for (const el of this.cells.values()) el.classList.remove('selected')
    this.onSelect?.(0)
    return true
  }

  click(e) {
    const p = this.pageOf(e)
    if (p < 0) return
    if (e.ctrlKey || e.metaKey || e.shiftKey) this.select(p, { toggle: !e.shiftKey, range: e.shiftKey })
    else this.onOpen?.(p)
  }

  context(e) {
    e.preventDefault()
    const p = this.pageOf(e)
    if (p < 0) return
    if (!this.selected.has(p)) this.select(p)
    this.onMenu?.(p, [...this.selected].sort((a, z) => a - z))
  }

  /** Ctrl + wheel makes the thumbnails larger or smaller, keeping the page under the pointer in view. */
  wheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault()
    const was = this.size
    if (this.resize(this.size * 2 ** (-e.deltaY / WHEEL_DOUBLING)) !== was) this.onSized?.(this.size)
  }

  resize(size) {
    const next = Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, size)))
    if (next === this.size) return this.size
    this.size = next
    this.layout()
    return this.size
  }
}
