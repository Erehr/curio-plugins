// A book of fixed pages (a PDF, a fixed layout EPUB) as a reading: its pages on the surface as a comic's are, with what a book adds: its contents, a search of its text, text to select, links, and for a PDF pages in the style's colours.
// What fills the pages is the source's business (kinds/pdfpage.js, kinds/framepage.js); this asks it only what it can do.
import { PagesReading, toDataUrl } from './pages.js'
import { PdfSource } from './kinds/pdfpage.js'
import { FrameSource } from './kinds/framepage.js'
import { placeAt } from './places.js'
import { THEMES, THEME_COLOURS, themeSwatches } from './books.js'
import { t } from './text.js'

/** A book's contents as places by page, with their depth. */
function flatten(book, toc, depth = 0, out = []) {
  for (const entry of toc || []) {
    const page = Number.isInteger(entry.index) ? entry.index : book.resolveHref?.(entry.href)?.index
    if (Number.isInteger(page)) out.push({ page, label: (entry.label || '').trim() || t('reader.untitled'), depth })
    if (entry.subitems?.length) flatten(book, entry.subitems, depth + 1, out)
  }
  return out
}

export class FixedBook extends PagesReading {
  constructor(host, shell) {
    super(host, shell)
    this.what = 'book'
    this.searchRun = 0
    this.hitAt = null
    addEventListener('curio-theme', () => this.source && this.style())
  }

  firstTab() {
    return this.contents.length ? 'contents' : this.hasGrid ? 'pages' : 'bookmarks'
  }

  get kind() {
    return 'pdf'
  }

  /** The setting the theme is kept in: a PDF's own, as documents want their printed colours where books want Curio's; a book laid out in pages shares books'. */
  get themeKey() {
    return this.book?.pdf ? 'pdfTheme' : 'bookTheme'
  }

  // a PDF starts a page at a time, left to right unless it says otherwise; what is chosen in one is kept for PDFs alone (reader.js `remember`), apart from comics' and books'
  defaults(s) {
    return { ...s, double: false, cover: true, rtl: false, fit: 'page', continuous: false, pageWidth: 100 }
  }

  /** Opens a book at its kept page; `opened` is its file as bookfile.js opened it. */
  open(item, kept, it, { book }) {
    this.token = {}
    this.item = item
    this.book = book
    const on = {
      sized: (p, aspect, w, h) => this.surface.sized(p, aspect, w, h),
      go: (p) => this.surface.goTo(p),
      link: (href) => this.curio.app.openUrl({ url: href }).catch((e) => this.curio.ui.notify({ text: t('reader.links.cantOpen', { error: e.message || e }), severity: 'error' })),
      live: (p) => this.hitAt?.p === p && this.showHit(),
      key: (e) => (this.key(e) ? e.preventDefault() : this.shell.passKey(e)),
      wheel: (e, frame) => this.wheelIn(e, frame),
      click: (e, frame) => this.clickIn(e, frame),
      menu: (p) => this.menu(p, [p]),
    }
    const source = book.pdf ? new PdfSource(book, on) : new FrameSource(book, on)
    this.shell.side.setTabs(['contents', 'bookmarks', ...(source.urlOf ? ['pages'] : []), 'search'])
    this.found = book.dir === 'rtl' ? { rtl: true } : {}
    this.contents = flatten(book, book.toc)
    // the numbers printed on a PDF's pages, where they aren't the pages' own
    this.labels = book.pageList?.every((l) => Number.isInteger(l.index)) ? book.pageList.map((l) => l.label) : null
    if (source.recolours) source.colours = this.colours()
    const start = this.begin(source, kept)
    this.theme()
    source.measure?.(start)
  }

  close() {
    this.stopSearch()
    const source = this.source
    super.close()
    source?.close()
    this.book = null
  }

  // the style's colours for the pages: pdf.js draws them in these, pictures kept; `light` and the book's own leave pages as printed
  colours() {
    const theme = this.shell.settings()[this.themeKey]
    if (theme === 'book' || theme === 'light') return null
    const css = getComputedStyle(document.documentElement)
    const [bg, text] = THEME_COLOURS[theme] || ['', css.getPropertyValue('--text').trim()]
    return { background: bg || css.getPropertyValue('--bg').trim(), foreground: text }
  }

  theme() {
    this.surface.view.dataset.theme = this.shell.settings()[this.themeKey]
  }

  /** The colours changed (a setting, or Curio's theme): the pages are drawn again in them. */
  style() {
    this.theme()
    if (!this.source.recolours) return
    const next = this.colours()
    if (JSON.stringify(next) === JSON.stringify(this.source.colours)) return
    this.source.colours = next
    this.surface.refill()
  }

  settingsChanged() {
    if (!this.count) return
    this.style()
    super.settingsChanged()
  }

