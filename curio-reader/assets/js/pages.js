// A reading made of pages (a comic's pictures, a PDF's pages): they are on the surface or shown as a grid, with bookmarks by page, and the toolbar, keys and menus for them.
// comic.js and fixedbook.js open their files into it and add what is their own.
import { Surface } from './surface.js'
import { Grid } from './grid.js'
import { cleanMarks, toggleMark, nextMark, markLabel, noMarks, placeAt } from './places.js'
import { DEFAULTS } from './defaults.js'
import { rememberedChanges } from './remember.js'
import { t, tc } from './text.js'

// choices an archive keeps for itself from the look panel, and settings it changes for every one
const OWN_VALUES = ['pageWidth', 'cover', 'enlarge']
const SETTING_VALUES = ['wheelTurns']
const FITS = ['page', 'width', 'height']
// set from the layout panel as from their buttons and keys
const LAYOUT_CHOICES = ['double', 'continuous', 'rtl', 'fit']
const fitName = (f) => t(`reader.fits.${f}`)
// the Layout choice, as books have it too
export const layoutOptions = () => ['single', 'double', 'continuous'].map((value) => ({ value, label: t(`reader.layouts.${value}`) }))
const directions = () => [{ value: 'ltr', label: t('reader.directions.ltr'), icon: 'text-direction-ltr' }, { value: 'rtl', label: t('reader.directions.rtl'), icon: 'text-direction-rtl' }]
const FIT_ICONS = { page: 'maximize', width: 'arrow-autofit-width', height: 'arrow-autofit-height' }
const GRID_STYLES = ['grid', 'justified', 'masonry']
const GRID_ICONS = { grid: 'layout-grid', justified: 'layout-rows', masonry: 'layout-dashboard' }
const SAVE_MS = 800
// a menu longer than this points to the side strip instead
const MENU_MARKS = 40
const MENU_PLACES = 200
const ZOOM_STEP = 1.25

export const toDataUrl = (blob) => new Promise((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(r.result)
  r.onerror = () => fail(r.error)
  r.readAsDataURL(blob)
})

export class PagesReading {
  /** `host` is the reader's page area; `shell` is the reader's (reader.js). */
  constructor(host, shell) {
    this.shell = shell
    this.curio = shell.curio
    this.surface = new Surface(host, { onPlace: (p) => this.onPlace(p), onMenu: (p) => this.menu(p, [p]), onZoom: () => this.tools() })
    this.surface.view.hidden = true
    this.grid = new Grid(host, { pictures: null, onOpen: (p) => this.read(p), onMenu: (p, pages) => this.menu(p, pages), onSelect: (n) => ((this.selectedCount = n), this.tools()), onSized: (size) => this.sized(size) })
    this.reset()
  }

  reset() {
    this.item = null
    this.source = null
    // what the file says of itself (a manga, a long strip), then the user's own choices for it
    this.found = {}
    this.own = {}
    this.ownWas = {}
    this.place = { page: 0, pages: [0], count: 0 }
    this.selectedCount = 0
    // bookmarks in page order ({ page, at, label? }), and the places the file names ({ page, label, depth? })
    this.marks = []
    this.contents = []
    // opening on a page isn't reading it; turning one is
    this.firstPage = null
    this.unsaved = null
  }

  get shown() {
    return !!this.item
  }

  get count() {
    return this.source?.pages.length || 0
  }

  /** The side strip stands beside the pages while reading, not over the grid, which shows every page already. */
  get sideable() {
    return this.count > 0 && !this.grid.shown
  }

  firstTab() {
    return this.contents.length ? 'contents' : 'pages'
  }

  /** Every page small, as a grid and in the side strip: where the source can draw them so. */
  get hasGrid() {
    return !!this.source?.urlOf
  }

  /** The settings as this kind of file starts with them. */
  defaults(s) {
    return s
  }

  /** Which kind of file this is, for the choices its kind remembers (reader.js `remember`). */
  get kind() {
    return 'comic'
  }

