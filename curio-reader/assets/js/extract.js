// The extractor page: Curio hands it comics, PDFs and ebooks one at a time; it reads their pages, words and bibliographic facts.
import { RangeFile } from './rangefile.js'

const curio = Curio.connect()
const MAX_TEXT = 16 * 1024
const FILE_LIMIT = 512 * 1024 * 1024
const BOOK_TEXT_MAX = 64 * 1024 * 1024
const CHARS_PER_PAGE = 1500
const PAGE_LIST_MIN = 10
const ZIP_EOCD_WINDOW = 65557

function capped(s) {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= MAX_TEXT) return s
  return new TextDecoder().decode(bytes.subarray(0, MAX_TEXT)).replace(/\uFFFD+$/, '')
}

const unescape = (s) =>
  String(s)
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

function plainText(html) {
  if (!html) return ''
  let out = ''
  let inTag = false
  for (const c of unescape(html)) {
    if (c === '<') {
      inTag = true
      out += ' '
    } else if (c === '>' && inTag) inTag = false
    else if (!inTag) out += c
  }
  return unescape(out).split(/\s+/).filter(Boolean).join(' ')
}

/** Characters and words of HTML text, markup and <head> left out; runs of whitespace count as one character. */
function measure(html) {
  if (!html) return [0, 0]
  const headEnd = html.indexOf('</head>')
  const body = headEnd >= 0 ? html.slice(headEnd + 7) : html
  let chars = 0
  let words = 0
  let inTag = false
  let space = true
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (inTag) {
      if (c === '>') inTag = false
    } else if (c === '<') {
      inTag = true
    } else if (c <= ' ' || /\s/.test(c)) {
      if (!space) {
        chars++
        space = true
      }
    } else {
      if (space) words++
      space = false
      chars++
    }
  }
  return [chars, words]
}

/** `2019`, `2019-05` or `2019-05-14T…` as a day `published` takes; calibre's 0101 sentinel is ignored. */
function bookDate(s) {
  if (!s) return null
  const t = String(s).trim()
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(t)
  if (!m || m[1] < '1000') return null
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}`
}

/** `D:20190514…` as the day `published` takes. */
function pdfDate(s) {
  if (!s) return null
  const d = String(s).trim().replace(/^D:/, '').slice(0, 8)
  if (/^\d{8}$/.test(d)) return bookDate(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`)
  if (/^\d{4,6}$/.test(d)) return bookDate(d.slice(0, 4))
  return bookDate(s)
}

function isbn(s) {
  if (!s) return null
  const t = String(s).trim().replace(/^urn:/i, '').replace(/^isbn:/i, '').trim()
  if (!/^[0-9xX\- ]+$/.test(t)) return null
  const digits = t.replace(/[^0-9xX]/g, '').toUpperCase()
  if (digits.length !== 10 && digits.length !== 13) return null
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const c = digits[i]
    const d = c === 'X' && digits.length === 10 && i === 9 ? 10 : Number(c)
    if (!Number.isInteger(d)) return null
    sum += digits.length === 10 ? (10 - i) * d : i % 2 === 0 ? d : 3 * d
  }
  return (digits.length === 10 ? sum % 11 === 0 : sum % 10 === 0) ? digits : null
}

function asin(s) {
  if (!s) return null
  const a = String(s).trim().toUpperCase()
  return /^[A-Z0-9]{10}$/.test(a) && (a.startsWith('B') || isbn(a)) ? a : null
}

