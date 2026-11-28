// Books whose text flows (EPUB, FB2, MOBI, AZW3), styled from the reader's settings and Curio's theme: turned a page at a time by foliate-js's view, scrolled in the reader's own column (flow.js), which answers to the same names.
// One of the reader's readings (reader.js): the shell hands it the item and its kept state; it answers with the toolbar, the side strip's lists, keys and the place to keep.
import { WheelTurns } from './wheel.js'
import { FlowView } from './flow.js'
import { layoutOptions } from './pages.js'
import { MARGINS, GAPS, nearest } from './defaults.js'
import { noMarks } from './places.js'
import { rememberedChanges } from './remember.js'
import * as CFI from '../vendor/foliate-js/epubcfi.js'
import { t } from './text.js'

const SAVE_MS = 1000
const SIZE_MIN = 50
const SIZE_MAX = 300
const SIZE_STEP = 10
export const THEMES = ['curio', 'light', 'sepia', 'dark', 'black', 'book']
export const themeName = (theme) => (theme === 'curio' ? 'Curio' : t(`reader.themes.${theme}`))
const GENERIC_FONTS = ['serif', 'sans-serif', 'monospace']
const SLIDER_STEPS = 1000
// the font list's entry for the book's own fonts, as a select shows an empty value as nothing chosen
const BOOK_FONT = '(book)'
// and the one for Curio's own font, whatever the theme makes it
export const APP_FONT = '(app)'
// the text's width from which it is set in two columns, when they are on
const TWO_COLUMNS_PX = 900
// a click this near either edge of the view turns the page: a share of its width, at least so many px
const EDGE_SHARE = 0.2
const EDGE_MIN_PX = 80
const BOOK_SETTINGS = ['bookTheme', 'bookFont', 'bookSize', 'bookLineHeight', 'bookAlign', 'bookIndent', 'bookParagraph', 'bookHyphenate', 'bookPageWidth', 'bookMargin', 'bookGap', 'wheelTurns']
const STEPS = ['small', 'medium', 'large']
const stepChoice = (id, label, steps, v) => ({ type: 'choice', id, label, value: String(nearest(steps, Number(v) || 0)), options: steps.map((n, i) => ({ value: String(n), label: t(`reader.steps.${STEPS[i]}`) })) })
export const THEME_COLOURS = { light: ['#fbfbf8', '#1d1d1b', '#2a64b8'], sepia: ['#f4ecd8', '#5b4636', '#8a5a1c'], dark: ['#1f1f1f', '#d8d8d4', '#7fb2f0'], black: ['#000000', '#c4c4c0', '#7fb2f0'] }

/** The Theme swatches, for books and for pages that take the theme's colours; `key` is the setting they set, a PDF's apart from books'. */
export function themeSwatches(s, key = 'bookTheme') {
  const css = getComputedStyle(document.documentElement)
  const colour = (theme) => (theme === 'curio' ? css.getPropertyValue('--bg').trim() : THEME_COLOURS[theme]?.[0])
  return { type: 'swatches', id: key, label: t('reader.tools.theme'), value: s[key], options: THEMES.map((theme) => ({ value: theme, label: themeName(theme), icon: theme === 'book' ? 'book' : null, background: colour(theme) || null })) }
}
const MENU_MARKS = 40
const MENU_PLACES = 300

const SVG = 'image/svg+xml'
const pct = (f) => `${Math.floor(Math.min(1, Math.max(0, f || 0)) * 100)}%`
const lang = (x) => (!x ? '' : typeof x === 'string' ? x : x[Object.keys(x)[0]] ?? '')