  view_() {
    const s = { ...this.defaults(this.shell.settings()), ...this.shell.remembered(this.kind) }
    const budget = Math.max(64, s.budgetMB) << 20
    delete s.budgetMB
    const v = { ...s, ...this.found, ...this.own, budget }
    if (this.source && !this.hasGrid) v.grid = false
    return v
  }

  /** The end of opening: a source's pages on the surface from the kept page, or as a grid, with the kept bookmarks and choices. */
  begin(source, kept) {
    this.source = source
    this.marks = cleanMarks(kept.bookmarks, source.pages.length)
    this.own = kept.view || {}
    this.ownWas = { ...this.own }
    const start = Math.min(Math.max(0, kept.page || 0), source.pages.length - 1)
    source.marks = new Set(this.marks.map((b) => b.page))
    this.grid.pictures = source
    this.grid.clear()
    if (source.urlOf) this.shell.side.setPictures(source)
    this.shell.say('')
    const v = this.view_()
    this.surface.view.hidden = !!v.grid
    this.surface.open(source, v, start)
    this.shell.side.load(this.sideContents(), this.labelled())
    if (v.grid) this.showGrid(start)
    else this.surface.view.focus({ preventScroll: true })
    return start
  }

  close() {
    this.token = {}
    this.save()
    this.surface.close()
    this.surface.view.hidden = true
    this.grid.clear()
    this.reset()
  }

  showGrid(page) {
    this.surface.view.hidden = true
    this.grid.show(this.view_(), page)
    this.shell.layoutSide()
    this.grid.view.focus({ preventScroll: true })
    this.tools()
  }

  /** From the grid, reading from a page; `chosen` by the Page grid button, which the next file of its kind follows. */
  read(page, chosen = false) {
    this.own.grid = false
    // opening a page isn't choosing to read the next file of its kind as pages: the Page grid button is, turned on or off
    if (!chosen) this.ownWas.grid = false
    this.grid.hide()
    this.surface.view.hidden = false
    this.shell.layoutSide()
    this.surface.set(this.view_())
    this.surface.goTo(page)
    this.surface.view.focus({ preventScroll: true })
    this.tools()
    this.saveSoon(true)
  }

  onPlace(p) {
    this.place = p
    this.showPlace()
    this.saveSoon()
    this.noteProgress()
  }

  /** The toolbar and the side strip at the place shown. */
  showPlace() {
    const p = this.place
    this.tools()
    const shown = new Set(this.marks.filter((b) => p.pages.includes(b.page)).map((b) => b.page))
    this.shell.side.setPlace({ contentsAt: placeAt(this.contents, p.page), shown, markText: shown.size ? t('reader.marks.remove') : t('reader.marks.add'), pages: p.pages })
  }

  /** Its words again, in the language the window changed to. */
  languageChanged() {
    if (!this.item || !this.place?.count) return
    this.shell.side.setMarks(this.labelled())
    this.showPlace()
  }

  noteProgress() {
    const place = this.place
    if (!this.item || this.grid.shown || !place.count) return
    const last = place.pages[place.pages.length - 1]
    if (this.firstPage == null) this.firstPage = place.page
    this.shell.readState.note(this.item.id, { moved: place.page !== this.firstPage, progress: ((last + 1) / place.count) * 100, finished: last >= place.count - 1 })
  }

  // the page is kept a moment after it settles; a choice at once, as the viewer may close right after it and a closing page can't call any more
  saveSoon(now = false) {
    if (!this.item) return
    const changed = rememberedChanges(this.own, this.ownWas)
    this.ownWas = { ...this.own }
    if (changed) this.shell.remember(this.kind, changed)
    this.unsaved = { id: this.item.id, value: { page: this.place.page, ...(Object.keys(this.own).length ? { view: this.own } : {}), ...(this.marks.length ? { bookmarks: this.marks } : {}) } }
    clearTimeout(this.saving)
    if (now) this.save()
    else this.saving = setTimeout(() => this.save(), SAVE_MS)
  }

