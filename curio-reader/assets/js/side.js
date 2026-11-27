// The side strip beside the pages: contents, bookmarks, every page small or a search, one tab at a time; the lists come from the reader, so either engine fills it.
// Places are told by key (a page for pictures, an href or CFI for books), with a label and the number shown beside it.
import { Grid } from './grid.js'
import { t } from './text.js'

const TABS = ['contents', 'bookmarks', 'pages', 'search']
export const SIDE_MIN = 180
export const SIDE_MAX = 560
// a search stops listing past this many results
const FOUND_MAX = 1000

const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {})

export class Side {
  /** `pictures` gives the Pages tab its pages; `on` hears go(key), menu(page, pages), toggle(), rename(key, label), remove(key), tab(name), resized(width), resizing(width), search(query) (an async iterable), stopSearch(). */
  constructor(host, { pictures, on }) {
    this.host = host
    this.on = on
    this.tab = 'pages'
    this.has = ['contents', 'bookmarks', 'pages']
    this.contents = []
    this.marks = []
    this.place = { contentsAt: -1, shown: new Set(), markText: '', pages: [] }
    this.tabs = el('div', 'tabs')
    this.tabs.setAttribute('role', 'tablist')
    this.panes = {}
    for (const id of TABS) {
      const b = el('button', 'tab')
      b.dataset.tab = id
      b.setAttribute('role', 'tab')
      b.addEventListener('click', () => this.show(id, true))
      this.tabs.append(b)
      this.panes[id] = el('div', 'pane')
      this.panes[id].dataset.pane = id
    }
    this.contentsList = el('div', 'places')
    this.panes.contents.append(this.contentsList)
    this.markButton = el('button', 'btn mark')
    this.markButton.addEventListener('click', () => this.on.toggle())
    this.marksList = el('div', 'places')
    const head = el('div', 'head')
    head.append(this.markButton)
    this.panes.bookmarks.append(head, this.marksList)
    this.grid = new Grid(this.panes.pages, { pictures, onOpen: (p) => this.on.go(p), onMenu: (p, pages) => this.on.menu(p, pages), onSelect: () => {} })
    this.query = el('input', 'grow')
    this.query.type = 'search'
    this.query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.search(this.query.value)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (this.query.value) this.search((this.query.value = ''))
        else this.query.blur()
      }
    })
    const find = el('div', 'head')
    find.append(this.query)
    this.found = el('div', 'places found')
    this.foundNote = el('p', 'faint empty')
    this.panes.search.append(find, this.foundNote, this.found)
    this.handle = el('div', 'resize')
    this.handle.addEventListener('pointerdown', (e) => this.drag(e))
    host.append(this.tabs, ...Object.values(this.panes), this.handle)
    host.addEventListener('contextmenu', (e) => e.target.closest('input') || e.preventDefault())
    this.words()
  }

  /** Its own words, again in another language. */
  words() {
    for (const b of this.tabs.children) b.textContent = t(`reader.side.${b.dataset.tab}`)
    this.query.placeholder = t('reader.search.placeholder')
    this.query.setAttribute('aria-label', t('reader.search.placeholder'))
    this.handle.title = t('reader.side.resize')
    if (this.open) this.show()
  }

  get open() {
    return !this.host.hidden
  }

  /** The tabs this engine has, in order. */
  setTabs(ids) {
    this.has = ids
    for (const b of this.tabs.children) b.hidden = !ids.includes(b.dataset.tab)
  }

  /** Opens the strip at a tab; the Contents tab only when there are any. */
  show(tab = this.tab, chosen = false) {
    if (!this.has.includes(tab) || (tab === 'contents' && !this.contents.length)) tab = this.has.find((x) => x !== 'contents') || 'bookmarks'
    this.tab = tab
    this.host.hidden = false
    this.tabs.querySelector('[data-tab=contents]').hidden = !this.contents.length || !this.has.includes('contents')
    for (const b of this.tabs.children) b.classList.toggle('on', b.dataset.tab === tab)
    for (const [id, p] of Object.entries(this.panes)) p.hidden = id !== tab
    if (tab === 'pages') this.grid.show({ gridStyle: 'masonry', gridSize: this.panes.pages.clientWidth }, this.place.pages[0] ?? 0)
    else this.grid.hide()
    this.grid.showCurrent(this.place.pages)
    this.drawContents()
    this.drawMarks()
    if (tab === 'search') this.query.focus()
    if (chosen) this.on.tab(tab)
  }

  hide() {
    this.host.hidden = true
    this.grid.hide()
  }

  /** What the Pages tab shows: the comic's pictures or a PDF's pages. */
  setPictures(pictures) {
    if (this.grid.pictures === pictures) return
    this.grid.pictures = pictures
    this.grid.clear()
  }

  /** Another item: its contents and bookmarks, nothing of the last. */
  load(contents, marks) {
    this.contents = contents
    this.marks = marks
    this.grid.clear()
    this.stopSearch()
    this.query.value = ''
    this.found.replaceChildren()
    this.foundNote.textContent = ''
    if (this.open) this.show()
  }

  setMarks(marks) {
    this.marks = marks
    this.grid.marked()
    if (this.open) this.drawMarks()
  }

  /** Where the reader is: the place in the contents, the bookmarks it shows, the bookmark button's words and, for pictures, the pages. */
  setPlace(place) {
    this.place = { contentsAt: -1, shown: new Set(), markText: '', pages: [], ...place }
    if (!this.open) return
    this.grid.showCurrent(this.place.pages)
    this.drawContents()
    this.drawMarks()
  }

  /** The width changed (the window, or the handle): the pages tab lays its pictures out again. */
  resized() {
    if (this.open && this.tab === 'pages') this.grid.set({ gridStyle: 'masonry', gridSize: this.panes.pages.clientWidth })
  }

  row(label, key, num, current) {
    const r = el('div', 'place')
    r.classList.toggle('current', current)
    r.append(el('span', 'label grow ellipsis', label), el('span', 'num faint', num ?? ''))
    r.title = label
    r.addEventListener('click', (e) => !e.target.closest('input, .x') && this.on.go(key))
    return r
  }

  drawContents() {
    if (this.tab !== 'contents') return
    const at = this.place.contentsAt
    const rows = this.contents.map((c, i) => {
      const r = this.row(c.label, c.key, c.num, i === at)
      if (c.depth) r.style.paddingInlineStart = `calc(${10 + c.depth * 14}px * var(--g))`
      return r
    })
    this.contentsList.replaceChildren(...rows)
    rows[at]?.scrollIntoView({ block: 'nearest' })
  }

  drawMarks() {
    if (this.tab !== 'bookmarks' || this.renaming) return
    this.markButton.textContent = this.place.markText
    if (!this.marks.length) {
      const k = this.on.keyOf
      this.marksList.replaceChildren(el('p', 'faint empty', k('bookmark') ? t('reader.marks.noneKey', { key: k('bookmark') }) : t('reader.marks.noneYet')))
      return
    }
    this.marksList.replaceChildren(...this.marks.map((b) => {
      const r = this.row(b.text, b.key, b.num, this.place.shown.has(b.key))
      const x = el('button', 'x', '×')
      x.setAttribute('aria-label', t('reader.marks.remove'))
      x.title = t('reader.marks.remove')
      x.addEventListener('click', () => this.on.remove(b.key))
      r.append(x)
      r.querySelector('.label').addEventListener('dblclick', (e) => this.rename(e.target, b))
      return r
    }))
  }

  /** A bookmark's name, edited in place: Enter keeps it, Escape doesn't, an empty one goes back to the place's own. */
  rename(span, b) {
    this.renaming = true
    const input = el('input', 'grow')
    input.value = b.label || b.text
    input.maxLength = 120
    span.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = (keep) => {
      if (done) return
      done = true
      this.renaming = false
      if (keep && input.value.trim() !== (b.label || b.text)) this.on.rename(b.key, input.value.trim())
      else this.drawMarks()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        finish(e.key === 'Enter')
      }
    })
    input.addEventListener('blur', () => finish(true))
  }

  /** Shows the search tab with `text` searched for. */
  find(text) {
    if (text != null) this.query.value = text
    this.show('search', true)
    if (text) this.search(text)
  }

  stopSearch() {
    this.searching = (this.searching || 0) + 1
    this.on.stopSearch?.()
  }

  /** Results as they come, under the chapter they are in; a new search or an empty one ends the last. */
  async search(text) {
    this.stopSearch()
    const run = this.searching
    this.found.replaceChildren()
    text = text.trim()
    if (!text) {
      this.foundNote.textContent = ''
      return
    }
    this.foundNote.textContent = t('reader.search.searching')
    let count = 0
    try {
      for await (const r of this.on.search(text)) {
        if (run !== this.searching) return
        if (r.progress != null) {
          const percent = Math.round(r.progress * 100)
          this.foundNote.textContent = count ? t('reader.search.progressFound', { percent, count: count.toLocaleString() }, count) : t('reader.search.progress', { percent })
          continue
        }
        if (!r.items?.length) continue
        if (r.label) this.found.append(el('div', 'group faint', r.label))
        for (const it of r.items) {
          if (count >= FOUND_MAX) break
          const row = el('div', 'place hit')
          const ex = it.excerpt || {}
          row.append(document.createTextNode(ex.pre || ''), el('mark', '', ex.match || ''), document.createTextNode(ex.post || ''))
          row.addEventListener('click', () => {
            for (const x of this.found.querySelectorAll('.current')) x.classList.remove('current')
            row.classList.add('current')
            this.on.go(it.key)
          })
          this.found.append(row)
          count++
        }
      }
    } catch (e) {
      if (run === this.searching) this.foundNote.textContent = t('reader.search.failed', { error: e.message || e })
      return
    }
    if (run !== this.searching) return
    this.foundNote.textContent = !count ? t('reader.search.none') : count >= FOUND_MAX ? t('reader.search.foundMore', { count: count.toLocaleString() }) : t('reader.search.found', { count: count.toLocaleString() }, count)
  }

  /** Dragging the inner edge; the width is told as it changes and kept once it is let go. */
  drag(e) {
    e.preventDefault()
    const start = { x: e.clientX, w: this.host.offsetWidth }
    const flip = document.body.classList.contains('side-right') ? -1 : 1
    let w = start.w
    const move = (ev) => {
      w = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, start.w + flip * (ev.clientX - start.x))))
      this.on.resizing(w)
    }
    const up = () => {
      this.handle.releasePointerCapture?.(e.pointerId)
      this.handle.removeEventListener('pointermove', move)
      this.handle.removeEventListener('pointerup', up)
      this.handle.removeEventListener('pointercancel', up)
      if (w !== start.w) this.on.resized(w)
    }
    this.handle.setPointerCapture?.(e.pointerId)
    this.handle.addEventListener('pointermove', move)
    this.handle.addEventListener('pointerup', up)
    this.handle.addEventListener('pointercancel', up)
  }
}