/** The stylesheet every section gets: the reader's font, size, spacing and colours over the book's own. */
export function bookCss(s, colours, dark, appFont = 'sans-serif') {
  const font = !s.bookFont ? '' : s.bookFont === APP_FONT ? appFont : GENERIC_FONTS.some(([f]) => f === s.bookFont) ? s.bookFont : `"${s.bookFont.replace(/["\\]/g, '')}"`
  const align = { start: 'start !important', justify: 'justify', force: 'justify !important' }[s.bookAlign]
  const gap = Number(s.bookParagraph)
  const [bg, text, link] = colours || []
  // a frame whose colour scheme differs from the page's is drawn on opaque white or black, so it takes the page's own
  return `
@namespace epub "http://www.idpf.org/2007/ops";
html { font-size: ${s.bookSize}% !important; ${colours ? `color-scheme: ${dark ? 'dark' : 'light'} !important; color: ${text} !important; background: ${bg || 'transparent'} !important;` : ''} }
${colours ? `body { background: transparent !important; color: ${text} !important; } body *:not(a):not(a *) { color: inherit !important; } a:link, a:visited { color: ${link} !important; }` : ''}
${font ? `body { font-family: ${font} !important; } body *:not(code):not(pre):not(kbd):not(samp):not(code *):not(pre *) { font-family: inherit !important; }` : ''}
p, li, blockquote, dd, div { line-height: ${s.bookLineHeight} !important; ${align ? `text-align: ${align};` : ''} }
p, li, blockquote, dd {
  -webkit-hyphens: ${s.bookHyphenate ? 'auto' : 'manual'};
  hyphens: ${s.bookHyphenate ? 'auto' : 'manual'};
  widows: 2;
  orphans: 2;
}
${s.bookIndent === 'indent' ? 'p { text-indent: 1.5em !important; }' : s.bookIndent === 'none' ? 'p { text-indent: 0 !important; }' : ''}
${s.bookParagraph !== 'book' && Number.isFinite(gap) ? `p { margin-top: 0 !important; margin-bottom: ${gap}em !important; }` : ''}
[align="left"] { text-align: left !important; }
[align="right"] { text-align: right !important; }
[align="center"] { text-align: center !important; }
img, svg { max-width: 100%; max-height: 100%; object-fit: contain; }
pre { white-space: pre-wrap !important; }
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"],
aside[epub\\:type~="endnote"], aside[epub\\:type~="footnote"], aside[epub\\:type~="note"], aside[epub\\:type~="rearnote"] { display: none; }
`
}