  save() {
    clearTimeout(this.saving)
    if (this.unsaved) this.shell.saved(this.unsaved.id, this.unsaved.value)
    this.unsaved = null
    this.shell.readState.write(true)
  }

  setOwn(change) {
    Object.assign(this.own, change)
    this.saveSoon(true)
  }

  sized(size) {
    clearTimeout(this.sizing)
    this.sizing = setTimeout(() => this.shell.changeSettings({ gridSize: size }), SAVE_MS)
  }

  settingsChanged() {
    if (!this.count) return
    if (this.grid.shown) this.grid.set(this.view_())
    else this.surface.set(this.view_())
    this.tools()
  }

  sideContents() {
    return this.contents.map((c) => ({ key: c.page, label: c.label, num: c.page + 1, depth: c.depth }))
  }

  /** Bookmarks with the names they show under. */
  labelled() {
    return this.marks.map((b) => ({ key: b.page, num: b.page + 1, label: b.label, text: markLabel(b, this.contents, t) }))
  }

  setMarks(next) {
    this.marks = next
    this.source.marks = new Set(next.map((b) => b.page))
    this.surface.marked()
    this.grid.marked()
    this.shell.side.setMarks(this.labelled())
    if (this.place.count) this.onPlace(this.place)
    this.saveSoon(true)
  }

  goTo(page) {
    this.surface.goTo(page)
  }

  toggleMark() {
    this.setMarks(toggleMark(this.marks, this.place.pages))
  }

  removeMark(page) {
    this.setMarks(this.marks.filter((b) => b.page !== page))
  }

  renameMark(page, label) {
    this.setMarks(this.marks.map((b) => (b.page === page ? { page: b.page, at: b.at, ...(label ? { label } : {}) } : b)))
  }

  pageMenu(page, pages) {
    return this.menu(page, pages)
  }

  /** The bookmark before or after the pages shown. */
  jump(dir) {
    const b = nextMark(this.marks, this.place.pages, dir)
    if (b) this.surface.goTo(b.page)
    else this.curio.ui.notify({ text: !this.marks.length ? noMarks(this.shell, t) : dir > 0 ? t('reader.marks.noneAfter') : t('reader.marks.noneBefore') })
  }

  /** The contents entry after the one the pages shown are in, or before it. */
  chapter(dir) {
    if (!this.contents.length) return this.curio.ui.notify({ text: t('reader.nav.noContents') })
    const at = placeAt(this.contents, this.place.page)
    const to = this.contents[at < 0 ? (dir > 0 ? 0 : -1) : at + dir]
    if (to) this.surface.goTo(to.page)
    else this.curio.ui.notify({ text: dir > 0 ? t('reader.nav.noNext') : t('reader.nav.noPrevious') })
  }

  /** The bookmark button's own menu: bookmark the page, show the strip, go to a bookmark or a place in the contents. */
  async placesMenu() {
    const has = this.marks.some((b) => this.place.pages.includes(b.page))
    const items = [
      { id: 'toggle', label: has ? t('reader.marks.remove') : t('reader.marks.add'), icon: has ? 'bookmark-off' : 'bookmark-plus' },
      { id: 'strip', label: this.shell.side.open ? t('reader.side.hide') : t('reader.side.show'), icon: 'layout-sidebar' },
    ]
    if (this.marks.length) items.push({ separator: true }, ...this.labelled().slice(0, MENU_MARKS).map((b) => ({ id: `go:${b.key}`, label: b.text, icon: 'bookmark' })))
    if (this.contents.length) items.push({ separator: true }, { label: t('reader.side.contents'), icon: 'list', items: this.contents.slice(0, MENU_PLACES).map((c) => ({ id: `go:${c.page}`, label: `${'  '.repeat(c.depth || 0)}${c.label} · ${c.page + 1}` })) })
    const { id } = await this.curio.ui.menu({ items }).catch(() => ({ id: null }))
    if (id === 'toggle') this.toggleMark()
    else if (id === 'strip') this.shell.toggleSide()
    else if (id?.startsWith('go:')) this.surface.goTo(Number(id.slice(3)))
  }