  // from inside a page's frame, where the surface's own listeners don't hear: the wheel zooms and turns as over the surface, and a click on either half turns the page
  wheelIn(e, frame) {
    const r = frame.getBoundingClientRect()
    const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1
    this.surface.wheel({ ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: r.left + e.clientX * k, clientY: r.top + e.clientY * k, preventDefault: () => e.preventDefault() })
  }

  clickIn(e, frame) {
    if (this.view_().continuous) return
    const r = frame.getBoundingClientRect()
    const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1
    const view = this.surface.view.getBoundingClientRect()
    const left = r.left + e.clientX * k - view.left < view.width / 2
    this.surface.turn(left !== !!this.view_().rtl ? -1 : 1)
  }

  pageLabel() {
    const label = this.labels?.[this.place.page]
    return label && label !== String(this.place.page + 1) ? ` · ${t('reader.places.pageShort', { page: label })}` : ''
  }

  moreLabels() {
    const chapter = this.contents[placeAt(this.contents, this.place.page)]?.label
    return chapter ? [{ id: 'chapter', text: chapter }] : []
  }

  moreButtons() {
    return [{ id: 'search', label: t('reader.side.search'), icon: 'search' }]
  }

  moreKeys() {
    return ['search', ...(this.source.recolours ? ['theme'] : [])]
  }

  lookTop() {
    if (!this.source.recolours) return []
    return [themeSwatches(this.shell.settings(), this.themeKey)]
  }

  ownValue(id, value) {
    if (id !== this.themeKey) return false
    this.shell.changeSettings({ [id]: value })
    return true
  }

  ownChoice(id) {
    if (id === 'search') this.shell.find()
    else if (id === 'theme' && this.source.recolours) this.shell.changeSettings({ [this.themeKey]: THEMES[(THEMES.indexOf(this.shell.settings()[this.themeKey]) + 1) % THEMES.length] })
    else return false
    return true
  }

  menuTop() {
    const text = this.source.selected()
    return text ? [{ id: 'copy', label: t('reader.selection.copy'), icon: 'copy' }, { id: 'find', label: t('reader.selection.find', { text: text.length > 30 ? `${text.slice(0, 29)}…` : text }), icon: 'search' }, { separator: true }] : []
  }

  menuItems(page, pages) {
    return pages.length > 1 || !this.source.urlOf ? [] : [{ id: 'thumb', label: t('reader.thumb.set'), icon: 'photo-star' }]
  }

  async menuChoice(id, page) {
    const text = this.source.selected()
    if (id === 'copy') await this.curio.clipboard.writeText({ text }).catch(() => {})
    else if (id === 'find') {
      if (!this.view_().side) this.shell.toggleSide()
      this.shell.side.find(text.slice(0, 200))
    } else if (id === 'thumb') {
      const book = this.item
      const data = await toDataUrl(await fetch(await this.source.urlOf(page, 1024)).then((r) => r.blob()))
      await this.curio.item.setThumbnail({ ids: [book.id], data }).then(() => this.curio.ui.notify({ text: t('reader.thumb.done') }), (e) => this.curio.ui.notify({ text: t('reader.thumb.failed', { error: e.message || e }), severity: 'error' }))
    }
  }

  /** A place from the side strip: a page, or something a search found. */
  goTo(key) {
    if (typeof key !== 'string') return this.surface.goTo(key)
    const [, p, k] = key.split(':').map(Number)
    this.hitAt = { p, k }
    if (!this.place.pages.includes(p)) this.surface.goTo(p)
    this.showHit()
  }

  /** Results by page, under the chapter each is in; the source searches its pages and marks what it found in them. */
  async *search(query) {
    this.stopSearch()
    const run = this.searchRun
    const source = this.source
    for await (const r of source.find(query)) {
      if (run !== this.searchRun || source !== this.source) return
      if (r.progress != null) {
        yield r
        continue
      }
      const chapter = this.contents[placeAt(this.contents, r.page)]?.label
      yield { label: chapter ? t('reader.places.inChapter', { chapter, page: r.page + 1 }) : t('reader.places.pageShort', { page: r.page + 1 }), items: r.items.map((it) => ({ key: `hit:${r.page}:${it.k}`, excerpt: it.excerpt })) }
    }
  }

  stopSearch() {
    this.searchRun++
    this.hitAt = null
    this.source?.clearFound()
  }

  /** The result gone to stands out, scrolled into view once its page's text is there. */
  showHit() {
    const box = this.hitAt && this.source.showHit(this.hitAt.p, this.hitAt.k)
    if (!box) return
    const view = this.surface.view.getBoundingClientRect()
    if (box.top < view.top || box.bottom > view.bottom) this.surface.view.scrollTop += box.top - view.top - view.height / 3
    if (box.left < view.left || box.right > view.right) this.surface.view.scrollLeft += box.left - view.left - view.width / 3
  }
}
