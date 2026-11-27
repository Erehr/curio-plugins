// Places to go back to in a comic: its folders as chapters, the pages its ComicInfo.xml names, and the bookmarks the reader sets.
// What makes text takes the page's `t` (text.js).

const COVERS = ['frontcover', 'innercover', 'backcover']
// kept with the item's state, which holds 64 KB
export const MARKS_MAX = 500
export const LABEL_MAX = 120

/** Where each folder's pages start, when the pages are in more than one folder; named by the part of their path the folders don't all share. */
export function folderChapters(names, t) {
  const dirs = names.map((n) => n.slice(0, Math.max(0, n.lastIndexOf('/'))))
  if (new Set(dirs).size < 2) return []
  const starts = []
  for (let p = 0; p < dirs.length; p++) if (p === 0 || dirs[p] !== dirs[p - 1]) starts.push(p)
  const parts = starts.map((p) => (dirs[p] ? dirs[p].split('/') : []))
  const named = parts.filter((x) => x.length)
  // the folders holding all the chapters aren't part of their names, unless a folder is nothing else
  let common = 0
  while (named.length && named.every((x) => x.length > common && x[common] === named[0][common])) common++
  const label = (x) => (x.length > common ? x.slice(common) : x.slice(-1)).join(' / ')
  return starts.map((page, i) => ({ page, label: parts[i].length ? label(parts[i]) : page === 0 ? t('reader.places.frontPages') : t('reader.places.otherPages') }))
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m))

/** ComicInfo.xml's `<Pages>`: the pages with a bookmark (ComicRack and Komga write them) and the covers, by their picture's index. */
export function comicInfoPlaces(xml, count, t) {
  const list = xml.match(/<Pages\b[\s\S]*?<\/Pages>/i)?.[0] || ''
  const out = []
  for (const m of list.matchAll(/<Page\b([^>]*?)\/?>/gi)) {
    const a = {}
    for (const at of m[1].matchAll(/([A-Za-z_:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) a[at[1].toLowerCase()] = unescapeXml(at[3])
    const page = Number(a.image)
    if (!Number.isInteger(page) || page < 0 || page >= count) continue
    const type = a.type?.toLowerCase()
    const label = a.bookmark?.trim() || (COVERS.includes(type) ? t(`reader.places.covers.${type}`) : '')
    if (label) out.push({ page, label: label.slice(0, LABEL_MAX), named: !!a.bookmark?.trim() })
  }
  return out
}

/** A comic's contents in page order: its folders, then ComicInfo's places; a bookmark ComicInfo names takes a folder's place at the same page, a cover only an empty one. */
export function comicContents(names, xml, t) {
  const byPage = new Map(folderChapters(names, t).map((c) => [c.page, c]))
  for (const c of comicInfoPlaces(xml || '', names.length, t)) if (c.named || !byPage.has(c.page)) byPage.set(c.page, { page: c.page, label: c.label })
  return [...byPage.values()].sort((a, b) => a.page - b.page)
}

/** The index of the place in `contents` that `page` is in, or -1 before the first. */
export function placeAt(contents, page) {
  let at = -1
  for (let i = 0; i < contents.length && contents[i].page <= page; i++) at = i
  return at
}

/** Bookmarks as kept, made safe: on pages there are, one per page, in page order. */
export function cleanMarks(list, count) {
  const seen = new Set()
  const out = []
  for (const b of Array.isArray(list) ? list : []) {
    if (!b || !Number.isInteger(b.page) || b.page < 0 || b.page >= count || seen.has(b.page)) continue
    seen.add(b.page)
    out.push({ page: b.page, at: Number(b.at) || 0, ...(typeof b.label === 'string' && b.label.trim() ? { label: b.label.trim().slice(0, LABEL_MAX) } : {}) })
  }
  return out.sort((a, b) => a.page - b.page).slice(0, MARKS_MAX)
}

/** The pages shown (a spread) lose their bookmarks, or the first of them gets one when none has. */
export function toggleMark(marks, pages, at = Date.now()) {
  if (marks.some((b) => pages.includes(b.page))) return marks.filter((b) => !pages.includes(b.page))
  if (marks.length >= MARKS_MAX) return marks
  return [...marks, { page: pages[0], at }].sort((a, b) => a.page - b.page)
}

/** The bookmark after the pages shown, or before them, or null. */
export function nextMark(marks, pages, dir) {
  if (dir > 0) return marks.find((b) => b.page > pages[pages.length - 1]) ?? null
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i].page < pages[0]) return marks[i]
  return null
}

/** A bookmark's name: its own, or the chapter it is in and its page. */
export function markLabel(b, contents, t) {
  if (b.label) return b.label
  const c = placeAt(contents, b.page)
  return c >= 0 ? t('reader.places.inChapter', { chapter: contents[c].label, page: b.page + 1 }) : t('reader.places.page', { page: b.page + 1 })
}

/** What a jump to a bookmark says when there is none, naming the key that makes one as it is bound now. */
export const noMarks = (shell, t) => (shell.keyOf('bookmark') ? t('reader.marks.noneKey', { key: shell.keyOf('bookmark') }) : t('reader.marks.none'))
