// Searching a book's sections with foliate-js's matcher, and marking what was found in a section's document as it is shown.
// A result is kept as a CFI within its section, so it is found again in the document a frame shows, which is another copy than the one searched.
import * as CFI from '../vendor/foliate-js/epubcfi.js'
import { textWalker } from '../vendor/foliate-js/text-walker.js'

export const FOUND = 'curio-search'
export const FOUND_AT = 'curio-search-at'
/** What a section's frame needs to show the marks. */
export const FOUND_CSS = `::highlight(${FOUND}) { background-color: rgb(255 208 0 / 0.4); } ::highlight(${FOUND_AT}) { background-color: rgb(255 122 0 / 0.65); }`

/** Searches every section: yields { progress } as it goes and { index, items: [{ cfi, excerpt }] } for a section with results. */
export async function* searchBook(book, query) {
  const { searchMatcher } = await import('../vendor/foliate-js/search.js')
  const lang = book.metadata?.language
  const matcher = searchMatcher(textWalker, { defaultLocale: (Array.isArray(lang) ? lang[0] : lang) || 'en' })
  const { sections } = book
  for (const [index, section] of sections.entries()) {
    if (!section.createDocument) continue
    const doc = await section.createDocument()
    const items = Array.from(matcher(doc, query), (m) => ({ cfi: CFI.fromRange(m.range), excerpt: m.excerpt }))
    yield { progress: (index + 1) / sections.length }
    if (items.length) yield { index, items }
  }
}

/** A CFI within a section as a range in a document showing it, or null. */
export function rangeOf(doc, cfi) {
  try {
    return CFI.toRange(doc, CFI.parse(cfi))
  } catch {
    return null
  }
}

/** Marks ranges in their document under a name; none takes the marks away. */
export function mark(doc, name, ranges) {
  const win = doc.defaultView
  if (!win?.CSS?.highlights) return
  if (ranges.length) win.CSS.highlights.set(name, new win.Highlight(...ranges))
  else win.CSS.highlights.delete(name)
}
