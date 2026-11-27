// The reader's settings as they start; what is chosen while reading is kept over them for each kind of file (reader.js `remember`).
export const DEFAULTS = {
  double: false, cover: true, continuous: false, rtl: false, fit: 'page', gap: 12, wheelTurns: true, pageWidth: 100, budgetMB: 512, enlarge: true,
  zipGrid: true, gridStyle: 'grid', gridSize: 200, readState: true, side: false, sideWidth: 260,
  bookFlow: 'paginated', bookColumns: 'auto', bookTheme: 'curio', bookFont: '', bookSize: 100, bookLineHeight: 1.5, bookAlign: 'justify', bookIndent: 'book', bookParagraph: 'book', bookHyphenate: true, bookMargin: 48, bookPageWidth: 80, bookGap: 6,
}

// a book's margins in px and the gap between its columns in %, in named steps; a gap under the smallest lets one column's text run into the next
export const MARGINS = [24, 48, 80]
export const GAPS = [3, 6, 10]
export const nearest = (steps, v) => steps.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

/** Settings kept by an earlier reader, in today's names. */
export function current(s) {
  const out = { ...DEFAULTS, ...s }
  if (s?.bookAlign == null && s?.bookJustify === false) out.bookAlign = 'start'
  // the book's own alignment is the default's, justified where it says nothing
  if (out.bookAlign === 'book') out.bookAlign = 'justify'
  return out
}