  tools() {
    const place = this.place
    if (!place.count) return
    const v = this.view_()
    const gridButton = { id: 'grid', label: t('reader.grid.pageGrid'), icon: 'layout-grid', on: !!v.grid }
    if (this.grid.shown) {
      const style = this.grid.style
      this.shell.setTools({
        labels: [{ id: 'place', text: this.selectedCount ? tc('reader.grid.pagesSelected', place.count, { selected: this.selectedCount.toLocaleString() }) : tc('reader.grid.pages', place.count) }],
        buttons: [gridButton, { id: 'gridStyle', label: t(`reader.gridStyles.${style}`), icon: GRID_ICONS[style] }],
        keys: ['grid', 'gridStyle'],
      })
      return
    }
    const pages = place.pages.map((i) => i + 1).join('–')
    const marked = this.marks.some((b) => place.pages.includes(b.page))
    const zoom = this.surface.zoom !== 1 ? ` · ${Math.round(this.surface.zoom * 100)}%` : ''
    this.shell.setTools({
      labels: [{ id: 'place', text: `${pages} / ${place.count}${zoom}${this.pageLabel()}` }, ...this.moreLabels()],
      ...(place.count > 1 ? { slider: { id: 'place', label: t('reader.tools.page'), min: 1, max: place.count, value: place.page + 1, dir: v.rtl ? 'rtl' : 'ltr' } } : {}),
      buttons: [
        { id: 'side', label: t('reader.side.sidebar'), icon: 'layout-sidebar', on: !!v.side },
        { id: 'bookmark', label: marked ? t('reader.marks.remove') : t('reader.marks.bookmark'), icon: 'bookmark', on: marked },
        ...this.moreButtons(),
        { id: 'double', label: t('reader.layouts.double'), icon: 'book', on: v.double },
        { id: 'continuous', label: t('reader.layouts.continuous'), icon: 'layout-rows', on: v.continuous },
        { id: 'rtl', label: t('reader.directions.rtl'), icon: 'text-direction-rtl', on: v.rtl },
        ...(v.continuous ? [] : [{ id: 'fit', label: fitName(v.fit), icon: FIT_ICONS[v.fit] }]),
        ...(this.hasGrid ? [gridButton] : []),
        { id: 'layout', label: t('reader.tools.layout'), icon: 'layout', panel: this.layoutPanel(v) },
        ...(this.lookTop().length ? [{ id: 'look', label: t('reader.tools.theme'), icon: 'palette', panel: this.lookTop() }] : []),
      ],
      keys: ['side', 'bookmark', 'markBack', 'markAhead', 'chapterBack', 'chapterAhead', 'double', 'continuous', 'rtl', ...(v.continuous ? [] : ['fit']), ...(this.hasGrid ? ['grid'] : []), ...this.moreKeys()],
    })
  }

  /** How pages are laid out. */
  layoutPanel(v) {
    const s = this.shell.settings()
    return [
      { type: 'choice', id: 'pageLayout', label: t('reader.tools.layout'), value: v.continuous ? 'continuous' : v.double ? 'double' : 'single', options: layoutOptions() },
      ...(v.continuous ? [] : [{ type: 'choice', id: 'direction', label: t('reader.tools.direction'), value: v.rtl ? 'rtl' : 'ltr', options: directions() }, { type: 'choice', id: 'fit', label: t('reader.tools.fit'), value: v.fit, options: FITS.map((f) => ({ value: f, label: fitName(f), icon: FIT_ICONS[f] })) }]),
      { type: 'separator' },
      { type: 'slider', id: 'pageWidth', label: t('reader.tools.pageWidth'), min: 30, max: 100, step: 5, unit: '%', value: v.pageWidth },
      ...(v.continuous ? [{ type: 'toggle', id: 'gapOn', label: t('reader.tools.pageGap'), value: v.gap > 0 }] : []),
      ...(v.double ? [{ type: 'toggle', id: 'cover', label: t('reader.tools.separateCovers'), value: !!v.cover }] : []),
      { type: 'toggle', id: 'enlarge', label: t('reader.tools.upscale'), value: !!v.enlarge },
      ...(v.continuous ? [] : [{ type: 'separator' }, { type: 'toggle', id: 'wheelTurns', label: t('reader.tools.wheel'), value: !!s.wheelTurns }]),
    ]
  }