// foliate's paginator skips a section without a body, so an SVG page of a reflowable book is wrapped in XHTML; fixed layout reads SVG pages as they are.
function svgPages(book) {
  if (book.rendition?.layout === 'pre-paginated' || !book.transformTarget) return
  const res = book.resources
  const pages = new Set((res?.spine || []).map((s) => res.getItemByID(s.idref)).filter((i) => i?.mediaType === SVG).map((i) => i.href))
  if (!pages.size) return
  book.transformTarget.addEventListener('data', (e) => {
    const d = e.detail
    if (d.type !== SVG || !pages.has(d.name)) return
    d.data = Promise.resolve(d.data).then((text) => {
      const links = []
      const svg = String(text).replace(/<\?xml-stylesheet([^>]*)\?>/g, (_, a) => {
        const href = /href\s*=\s*["']([^"']+)/.exec(a)?.[1]
        if (href) links.push(`<link rel="stylesheet" href="${href}"/>`)
        return ''
      }).replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/i, '')
      return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title></title>${links.join('')}<style>html,body{margin:0;height:100%}body>svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`
    })
    d.type = 'application/xhtml+xml'
  })
}

/** A book's contents as rows, with their depth. */
function flatten(toc, depth = 0, out = []) {
  for (const entry of toc || []) {
    out.push({ key: entry.href, label: (entry.label || '').trim() || t('reader.untitled'), depth, src: entry })
    if (entry.subitems?.length) flatten(entry.subitems, depth + 1, out)
  }
  return out
}

export class Books {
  /** `host` is the reader's page area; `shell` is the reader's (reader.js). */
  constructor(host, shell) {
    this.what = 'book'
    this.host = host
    this.shell = shell
    this.curio = shell.curio
    this.el = document.createElement('div')
    this.el.className = 'book'
    this.el.hidden = true
    host.append(this.el)
    this.ribbon = document.createElement('div')
    this.ribbon.className = 'book-ribbon'
    this.ribbon.hidden = true
    host.append(this.ribbon)
    this.note = document.createElement('div')
    this.note.className = 'book-note'
    this.note.hidden = true
    host.append(this.note)
    this.view = null
    this.item = null
    this.marks = []
    this.own = {}
    this.loc = null
    this.searchRun = 0
    this.wheelTurns = new WheelTurns()
    this.fonts = null
    addEventListener('curio-theme', () => this.view && this.style())
    // the page width is a share of the view's
    new ResizeObserver(() => this.view && this.layout()).observe(host)
    host.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    // the room around the text, outside the book's frames, turns pages too
    this.el.addEventListener('click', (e) => e.button === 0 && this.edgeClick(e.clientX - host.getBoundingClientRect().left))
    document.addEventListener('pointerdown', (e) => !this.note.hidden && !this.note.contains(e.target) && this.closeNote())
  }

  get shown() {
    return !!this.item
  }

  get sideable() {
    return true
  }

  firstTab() {
    return this.toc?.length ? 'contents' : 'bookmarks'
  }

  pageMenu() {
    return this.placesMenu()
  }

  view_() {
    const s = this.shell.settings()
    return { flow: s.bookFlow, columns: s.bookColumns, side: s.side, ...this.shell.remembered('book'), ...this.own }
  }

  /** Opens a book at its kept place; `opened` is its file as bookfile.js opened it. */
  async open(item, kept, it, { file, book }) {
    const token = (this.token = {})
    this.item = item
    this.own = kept.view || {}
    this.ownWas = { ...this.own }
    this.marks = (Array.isArray(kept.bookmarks) ? kept.bookmarks : []).filter((b) => b && typeof b.cfi === 'string' && CFI.isCFI.test(b.cfi))
    this.loc = null
    this.first = null
    this.el.hidden = false
    this.file = file
    if (!this.fonts) this.curio.app.fonts().then((f) => (this.fonts = f), () => (this.fonts = []))
    const { FootnoteHandler } = await import('../vendor/foliate-js/footnotes.js')
    if (token !== this.token) return
    this.notes(FootnoteHandler)
    svgPages(book)
    this.book = book
    this.toc = flatten(book.toc)
    // each section's chapter, for search results: the first contents entry in it, or the one before
    this.sectionLabels = []
    for (const entry of this.toc) {
      const i = book.resolveHref?.(entry.key)?.index
      if (Number.isInteger(i) && this.sectionLabels[i] == null) this.sectionLabels[i] = entry.label
    }
    for (let i = 1; i < book.sections.length; i++) this.sectionLabels[i] ??= this.sectionLabels[i - 1]
    this.shell.side.setTabs([...(this.toc.length ? ['contents'] : []), 'bookmarks', 'search'])
    this.shell.side.load(this.toc.map(({ key, label, depth }) => ({ key, label, depth })), this.labelled())
    await this.show(kept.cfi)
    if (token !== this.token) return
    this.shell.say('')
  }

  /** The book in the view for how it is read now, turned or scrolled, at a place; the two take the same book and the same CFI, so the place holds from one to the other. */
  async show(cfi) {
    const token = this.token
    this.stopSearch()
    this.view?.close()
    this.view?.remove()
    this.scrolled = this.view_().flow === 'scrolled'
    const view = this.scrolled ? new FlowView() : document.createElement('foliate-view')
    this.el.replaceChildren(view.node ?? view)
    this.view = view
    view.addEventListener('relocate', (e) => view === this.view && this.relocated(e.detail))
    view.addEventListener('load', (e) => view === this.view && this.loaded(e.detail))
    view.addEventListener('external-link', (e) => {
      e.preventDefault()
      this.externalLink(e.detail.href)
    })
    view.addEventListener('link', (e) => this.link(e))
    await view.open(this.book)
    if (token !== this.token || view !== this.view) return
    this.layout()
    this.style()
    // a book opened for the first time starts at its cover, not where its text starts
    if (cfi && CFI.isCFI.test(cfi)) await view.init({ lastLocation: cfi })
    else {
      view.history.pushState(0)
      await view.goTo(0)
    }
    if (token !== this.token || view !== this.view) return
    view.focus()
  }

  close() {
    this.token = {}
    this.save(true)
    this.closeNote()
    this.stopSearch()
    this.view?.close()
    this.view?.remove()
    this.view = null
    this.book = null
    this.item = null
    this.file = null
    this.el.hidden = true
    this.ribbon.hidden = true
    this.el.replaceChildren()
  }

  /** Paginated or scrolled, one column or up to two, the margins and line length from the settings. */
  layout() {
    const r = this.view?.renderer
    if (!r) return
    const v = this.view_()
    const s = this.shell.settings()
    r.setAttribute('flow', v.flow === 'scrolled' ? 'scrolled' : 'paginated')
    // the text takes a share of the view's width; explicit Double always uses two columns where the view fits them
    const hostW = Math.max(1, this.host.clientWidth)
    const width = hostW * Math.min(100, Math.max(20, s.bookPageWidth || 100)) / 100
    const columns = v.flow !== 'scrolled' && (v.columns === 'two' ? hostW >= 480 : v.columns !== 'one' && width >= TWO_COLUMNS_PX) ? 2 : 1
    r.setAttribute('max-column-count', String(columns))
    r.setAttribute('max-inline-size', `${Math.floor(width / columns)}px`)
    r.setAttribute('gap', `${Math.max(GAPS[0], s.bookGap)}%`)
    for (const side of ['top', 'bottom']) r.setAttribute(`margin-${side}`, `${s.bookMargin}px`)
    for (const side of ['left', 'right']) r.setAttribute(`margin-${side}`, `${Math.round(s.bookMargin / 2)}px`)
  }

  dark() {
    return document.documentElement.style.colorScheme === 'dark'
  }

  colours() {
    const s = this.shell.settings()
    if (s.bookTheme === 'book') return null
    if (THEME_COLOURS[s.bookTheme]) return THEME_COLOURS[s.bookTheme]
    const css = getComputedStyle(document.documentElement)
    const get = (k, d) => css.getPropertyValue(k).trim() || d
    return ['', get('--text', '#ddd'), get('--accent', '#5aa')]
  }

  /** The stylesheet and colours, after a setting or Curio's theme changed. */
  style() {
    const r = this.view?.renderer
    if (!r) return
    const s = this.shell.settings()
    const colours = this.colours()
    r.setStyles?.(bookCss(s, colours, this.dark(), getComputedStyle(document.body).fontFamily))
    if (colours) r.setAttribute('no-background', '')
    else r.removeAttribute('no-background')
    this.el.style.background = colours?.[0] || ''
    this.el.dataset.theme = s.bookTheme
  }

  settingsChanged() {
    if (!this.view) return
    this.reflow()
    this.style()
    this.tools()
  }

  /** Keys, the pointer, the wheel and turning by the page's edges from inside each section's frame, which the page's own listeners don't hear. */
  loaded({ doc }) {
    // calibre wraps cover images in <svg preserveAspectRatio="none">, which stretches them on wide viewports
    for (const svg of doc.querySelectorAll('svg[preserveAspectRatio="none"]')) {
      if (svg.querySelector('image')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    }
    doc.addEventListener('keydown', (e) => {
      if (this.key(e)) return e.preventDefault()
      // passed on as if pressed in the page, so Curio hears it
      this.shell.passKey(e)
    })
    const frame = doc.defaultView?.frameElement
    // the page's own listeners (menus placed at the pointer, closed by a press) hear the pointer over the book's frames too
    const pass = (e) => {
      const r = frame?.getBoundingClientRect()
      if (!r) return
      const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1
      window.dispatchEvent(new PointerEvent(e.type, { clientX: r.left + e.clientX * k, clientY: r.top + e.clientY * k, button: e.button, buttons: e.buttons, pointerType: e.pointerType }))
    }
    doc.addEventListener('pointermove', pass, { passive: true })
    doc.addEventListener('pointerdown', pass, { passive: true })
    doc.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.target.closest?.('a[href]') || !doc.getSelection()?.isCollapsed) return
      const r = frame?.getBoundingClientRect()
      const k = r && frame.offsetWidth ? r.width / frame.offsetWidth : 1
      this.edgeClick((r?.left ?? 0) + e.clientX * k - this.host.getBoundingClientRect().left)
    })
    doc.addEventListener('contextmenu', (e) => {
      if (!doc.getSelection()?.isCollapsed) return
      e.preventDefault()
      const href = e.target.closest?.('a[href]')?.getAttribute('href') || ''
      if (/^(https?:|mailto:)/i.test(href)) this.linkMenu(href)
      else this.placesMenu()
    })
  }

  /** A click `x` px from the view's left edge: near either edge, paged, it turns the page. */
  edgeClick(x) {
    if (!this.view || this.view_().flow === 'scrolled') return
    const w = this.host.clientWidth
    const zone = Math.max(EDGE_MIN_PX, w * EDGE_SHARE)
    if (x < zone) this.view.goLeft()
    else if (x > w - zone) this.view.goRight()
  }

  /** Paged, the wheel turns pages: a notch at a time, more for a longer spin. Scrolled, it scrolls. */
  wheel(e) {
    if (!this.view || e.ctrlKey || e.shiftKey || this.view_().flow === 'scrolled' || !this.shell.settings().wheelTurns) return
    if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    e.preventDefault()
    this.wheelTurns.feed(e, (dir) => {
      const r = this.view.renderer
      if (dir > 0 ? r.atEnd : r.atStart) return false
      dir > 0 ? this.view.next() : this.view.prev()
    }, this.host.clientHeight)
  }

  relocated(d) {
    this.loc = d
    if (this.first == null) this.first = d.location?.current ?? d.fraction
    const s = this.shell
    this.showPlace()
    this.saveSoon()
    const atEnd = d.location ? d.location.next >= d.location.total : d.fraction >= 0.995
    s.readState.note(this.item.id, { moved: (d.location?.current ?? d.fraction) !== this.first, progress: (atEnd ? 1 : d.fraction) * 100, finished: atEnd })
  }

  /** The toolbar and the side strip at the place shown. */
  showPlace() {
    const shown = this.shownMarks()
    this.ribbon.hidden = !shown.size
    this.shell.side.setPlace({ contentsAt: this.toc.findIndex((x) => x.src === this.loc.tocItem), shown, markText: shown.size ? t('reader.marks.remove') : t('reader.marks.add'), pages: [] })
    this.tools()
  }

  /** Its words again, in the language the window changed to. */
  languageChanged() {
    if (!this.view || !this.loc) return
    this.shell.side.setMarks(this.labelled())
    this.showPlace()
  }

  tools() {
    if (!this.view || !this.loc) return
    const v = this.view_()
    const d = this.loc
    const chapter = d.tocItem?.label?.trim()
    const page = d.pageItem?.label ? `${t('reader.places.pageShort', { page: d.pageItem.label })} · ` : ''
    const marked = this.shownMarks().size > 0
    this.shell.setTools({
      labels: [{ id: 'place', text: `${page}${pct(d.fraction)}` }, ...(chapter ? [{ id: 'chapter', text: chapter }] : [])],
      slider: { id: 'place', label: t('reader.tools.position'), min: 0, max: SLIDER_STEPS, value: Math.round((d.fraction || 0) * SLIDER_STEPS), dir: this.book?.dir === 'rtl' ? 'rtl' : 'ltr' },
      buttons: [
        { id: 'side', label: t('reader.side.sidebar'), icon: 'layout-sidebar', on: !!v.side },
        { id: 'bookmark', label: marked ? t('reader.marks.remove') : t('reader.marks.bookmark'), icon: 'bookmark', on: marked },
        { id: 'search', label: t('reader.side.search'), icon: 'search' },
        { id: 'layout', label: t('reader.tools.page'), icon: 'layout', panel: this.layoutPanel() },
        { id: 'look', label: t('reader.tools.text'), icon: 'typography', panel: this.lookPanel() },
      ],
      keys: ['side', 'bookmark', 'markBack', 'markAhead', 'chapterBack', 'chapterAhead', 'search', 'double', 'continuous', 'theme'],
    })
  }

  /** The Text panel. */
  lookPanel() {
    const s = this.shell.settings()
    const fonts = [{ value: BOOK_FONT, label: t('reader.text.default') }, { value: APP_FONT, label: 'Curio' }, ...GENERIC_FONTS.map((value) => ({ value, label: t(`reader.fonts.${value}`) })), ...(this.fonts || []).map((f) => ({ value: f, label: f }))]
    if (s.bookFont && !fonts.some((f) => f.value === s.bookFont)) fonts.push({ value: s.bookFont, label: s.bookFont })
    return [
      themeSwatches(s),
      { type: 'select', id: 'bookFont', label: t('reader.text.font'), value: s.bookFont || BOOK_FONT, options: fonts },
      { type: 'slider', id: 'bookSize', label: t('reader.text.size'), min: SIZE_MIN, max: SIZE_MAX, step: 5, unit: '%', value: s.bookSize },
      { type: 'slider', id: 'bookLineHeight', label: t('reader.text.lineHeight'), min: 1, max: 2.4, step: 0.05, value: s.bookLineHeight },
      { type: 'separator' },
      { type: 'choice', id: 'bookAlign', label: t('reader.text.alignment'), value: s.bookAlign, options: [{ value: 'justify', label: t('reader.text.default'), icon: 'book' }, { value: 'start', label: t('reader.text.left'), icon: 'align-left' }, { value: 'force', label: t('reader.text.justify'), icon: 'align-justified' }] },
      { type: 'choice', id: 'bookIndent', label: t('reader.text.indent'), value: s.bookIndent, options: [{ value: 'book', label: t('reader.text.default') }, { value: 'indent', label: t('reader.text.on') }, { value: 'none', label: t('reader.text.off') }] },
      { type: 'choice', id: 'bookParagraph', label: t('reader.text.paragraph'), value: String(s.bookParagraph), options: [{ value: 'book', label: t('reader.text.default') }, { value: '0', label: t('reader.text.none') }, { value: '0.5', label: '½' }, { value: '1', label: '1' }, { value: '1.5', label: '1½' }] },
      { type: 'toggle', id: 'bookHyphenate', label: t('reader.text.hyphenation'), value: s.bookHyphenate },
    ]
  }

  /** The Page panel: single, double or continuous, the page's width, margins and gap, the wheel. */
  layoutPanel() {
    const s = this.shell.settings()
    const v = this.view_()
    const layout = v.flow === 'scrolled' ? 'continuous' : v.columns === 'one' ? 'single' : 'double'
    return [
      { type: 'choice', id: 'pageLayout', label: t('reader.tools.layout'), value: layout, options: layoutOptions() },
      { type: 'separator' },
      { type: 'slider', id: 'bookPageWidth', label: t('reader.tools.pageWidth'), min: 30, max: 100, step: 5, unit: '%', value: s.bookPageWidth },
      stepChoice('bookMargin', t('reader.tools.margins'), MARGINS, s.bookMargin),
      ...(layout === 'double' ? [stepChoice('bookGap', t('reader.tools.columnGap'), GAPS, s.bookGap)] : []),
      ...(layout === 'continuous' ? [] : [{ type: 'separator' }, { type: 'toggle', id: 'wheelTurns', label: t('reader.tools.wheel'), value: !!s.wheelTurns }]),
    ]
  }

  /** A toolbar button, or a value set in the toolbar; answers whether it was the book's. */
  tool(id, menu, value) {
    if (menu && id === 'bookmark') return this.placesMenu(), true
    const v = this.view_()
    if (value !== undefined) {
      if (id === 'place') this.view.goToFraction(value / SLIDER_STEPS)
      else if (id === 'pageLayout') this.choose(value === 'continuous' ? { flow: 'scrolled' } : { flow: 'paginated', columns: value === 'double' ? 'auto' : 'one' })
      else if (id === 'bookMargin' || id === 'bookGap') this.shell.changeSettings({ [id]: Number(value) })
      else if (id === 'bookFont') this.shell.changeSettings({ bookFont: value === BOOK_FONT ? '' : value })
      else if (BOOK_SETTINGS.includes(id)) this.shell.changeSettings({ [id]: value })
      else return false
      return true
    }
    if (id === 'bookmark') this.toggleMark()
    else if (id === 'markBack' || id === 'markAhead') this.jump(id === 'markAhead' ? 1 : -1)
    else if (id === 'chapterBack' || id === 'chapterAhead') this.chapter(id === 'chapterAhead' ? 1 : -1)
    else if (id === 'search') this.shell.find()
    else if (id === 'continuous') this.choose({ flow: v.flow === 'scrolled' ? 'paginated' : 'scrolled' })
    else if (id === 'double') this.choose({ columns: v.columns === 'one' ? 'auto' : 'one' })
    else if (id === 'theme') this.shell.changeSettings({ bookTheme: THEMES[(THEMES.indexOf(this.shell.settings().bookTheme) + 1) % THEMES.length] })
    else return false
    return true
  }

  textSize(size) {
    size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(size)))
    this.shell.changeSettings({ bookSize: size })
  }

  /** One of this book's own choices; kept with it. */
  choose(change) {
    Object.assign(this.own, change)
    this.reflow()
    this.tools()
    this.saveSoon(true)
  }

  /** The layout as the choices have it now: set on the view, or the book shown again where turning and scrolling changed places. */
  reflow() {
    if (this.scrolled !== (this.view_().flow === 'scrolled')) this.show(this.loc?.cfi)
    else this.layout()
  }

  setOwn(change) {
    Object.assign(this.own, change)
    this.saveSoon(true)
  }

  /** Keys while a book is shown; answers whether it used the key. */
  key(e) {
    if (!this.view || e.altKey || e.metaKey || e.ctrlKey) return false
    if (e.target?.closest?.('input, textarea, select')) return false
    const r = this.view.renderer
    const scrolled = this.view_().flow === 'scrolled'
    const rtl = this.book?.dir === 'rtl'
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const forward = (e.key === 'ArrowRight') !== rtl
        // the reader stays with its book at either end
        if (forward ? r.atEnd : r.atStart) return true
        if (e.key === 'ArrowLeft') this.view.goLeft()
        else this.view.goRight()
        return true
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        const forward = e.key === 'ArrowDown'
        if (forward ? r.atEnd : r.atStart) return true
        if (scrolled) forward ? this.view.next(80) : this.view.prev(80)
        else forward ? this.view.next() : this.view.prev()
        return true
      }
      case ' ':
        e.shiftKey ? this.view.prev() : this.view.next()
        return true
      case 'PageDown':
      case 'PageUp':
        e.key === 'PageDown' ? this.view.next() : this.view.prev()
        return true
      case 'Home':
        this.view.goTo(0)
        return true
      case 'End':
        this.view.goTo(this.book.sections.length - 1)
        return true
      case '=':
      case '+':
        this.textSize(this.shell.settings().bookSize + SIZE_STEP)
        return true
      case '-':
        this.textSize(this.shell.settings().bookSize - SIZE_STEP)
        return true
      case '0':
        this.textSize(100)
        return true
      case 'Escape':
        if (this.note.hidden) return false
        this.closeNote()
        return true
    }
    return false
  }

  goTo(target) {
    this.view?.goTo(target)
  }

  // bookmarks: a CFI where the page shown starts, the chapter it was in and how far into the book, and an optional name
  range() {
    const cfi = this.loc?.cfi
    if (!cfi) return null
    return [CFI.collapse(cfi), CFI.collapse(cfi, true)]
  }

  shownMarks() {
    const r = this.range()
    if (!r) return new Set()
    // a bookmark on an element holds the page whose first line is inside it, as scrolling starts a page within the heading a turned page started at
    const inner = (c) => c.slice(8, -1)
    const start = inner(r[0])
    const holds = (b) => start.startsWith(inner(b)) && '/:['.includes(start[inner(b).length] ?? '')
    return new Set(this.marks.filter((b) => (CFI.compare(r[0], b.cfi) <= 0 || holds(b.cfi)) && CFI.compare(b.cfi, r[1]) <= 0).map((b) => b.cfi))
  }

  labelled() {
    return this.marks.map((b) => ({ key: b.cfi, text: b.label || [b.chapter, pct(b.fraction)].filter(Boolean).join(' · '), num: pct(b.fraction), label: b.label }))
  }

  setMarks(next) {
    this.marks = next.sort((a, b) => CFI.compare(a.cfi, b.cfi))
    this.shell.side.setMarks(this.labelled())
    if (this.loc) this.relocated(this.loc)
    this.saveSoon(true)
  }

  toggleMark() {
    const shown = this.shownMarks()
    if (shown.size) return this.setMarks(this.marks.filter((b) => !shown.has(b.cfi)))
    const r = this.range()
    if (!r) return
    this.setMarks([...this.marks, { cfi: r[0], at: Date.now(), fraction: this.loc.fraction, chapter: this.loc.tocItem?.label?.trim() || '' }])
  }

  removeMark(cfi) {
    this.setMarks(this.marks.filter((b) => b.cfi !== cfi))
  }

  renameMark(cfi, label) {
    this.setMarks(this.marks.map((b) => (b.cfi === cfi ? { ...b, label: label || undefined } : b)))
  }

  jump(dir) {
    const r = this.range()
    if (!r) return
    const b = dir > 0 ? this.marks.find((m) => CFI.compare(m.cfi, r[1]) > 0) : [...this.marks].reverse().find((m) => CFI.compare(m.cfi, r[0]) < 0)
    if (b) this.view.goTo(b.cfi)
    else this.curio.ui.notify({ text: !this.marks.length ? noMarks(this.shell, t) : dir > 0 ? t('reader.marks.noneAfter') : t('reader.marks.noneBefore') })
  }

  /** The contents entry after the one the page shown is in, or before it. */
  chapter(dir) {
    if (!this.toc.length) return this.curio.ui.notify({ text: t('reader.nav.noContents') })
    const at = this.toc.findIndex((x) => x.src === this.loc?.tocItem)
    const to = this.toc[at < 0 ? (dir > 0 ? 0 : -1) : at + dir]
    if (to) this.view.goTo(to.key)
    else this.curio.ui.notify({ text: dir > 0 ? t('reader.nav.noNext') : t('reader.nav.noPrevious') })
  }

  /** The bookmark button's menu, and the page's own: bookmark the page, the strip, search, the bookmarks and the contents. */
  async placesMenu() {
    const has = this.shownMarks().size > 0
    const items = [
      { id: 'toggle', label: has ? t('reader.marks.remove') : t('reader.marks.add'), icon: has ? 'bookmark-off' : 'bookmark-plus' },
      { id: 'strip', label: this.shell.side.open ? t('reader.side.hide') : t('reader.side.show'), icon: 'layout-sidebar' },
      { id: 'search', label: t('reader.side.search'), icon: 'search' },
    ]
    if (this.history()) items.push({ id: 'back', label: t('reader.nav.back'), icon: 'arrow-back-up' })
    if (this.marks.length) items.push({ separator: true }, ...this.labelled().slice(0, MENU_MARKS).map((b) => ({ id: `go:${b.key}`, label: b.text, icon: 'bookmark' })))
    if (this.toc.length) items.push({ separator: true }, { label: t('reader.side.contents'), icon: 'list', items: this.toc.slice(0, MENU_PLACES).map((c) => ({ id: `go:${c.key}`, label: `${'  '.repeat(c.depth)}${c.label}` })) })
    const { id } = await this.curio.ui.menu({ items }).catch(() => ({ id: null }))
    if (id === 'toggle') this.toggleMark()
    else if (id === 'strip') this.shell.toggleSide()
    else if (id === 'search') this.shell.find()
    else if (id === 'back') this.view.history.back()
    else if (id?.startsWith('go:')) this.view.goTo(id.slice(3))
  }

  history() {
    return this.view?.history?.canGoBack
  }

  // search: results by chapter, highlighted in the pages, cleared when the search is
  async *search(query) {
    if (!this.view) return
    for await (const r of this.view.search({ query })) {
      if (r === 'done') return
      if (r.progress != null) yield { progress: r.progress }
      else if (r.subitems) yield { label: r.label || this.sectionLabels[r.index] || '', items: r.subitems.map((s) => ({ key: s.cfi, excerpt: s.excerpt })) }
    }
  }

  stopSearch() {
    this.view?.clearSearch()
  }

  /** A link to a note opens it over the page; any other link is followed, and Back in the page's menu returns. */
  link(e) {
    // the view follows the link unless told otherwise at once, so the handler is there before any link is clicked
    if (this.book) this.footnotes?.handle(this.book, e)?.catch(() => this.view?.goTo(e.detail.href))
  }

  notes(FootnoteHandler) {
    if (!this.footnotes) {
      this.footnotes = new FootnoteHandler()
      this.footnotes.addEventListener('before-render', (ev) => {
        // the note's view lays out only once it is in the page; it shows when its note is found
        this.mountNote(ev.detail.view)
        const r = ev.detail.view.renderer
        r.setAttribute('flow', 'scrolled')
        r.setAttribute('no-continuous-scroll', '')
        r.setAttribute('margin-top', '0px')
        r.setAttribute('margin-bottom', '0px')
        r.setAttribute('margin-left', '0px')
        r.setAttribute('margin-right', '0px')
        r.setAttribute('gap', '0%')
        r.setAttribute('no-background', '')
        r.setStyles?.(bookCss(this.shell.settings(), this.colours() || THEME_COLOURS.light, this.dark(), getComputedStyle(document.body).fontFamily))
      })
      this.footnotes.addEventListener('render', (ev) => this.showNote(ev.detail))
    }
  }

  mountNote(view) {
    const box = document.createElement('div')
    box.className = 'body'
    box.append(view)
    this.note.replaceChildren(box)
    this.note.style.background = this.colours()?.[0] || ''
    this.note.style.visibility = 'hidden'
    this.note.hidden = false
  }

  showNote({ href }) {
    this.note.querySelector('.bar')?.remove()
    const go = document.createElement('button')
    go.className = 'btn'
    go.textContent = t('reader.links.goToNote')
    go.addEventListener('click', () => {
      this.closeNote()
      this.view?.goTo(href)
    })
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.append(go)
    this.note.append(bar)
    this.note.style.visibility = ''
  }

  closeNote() {
    this.note.hidden = true
    this.note.replaceChildren()
  }

  /** A link out of the book opens in the browser, once Curio has shown where it goes. */
  externalLink(href) {
    this.curio.app.openUrl({ url: href }).catch((e) => this.curio.ui.notify({ text: t('reader.links.cantOpen', { error: e.message || e }), severity: 'error' }))
  }

  async linkMenu(href) {
    const short = href.length > 60 ? `${href.slice(0, 59)}…` : href
    const { id } = await this.curio.ui.menu({ items: [{ id: 'open', label: t('reader.links.open'), icon: 'external-link' }, { id: 'copy', label: t('reader.links.copy', { link: short }), icon: 'copy' }] }).catch(() => ({ id: null }))
    if (id === 'open') this.externalLink(href)
    else if (id === 'copy') await this.curio.clipboard.writeText({ text: href }).then(() => this.curio.ui.notify({ text: t('reader.links.copied') }), () => {})
  }

  saveSoon(now = false) {
    const changed = this.item && rememberedChanges(this.own, this.ownWas)
    this.ownWas = { ...this.own }
    if (changed) this.shell.remember('book', changed)
    clearTimeout(this.saving)
    if (now) this.save()
    else this.saving = setTimeout(() => this.save(), SAVE_MS)
  }

  save(leaving = false) {
    clearTimeout(this.saving)
    if (!this.item) return
    const value = { ...(this.loc?.cfi ? { cfi: this.loc.cfi, fraction: this.loc.fraction } : {}), ...(Object.keys(this.own).length ? { view: this.own } : {}), ...(this.marks.length ? { bookmarks: this.marks } : {}) }
    this.shell.saved(this.item.id, value)
    this.shell.readState.write(leaving)
  }

  /** Title and authors, for the page's title. */
  get title() {
    return lang(this.book?.metadata?.title)
  }
}