function identifier(scheme, value) {
  const v = String(value || '').trim()
  if (!v) return null
  const sc = scheme ? String(scheme).trim().toLowerCase() : ''
  if (!sc) {
    if (/^urn:isbn:/i.test(v)) {
      const i = isbn(v.slice(9))
      return i ? ['isbn', i] : null
    }
    if (/^https?:\/\//i.test(v)) return ['uri', v]
    const colon = v.indexOf(':')
    if (colon > 0 && colon <= 20 && /^[a-z0-9_-]+$/i.test(v.slice(0, colon))) {
      const prefix = v.slice(0, colon)
      return prefix.toLowerCase() === 'urn' ? null : identifier(prefix, v.slice(colon + 1))
    }
    const i = isbn(v)
    return i ? ['isbn', i] : null
  }
  if (sc === 'uuid' || sc === 'calibre' || sc === 'uid') return null
  if (sc === 'isbn') {
    const i = isbn(v)
    return i ? ['isbn', i] : null
  }
  if (sc === 'amazon' || sc === 'asin' || sc === 'mobi-asin') {
    const a = asin(v)
    return a ? ['amazon', a] : null
  }
  return v.length <= 200 && !v.includes(',') ? [sc, v] : null
}

function identifiersText(pairs) {
  const FIRST = ['isbn', 'amazon', 'goodreads', 'google']
  const rank = (s) => {
    const i = FIRST.indexOf(s)
    return i < 0 ? FIRST.length : i
  }
  const seen = new Set()
  const unique = []
  for (const p of pairs) {
    if (!p) continue
    const key = `${p[0]}:${p[1]}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }
  unique.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  return unique.length ? unique.map(([s, v]) => `${s}:${v}`).join(', ') : null
}

const langText = (x) => (!x ? '' : typeof x === 'string' ? x : typeof x === 'object' ? Object.values(x).find((v) => typeof v === 'string' && v.trim()) || '' : String(x))
const nameOf = (x) => (!x ? '' : typeof x === 'string' ? x : langText(x.name ?? x.label ?? x.value ?? x))
const listOf = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])

function builder() {
  const out = {}
  const text = (k, v) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && !(k in out)) out[k] = capped(s)
  }
  const num = (k, v) => {
    const n = Number(v)
    if (Number.isFinite(n) && !(k in out)) out[k] = n
  }
  const list = (k, arr) => {
    const clean = arr.map((x) => String(x || '').trim()).filter(Boolean).map(capped)
    if (clean.length && !(k in out)) out[k] = clean
  }
  return { out, text, num, list }
}

// ------------------------------------------------------------------ comics (CBZ / CB7)

async function zipComment(url, size) {
  if (!size || size < 22) return ''
  const start = Math.max(0, size - ZIP_EOCD_WINDOW)
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${size - 1}` } })
  if (!r.ok) return ''
  const b = new Uint8Array(await r.arrayBuffer())
  const buf = r.status === 206 ? b : b.subarray(start, size)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue
    const len = dv.getUint16(i + 20, true)
    if (i + 22 + len <= buf.length) return new TextDecoder().decode(buf.subarray(i + 22, i + 22 + len))
  }
  return ''
}

function parseComicInfo(xml, put) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (!root || root.querySelector('parsererror')) return
  const get = (tag) => {
    for (const c of root.children) if (c.localName === tag) return c.textContent?.trim() || ''
    return ''
  }
  put.text('title', get('Title'))
  put.text('series', get('Series'))
  const n = get('Number')
  if (n && Number.isFinite(Number(n))) put.num('series_index', Number(n))
  const author = ['Writer', 'Penciller', 'Artist'].map(get).find(Boolean)
  if (author) put.text('author', author)
  put.text('publisher', get('Publisher'))
  const year = get('Year')
  if (/^\d{4}$/.test(year)) {
    const two = (k) => {
      const v = parseInt(get(k), 10)
      return v >= 1 && v <= 31 ? String(v).padStart(2, '0') : '01'
    }
    put.text('published', `${year}-${two('Month')}-${two('Day')}`)
  }
  put.text('language', get('LanguageISO'))
  const genre = get('Genre')
  if (genre) put.list('genre', genre.split(','))
  put.text('__annotation', get('Summary'))
  const web = get('Web').split(/\s+/)[0] || ''
  if (/^https?:\/\//i.test(web)) put.text('__source_url', web)
}