  // what a kind of file adds to the toolbar, its texts and its Theme panel, and takes of the values, buttons and keys before the pages do
  pageLabel() {
    return ''
  }

  moreLabels() {
    return []
  }

  moreButtons() {
    return []
  }

  moreKeys() {
    return []
  }

  lookTop() {
    return []
  }

  ownValue() {
    return false
  }

  ownChoice() {
    return false
  }

  /** A toolbar button, its menu, or a value set in the toolbar. */
  tool(id, menu, value) {
    if (value !== undefined) return this.setValue(id, value)
    if (menu && id === 'bookmark' && !this.grid.shown) return this.placesMenu()
    if (this.grid.shown && id !== 'grid' && id !== 'gridStyle') return
    if (id === 'markBack' || id === 'markAhead') this.jump(id === 'markAhead' ? 1 : -1)
    else if (id === 'chapterBack' || id === 'chapterAhead') this.chapter(id === 'chapterAhead' ? 1 : -1)
    else this.choose(id)
  }

  /** A value set in the toolbar: the page, or a choice from the look panel. */
  setValue(id, value) {
    if (id === 'place') return this.surface.goTo(Number(value) - 1)
    if (this.ownValue(id, value)) return
    if (id === 'pageLayout') return this.setLayout(value)
    if (id === 'direction') return (value === 'rtl') !== !!this.view_().rtl && this.choose('rtl')
    if (LAYOUT_CHOICES.includes(id)) return this.view_()[id] !== value && this.choose(id, value)
    if (SETTING_VALUES.includes(id)) return this.shell.changeSettings({ [id]: value })
    if (id === 'gapOn') this.own.gap = value ? this.shell.settings().gap || DEFAULTS.gap : 0
    else if (OWN_VALUES.includes(id)) this.own[id] = value
    else return
    this.surface.set(this.view_())
    this.tools()
    this.saveSoon(true)
  }

  /** Single, double or continuous, from the Layout choice. */
  setLayout(value) {
    const v = this.view_()
    if (this.grid.shown || (v.continuous ? 'continuous' : v.double ? 'double' : 'single') === value) return
    Object.assign(this.own, { continuous: value === 'continuous', double: value === 'double' })
    this.surface.set(this.view_())
    this.tools()
    this.saveSoon(true)
  }

  /** One of the file's own choices changed: shown at once and kept with it. */
  choose(id, to) {
    if (this.ownChoice(id)) return
    const v = this.view_()
    if (id === 'grid') {
      if (!this.hasGrid) return
      if (v.grid) return this.read(this.place.page, true)
      this.own.grid = true
      this.showGrid(this.place.page)
      return this.saveSoon(true)
    }
    if (id === 'gridStyle') {
      this.own.gridStyle = GRID_STYLES[(GRID_STYLES.indexOf(this.grid.style) + 1) % GRID_STYLES.length]
      this.grid.set(this.view_())
      this.tools()
      return this.saveSoon(true)
    }
    if (this.grid.shown) return
    if (id === 'bookmark') return this.toggleMark()
    if (id === 'double' || id === 'continuous' || id === 'rtl') this.own[id] = !v[id]
    else if (id === 'fit') this.own.fit = to || FITS[(FITS.indexOf(v.fit) + 1) % FITS.length]
    else return
    this.surface.set(this.view_())
    if (id === 'rtl') this.shell.layoutSide()
    this.tools()
    this.saveSoon(true)
  }

