// The thumbnail page: Curio hands it books, PDFs and comics one at a time; it draws the cover or first page as a Blob.
import { RangeFile } from './rangefile.js'

const curio = Curio.connect()
const COMIC_EXTS = new Set(['cbz', 'cb7'])
const FILE_LIMIT = 512 * 1024 * 1024
// a file that never opens (a PDF the engine waits on forever) answers with no picture, rather than holding the page until Curio gives up on it
const COVER_LIMIT_MS = 20000
const inTime = (work) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error('took too long')), COVER_LIMIT_MS))])

async function comicCover(item, size) {
  // the names are enough: each picture's size would be a read of its own, hundreds of them in a comic
  const { entries } = await curio.archive.list({ id: item, sizes: false })
  const first = (entries || []).find((e) => e.picture)
  if (!first) return null
  const { url } = await curio.archive.entryUrl({ id: item, name: first.name, size })
  const r = await fetch(url)
  return r.ok ? await r.blob() : null
}

async function bookCover(fileUrl, ext, size) {
  const name = `book.${ext}`
  let file
  if (ext === 'fb2') {
    const r = await fetch(fileUrl)
    if (!r.ok) return null
    file = new File([await r.blob()], name)
  } else {
    file = await RangeFile.open(fileUrl, name)
    if (file.size > FILE_LIMIT) return null
  }
  const { makeBook } = await import('../vendor/foliate-js/view.js')
  const book = await makeBook(file)
  try {
    if (ext === 'pdf' && book.getPageThumbnail) return await book.getPageThumbnail(0, size)
    return (await book.getCover?.()) ?? null
  } finally {
    book.destroy?.()
  }
}

curio.on('plugin.thumbnail', async ({ data }) => {
  let picture = null
  try {
    const ext = String(data.ext || '').toLowerCase()
    picture = await inTime(COMIC_EXTS.has(ext) ? comicCover(data.item, data.size || 512) : bookCover(data.fileUrl, ext, data.size || 512))
  } catch (e) {
    curio.plugin.log({ level: 'warn', message: `no cover for ${data.item}: ${e?.message || e}` }).catch(() => {})
  }
  curio.thumbnailDone(data.request, picture)
})