function parseComicBookInfo(comment, put) {
  let v
  try {
    v = JSON.parse(comment.trim())
  } catch {
    return
  }
  const c = v?.['ComicBookInfo/1.0']
  if (!c || typeof c !== 'object') return
  const s = (k) => (typeof c[k] === 'string' ? c[k] : typeof c[k] === 'number' ? String(c[k]) : '')
  put.text('title', s('title'))
  put.text('series', s('series'))
  const issue = typeof c.issue === 'number' ? c.issue : typeof c.issue === 'string' ? Number(c.issue.trim()) : NaN
  if (Number.isFinite(issue)) put.num('series_index', issue)
  const credits = Array.isArray(c.credits) ? c.credits : []
  const byRole = (role) => credits.filter((p) => String(p?.role || '').toLowerCase() === role.toLowerCase()).map((p) => p?.person).filter((x) => typeof x === 'string' && x.trim())
  const writers = ['Writer', 'Penciller', 'Artist'].map(byRole).find((w) => w.length) || []
  if (writers.length) put.text('author', writers.join(', '))
  put.text('publisher', s('publisher'))
  if (Number.isInteger(c.publicationYear) && c.publicationYear >= 1000 && c.publicationYear < 10000) {
    const m = Number.isInteger(c.publicationMonth) && c.publicationMonth >= 1 && c.publicationMonth <= 12 ? c.publicationMonth : 1
    put.text('published', `${c.publicationYear}-${String(m).padStart(2, '0')}-01`)
  }
  put.text('language', s('language'))
  const g = s('genre')
  if (g) put.list('genre', g.split(','))
  put.text('__annotation', s('comments'))
}

async function readComic(data) {
  const { entries } = await curio.archive.list({ id: data.item })
  const put = builder()
  put.num('pages', (entries || []).filter((e) => e.picture).length)
  const info = (entries || []).find((e) => e.name.split('/').pop().toLowerCase() === 'comicinfo.xml' && e.size < 4 * 1024 * 1024)
  if (info) {
    const xml = await curio.archive.entry({ id: data.item, name: info.name }).then((b) => b.text()).catch(() => '')
    if (xml) parseComicInfo(xml, put)
  }
  if (data.ext.toLowerCase() === 'cbz') {
    const comment = await zipComment(data.fileUrl, data.size).catch(() => '')
    if (comment) parseComicBookInfo(comment, put)
  }
  return put.out
}

// ------------------------------------------------------------------ books and PDFs

function applyCommonMeta(m, put, ids) {
  if (!m) return
  put.text('title', langText(m.title))
  const authors = listOf(m.author).map(nameOf).map((s) => s.trim()).filter(Boolean)
  if (authors.length) put.text('author', authors.join(', '))
  put.text('publisher', nameOf(m.publisher))
  put.text('published', bookDate(m.published))
  const langs = listOf(m.language).map(langText).map((s) => s.trim()).filter(Boolean)
  if (langs.length) put.text('language', langs[0])
  const subjects = listOf(m.subject).map(nameOf).flatMap((s) => s.split(';')).map((s) => s.trim()).filter(Boolean)
  if (subjects.length) put.list('genre', subjects)
  const series = listOf(m.belongsTo?.series ?? m.belongsTo?.collection).find((s) => nameOf(s))
  if (series) {
    put.text('series', nameOf(series))
    const pos = Number(series.position)
    if (Number.isFinite(pos)) put.num('series_index', pos)
  }
  put.text('__annotation', plainText(langText(m.description)))
  for (const alt of listOf(m.altIdentifier)) {
    const pair = typeof alt === 'string' ? identifier(null, alt) : identifier(alt?.scheme, alt?.value ?? alt?.id)
    if (pair) ids.push(pair)
  }
  if (m.identifier) {
    const pair = identifier(null, m.identifier)
    if (pair) ids.push(pair)
  }
}

async function measureBookSections(book) {
  let chars = 0
  let words = 0
  let read = 0
  for (const s of book.sections || []) {
    if (read > BOOK_TEXT_MAX) break
    let html = ''
    try {
      if (book.loadBlob && s.id) {
        const blob = await book.loadBlob(s.id)
        if (blob) html = await blob.text()
      } else if (s.createDocument) {
        const doc = await s.createDocument()
        html = doc?.body?.textContent || doc?.documentElement?.textContent || ''
      } else if (s.load) {
        const url = await s.load()
        if (typeof url === 'string') {
          html = await fetch(url).then((r) => r.text())
          s.unload?.()
        }
      }
    } catch {
      continue
    }
    if (!html) continue
    read += html.length
    const [c, w] = measure(html)
    chars += c
    words += w
  }
  return [chars, words]
}