  /** The menu of a page, or of the pages selected in the grid; a kind of file adds its own entries (`menuItems`) and acts on them (`menuChoice`). */
  async menu(page, pages) {
    const many = pages.length > 1
    const allMarked = pages.every((p) => this.marks.some((b) => b.page === p))
    const items = [
      ...this.menuTop(),
      { id: 'mark', label: allMarked ? (many ? tc('reader.marks.removeMany', pages.length) : t('reader.marks.remove')) : many ? tc('reader.marks.addMany', pages.length) : t('reader.marks.add'), icon: allMarked ? 'bookmark-off' : 'bookmark-plus' },
      ...this.menuItems(page, pages),
      ...(this.hasGrid ? [{ separator: true }, this.grid.shown ? { id: 'read', label: t('reader.grid.readFrom'), icon: 'book' } : { id: 'grid', label: t('reader.grid.showAll'), icon: 'layout-grid' }] : []),
    ]
    const token = this.token
    const { id } = await this.curio.ui.menu({ items }).catch(() => ({ id: null }))
    if (token !== this.token || !id) return
    if (id === 'mark') {
      if (allMarked) this.setMarks(this.marks.filter((b) => !pages.includes(b.page)))
      else this.setMarks(cleanMarks([...this.marks, ...pages.map((p) => ({ page: p, at: Date.now() }))], this.count))
    } else if (id === 'read') this.read(page)
    else if (id === 'grid') this.choose('grid')
    else this.menuChoice(id, page, pages)
  }

  menuTop() {
    return []
  }

  menuItems() {
    return []
  }

  menuChoice() {}

  /** Keys while the pages are shown; answers whether it used the key. */
  key(e) {
    if (!this.count || e.altKey || e.metaKey || e.ctrlKey || e.target.closest?.('input, textarea, select')) return false
    const v = this.view_()
    const surface = this.surface
    if (this.grid.shown) {
      const g = this.grid.view
      if (e.key === 'Escape') return this.grid.clearSelection()
      else if (e.key === 'Enter') this.read(this.grid.selected.size ? Math.min(...this.grid.selected) : this.place.page)
      else if (e.key === '=' || e.key === '+') this.grid.resize(this.grid.size * ZOOM_STEP)
      else if (e.key === '-') this.grid.resize(this.grid.size / ZOOM_STEP)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') g.scrollTop += e.key === 'ArrowDown' ? 80 : -80
      else if (e.key === 'PageDown' || e.key === ' ') g.scrollTop += g.clientHeight * 0.9 * (e.shiftKey ? -1 : 1)
      else if (e.key === 'PageUp') g.scrollTop -= g.clientHeight * 0.9
      else if (e.key === 'Home') g.scrollTop = 0
      else if (e.key === 'End') g.scrollTop = g.scrollHeight
      else return false
      return true
    }
    const along = (k) => (v.rtl ? -k : k)
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        // the reader stays with its file at either end
        const dir = along(e.key === 'ArrowRight' ? 1 : -1)
        if (!surface.atEdge(dir)) surface.turn(dir, { atEnd: false })
        return true
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        const dir = e.key === 'ArrowDown' ? 1 : -1
        if (surface.atScrollEdge(dir)) return !v.continuous && surface.turn(dir, { atEnd: dir < 0 })
        surface.view.scrollTop += dir * 80
        return true
      }
      case ' ':
        return surface.next(e.shiftKey ? -1 : 1)
      case 'PageDown':
      case 'PageUp':
        return surface.next(e.key === 'PageDown' ? 1 : -1)
      case 'Home':
        surface.goTo(0)
        return true
      case 'End':
        surface.goTo(this.count - 1)
        return true
      case '+':
      case '=':
        surface.setZoom(surface.zoom * ZOOM_STEP)
        return true
      case '-':
        surface.setZoom(surface.zoom / ZOOM_STEP)
        return true
      case '0':
        surface.setZoom(1)
        return true
    }
    return false
  }
}
