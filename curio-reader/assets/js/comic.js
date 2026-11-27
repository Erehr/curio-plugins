// A comic or picture archive (CBZ, CB7, ZIP) as a reading: its pictures as pages, what its ComicInfo.xml says of it, and pages copied out into the library.
import { PagesReading, toDataUrl } from './pages.js'
import { PictureSource } from './kinds/picture.js'
import { looksLikeStrip } from './layout.js'
import { comicContents } from './places.js'
import { sizeText, t, tc } from './text.js'

export class Comic extends PagesReading {
  constructor(host, shell) {
    super(host, shell)
    this.what = 'archive'
  }

  /** Opens an archive at its kept page. */
  async open(item, kept) {
    const token = (this.token = {})
    this.item = item
    const id = item.id
    this.shell.side.setTabs(['contents', 'bookmarks', 'pages'])
    const { entries } = await this.curio.archive.list({ id })
    if (token !== this.token) return
    const pictures = entries.filter((e) => e.picture)
    if (!pictures.length) return this.showContents(entries)
    const xml = await this.comicInfo(entries)
    if (token !== this.token) return
    this.found = this.detect(xml, pictures)
    this.contents = comicContents(pictures.map((p) => p.name), xml, t)
    this.begin(new PictureSource(this.curio, id, pictures), kept)
  }

  async comicInfo(entries) {
    const info = entries.find((e) => e.name.split('/').pop().toLowerCase() === 'comicinfo.xml' && e.size < 1 << 20)
    return info ? this.curio.archive.entry({ id: this.item.id, name: info.name }).then((b) => b.text()).catch(() => '') : ''
  }

  get kind() {
    return this.zip ? 'archive' : 'comic'
  }

  get zip() {
    return this.item?.ext?.toLowerCase() === 'zip'
  }

  // a ZIP is a gallery first, until its pages are read
  defaults(s) {
    return this.zip && s.zipGrid ? { ...s, grid: true } : s
  }

  /** A manga reads right to left, as its ComicInfo.xml says; a long strip reads as one column without gaps. */
  detect(xml, pictures) {
    const out = {}
    if (/<Manga>\s*YesAndRightToLeft\s*<\/Manga>/i.test(xml)) out.rtl = true
    if (looksLikeStrip(pictures.filter((p) => p.width && p.height).map((p) => p.width / p.height))) Object.assign(out, { continuous: true, gap: 0, fit: 'width' })
    return out
  }

  /** An archive without pictures: what it holds, as a list. */
  showContents(entries) {
    const list = document.createElement('div')
    list.className = 'contents'
    const head = document.createElement('p')
    head.className = 'faint'
    head.textContent = entries.length ? t('reader.archive.noPictures') : t('reader.archive.empty')
    list.append(head)
    for (const e of entries.slice(0, 2000)) {
      const row = document.createElement('div')
      row.className = 'entry'
      row.innerHTML = '<span></span><span class="faint"></span>'
      row.children[0].textContent = e.name
      row.children[1].textContent = sizeText(e.size)
      list.append(row)
    }
    this.shell.say(list)
    this.shell.setTools({})
  }

  menuItems(page, pages) {
    const many = pages.length > 1
    return [{ id: 'add', label: many ? tc('reader.archive.addMany', pages.length) : t('reader.archive.add'), icon: 'photo-plus' }, ...(many ? [] : [{ id: 'thumb', label: t('reader.thumb.set'), icon: 'photo-star' }])]
  }

  async menuChoice(id, page, pages) {
    const archive = this.item
    const source = this.source
    if (id === 'thumb') {
      const url = await source.urlOf(page, 1024)
      const data = await toDataUrl(await fetch(url).then((r) => r.blob()))
      await this.curio.item.setThumbnail({ ids: [archive.id], data }).then(() => this.curio.ui.notify({ text: t('reader.thumb.done') }), (e) => this.curio.ui.notify({ text: t('reader.thumb.failed', { error: e.message || e }), severity: 'error' }))
    } else if (id === 'add') this.addPages(archive, source, pages)
  }

  /** Pages copied out of the archive as items of their own, in its folders, named after it and their page. */
  async addPages(archive, source, pages) {
    const it = await this.curio.item.get({ id: archive.id }).catch(() => null)
    const stem = (it?.name || archive.name || t('reader.archive.pageName')).replace(/\.[^.]+$/, '')
    const digits = String(source.pages.length).length
    let added = 0
    let had = 0
    for (const p of pages) {
      const name = source.pages[p].name
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
      try {
        const data = await toDataUrl(await this.curio.archive.entry({ id: archive.id, name }))
        const r = await this.curio.item.add.fromBytes({ data, name: `${stem} ${String(p + 1).padStart(digits, '0')}${ext}`, folders: it?.folders || [] })
        // a picture already in the library isn't added twice
        if (r.ids?.length) added++
        else had++
      } catch (e) {
        this.curio.ui.notify({ text: t('reader.archive.addFailed', { page: p + 1, error: e.message || e }), severity: 'error' })
      }
    }
    const text = added && had ? t('reader.archive.addedHad', { added: tc('reader.archive.added', added), had: tc('reader.archive.had', had) }) : added ? tc('reader.archive.added', added) : had ? tc('reader.archive.allHad', had) : ''
    if (text) this.curio.ui.notify({ text })
  }
}
