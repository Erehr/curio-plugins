// The thumbnail page: Curio hands it books and PDFs, a few at a time; it draws the cover or first page as a Blob. Comics' covers, their first page, Curio makes itself.
import { RangeFile } from './rangefile.js'

const curio = Curio.connect()
const FILE_LIMIT = 512 * 1024 * 1024
// a file that never opens (a PDF the engine waits on forever) answers with no picture, rather than holding the page until Curio gives up on it
const COVER_LIMIT_MS = 20000
const inTime = (work) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error('took too long')), COVER_LIMIT_MS))])

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
    picture = await inTime(bookCover(data.fileUrl, ext, data.size || 512))
  } catch (e) {
    curio.plugin.log({ level: 'warn', message: `no cover for ${data.item}: ${e?.message || e}` }).catch(() => {})
  }
  curio.thumbnailDone(data.request, picture)
})
