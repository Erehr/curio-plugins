// An archive's pictures as the surface's pages: their shapes from `archive.list` before any loads, each asked from Curio at the size it shows at.
import { DEFAULT_ASPECT, sizeToAsk } from '../layout.js'

export class PictureSource {
  /** `entries` are the archive's pictures as `archive.list` gives them. */
  constructor(curio, id, entries) {
    this.curio = curio
    this.id = id
    this.pages = entries.map((e) => ({ name: e.name, w: e.width || 0, h: e.height || 0, animated: !!e.animated, aspect: e.width && e.height ? e.width / e.height : DEFAULT_ASPECT, known: !!(e.width && e.height) }))
    this.marks = new Set()
    this.urls = new Map()
  }

  want(p, long) {
    const pg = this.pages[p]
    return sizeToAsk(long, Math.max(pg.w, pg.h), pg.animated) || Infinity
  }

  load(p, want) {
    const im = new Image()
    im.decoding = 'async'
    im.draggable = false
    const scaled = Number.isFinite(want)
    const done = (async () => {
      im.src = await this.urlOf(p, scaled ? want : 0)
      await im.decode()
      const [w, h] = [im.naturalWidth, im.naturalHeight]
      // a size Curio couldn't read ahead (a 7z still unpacking) is the picture's own, unless it came scaled
      return { el: im, bytes: w * h * 4, aspect: w && h ? w / h : 0, ...(scaled ? {} : { w, h }) }
    })()
    return { done, cancel: () => (im.src = '') }
  }

  free(p, im) {
    im.src = ''
  }

  /** A page's address at a size along its longer edge; 0 for the picture as it is. */
  urlOf(p, size) {
    const key = `${p}|${size}`
    if (!this.urls.has(key)) this.urls.set(key, this.curio.archive.entryUrl({ id: this.id, name: this.pages[p].name, ...(size ? { size } : {}) }).then((r) => r.url))
    return this.urls.get(key)
  }
}