async function readBook(data) {
  const ext = data.ext.toLowerCase()
  if (data.size > FILE_LIMIT) return {}
  const name = data.name || `book.${ext}`
  let file
  if (ext === 'fb2') {
    const r = await fetch(data.fileUrl)
    if (!r.ok) throw new Error(`The file can't be read (${r.status})`)
    file = new File([await r.blob()], name)
  } else {
    file = await RangeFile.open(data.fileUrl, name, data.size)
  }
  const { makeBook } = await import('../vendor/foliate-js/view.js')
  const book = await makeBook(file)
  const put = builder()
  const ids = []
  try {
    applyCommonMeta(book.metadata, put, ids)
    if (ext === 'pdf') {
      if (book.pdf?.numPages > 0) put.num('pages', book.pdf.numPages)
      const meta = await book.pdf?.getMetadata?.().catch(() => null)
      const info = meta?.info || {}
      const xmp = meta?.metadata
      if (info.Keywords && !('genre' in put.out)) put.list('genre', String(info.Keywords).split(/[,;]/))
      put.text('published', pdfDate(info.CreationDate) || bookDate(xmp?.get?.('xmp:createdate')))
      put.text('language', xmp?.get?.('dc:language'))
    } else if (ext === 'epub') {
      const rawCols = book.metadata?.calibreColumns
      const cols = Array.isArray(rawCols) ? Object.fromEntries(rawCols.map((c) => [c.key, c])) : rawCols || {}
      const colNum = (k) => {
        const v = Number(cols[k]?.value ?? cols[k])
        return Number.isFinite(v) && v >= 1 ? Math.round(v) : null
      }
      const calPages = colNum('#pages')
      const calWords = colNum('#words')
      const fixed = book.rendition?.layout === 'pre-paginated'
      const pageListLen = Array.isArray(book.pageList) && book.pageList.length >= PAGE_LIST_MIN ? book.pageList.length : null
      let chars = 0
      let words = 0
      if (!calPages || !calWords) [chars, words] = await measureBookSections(book)
      const pages = calPages ?? (fixed ? book.sections?.length || null : null) ?? pageListLen ?? (words > 0 ? Math.ceil(chars / CHARS_PER_PAGE) : null)
      const finalWords = calWords ?? (words > 0 ? words : null)
      if (pages) put.num('pages', pages)
      if (finalWords) put.num('words', finalWords)
    } else if (ext === 'fb2' || ext === 'fbz') {
      // FB2 stores ISBN and publication year under <publish-info>, which foliate-js omits from metadata
      const rawXml = ext === 'fb2' ? await file.text() : ''
      if (rawXml) {
        const doc = new DOMParser().parseFromString(rawXml, 'application/xml')
        const pub = doc.querySelector('publish-info')
        if (pub) {
          const i = isbn(pub.querySelector('isbn')?.textContent)
          if (i) ids.push(['isbn', i])
          put.text('published', bookDate(pub.querySelector('year')?.textContent))
        }
      }
      const [chars, words] = await measureBookSections(book)
      if (words > 0) {
        put.num('pages', Math.ceil(chars / CHARS_PER_PAGE))
        put.num('words', words)
      }
    } else if (['mobi', 'azw3', 'azw', 'prc'].includes(ext)) {
      const exth = book.mobi?.headers?.exth || book.headers?.exth
      for (const raw of listOf(exth?.isbn)) {
        const i = isbn(raw)
        if (i) ids.push(['isbn', i])
      }
      for (const raw of [...listOf(exth?.asin), ...listOf(exth?.asin2)]) {
        const a = asin(raw)
        if (a) ids.push(['amazon', a])
      }
      const [chars, words] = await measureBookSections(book)
      if (words > 0) {
        put.num('pages', Math.ceil(chars / CHARS_PER_PAGE))
        put.num('words', words)
      }
    }
    const foundIsbn = ids.find(([s]) => s === 'isbn')?.[1]
    if (foundIsbn) put.text('isbn', foundIsbn)
    const idText = identifiersText(ids)
    if (idText) put.text('identifiers', idText)
    return put.out
  } finally {
    book.destroy?.()
  }
}

curio.on('plugin.extract', async ({ data }) => {
  try {
    const read = data.reader.endsWith('/comics') ? await readComic(data) : await readBook(data)
    curio.extractDone(data.request, read)
  } catch (e) {
    curio.extractDone(data.request, null, e?.message || String(e))
  }
})
