// A book's file opened for whichever reading shows it: read in parts from Curio, refused when it is locked, parsed by foliate-js.
import { RangeFile } from './rangefile.js'
import { t } from './text.js'

export const BOOK_EXTS = ['epub', 'fb2', 'fbz', 'mobi', 'azw3', 'azw', 'prc', 'pdf']
// read whole: FB2 is one XML file, small, and its parser reads it at once
const WHOLE = ['fb2']
// font obfuscation, which isn't a lock on the book
const OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

/** Whether a book is locked: an EPUB whose encryption.xml names more than font obfuscation, or rights.xml from Adobe's DRM; a MOBI with its encryption field set. */
async function locked(curio, item, file, ext) {
  if (ext === 'epub') {
    const list = await curio.archive.list({ id: item.id, sizes: false }).catch(() => null)
    const names = new Set((list?.entries || []).map((e) => e.name))
    if (names.has('META-INF/rights.xml')) return true
    if (!names.has('META-INF/encryption.xml')) return false
    const xml = await curio.archive.entry({ id: item.id, name: 'META-INF/encryption.xml' }).then((b) => b.text()).catch(() => '')
    return [...xml.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/g)].some((m) => !OBFUSCATION.includes(m[1]))
  }
  if (['mobi', 'azw3', 'azw', 'prc'].includes(ext) && file.size > 100) {
    const head = new DataView(await file.slice(0, 86).arrayBuffer())
    const rec0 = head.getUint32(78)
    const enc = new DataView(await file.slice(rec0 + 12, rec0 + 14).arrayBuffer()).getUint16(0)
    return enc !== 0
  }
  return false
}

/** Opens an item's file as a book: { file, book, fixed }, `fixed` for one of pages drawn at a set size (a PDF, a fixed layout EPUB) rather than text that flows. */
export async function openBook(curio, item, it) {
  const ext = (item.ext || '').toLowerCase()
  const { url } = await curio.item.fileUrl({ id: item.id })
  const name = it?.name || `book.${ext}`
  const file = WHOLE.includes(ext) ? new File([await fetch(url).then((r) => r.blob())], name) : await RangeFile.open(url, name, it?.size)
  if (await locked(curio, item, file, ext)) throw new Error(t('reader.drm'))
  const { makeBook } = await import('../vendor/foliate-js/view.js')
  const book = await makeBook(file).catch((e) => {
    throw e?.name === 'PasswordException' ? new Error(t('reader.password')) : e
  })
  return { file, book, fixed: book.rendition?.layout === 'pre-paginated' }
}
