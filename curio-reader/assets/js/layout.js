// Where pages go, worked out from their shapes alone, so the page never measures anything to lay them out.

/** Width over height of a typical comic page, for pages whose size isn't known yet. */
export const DEFAULT_ASPECT = 0.69

/**
 * Pages shown together: one by one, or in pairs with the front and back covers alone, and a wide page alone with the pairing starting again after it.
 * `sides` holds the side of a spread a page asks for, where a book says ('left', 'right', 'center'): a pair is two pages that can sit where they ask, the first of them on the left unless the book reads right to left.
 * `wideAlone` is off for a book whose pages are wide by design and still pair.
 */
export function spreads(aspects, { double = false, cover = true, rtl = false, sides = null, wideAlone = true } = {}) {
  if (!double) return aspects.map((_, i) => [i])
  const out = []
  let i = 0
  if (cover && aspects.length) out.push([i++])
  const end = cover ? aspects.length - 1 : aspects.length
  const [first, second] = rtl ? ['right', 'left'] : ['left', 'right']
  const apart = (a, b) => !!sides && (sides[a] === 'center' || sides[b] === 'center' || sides[a] === second || sides[b] === first)
  while (i < aspects.length) {
    if ((wideAlone && (aspects[i] > 1 || aspects[i + 1] > 1)) || i + 1 >= end || apart(i, i + 1)) {
      out.push([i++])
    } else {
      out.push([i, i + 1])
      i += 2
    }
  }
  return out
}

/** For each page, the spread it is in. */
export function spreadOfPage(groups, count) {
  const at = new Int32Array(count)
  groups.forEach((g, s) => g.forEach((p) => (at[p] = s)))
  return at
}

/** How tall a spread's pages are at a fit, in CSS pixels, each page as tall as the others: within the view (`page`), across it (`width`) or down it (`height`). */
export function rowHeight(aspects, view, fit) {
  const sum = aspects.reduce((a, b) => a + b, 0) || DEFAULT_ASPECT
  const across = view.width / sum
  return fit === 'width' ? across : fit === 'height' ? view.height : Math.min(across, view.height)
}

/**
 * Every spread as a row: its top, height and width, and the whole height, with `gap` above, between and below the rows; `caps` holds a row's greatest height before zooming, for pages kept at their own size.
 * In a column all rows are laid out; paged, only the one shown matters, but the same numbers serve.
 */
export function column(groups, aspects, { width, height, fit = 'width', gap = 0, zoom = 1, maxWidth = Infinity, caps = null }) {
  const view = { width: Math.min(width, maxWidth), height }
  const n = groups.length
  const tops = new Float64Array(n)
  const heights = new Float64Array(n)
  const widths = new Float64Array(n)
  let y = gap
  let widest = 0
  for (let s = 0; s < n; s++) {
    const a = groups[s].map((p) => aspects[p])
    // whole pixels, so a row as wide as the view never spills over it by a fraction and brings a scroll bar
    const h = Math.floor(Math.min(rowHeight(a, view, fit), caps?.[s] ?? Infinity) * zoom)
    tops[s] = y
    heights[s] = h
    widths[s] = a.reduce((x, z) => x + pageWidth(h, z), 0)
    widest = Math.max(widest, widths[s])
    y += h + gap
  }
  return { tops, heights, widths, total: n ? y : 0, widest }
}

export const pageWidth = (h, aspect) => Math.floor(h * aspect)

/** Rows of given heights one under another, as `column` answers them, with `gap` above, between and below; a row of no height takes no gap. */
export function stack(heights, gap = 0) {
  const n = heights.length
  const tops = new Float64Array(n)
  const out = new Float64Array(n)
  let y = gap
  for (let i = 0; i < n; i++) {
    const h = Math.max(0, Math.ceil(heights[i]))
    tops[i] = y
    out[i] = h
    if (h) y += h + gap
  }
  return { tops, heights: out, total: n ? y : 0 }
}

/** The first row whose bottom is below `y`: the row at that height, or the next one after a gap. */
export function rowAt(col, y) {
  let lo = 0
  let hi = col.tops.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (col.tops[mid] + col.heights[mid] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The rows overlapping the span `from` to `to`, as [first, last]. */
export function rowsIn(col, from, to) {
  const first = rowAt(col, from)
  if (first < 0) return [0, -1]
  let last = first
  while (last + 1 < col.tops.length && col.tops[last + 1] < to) last++
  return [first, last]
}

/** Where the view is, so it can be found again after the layout changes: the row at the top and how far into it. */
export function anchorOf(col, scrollTop) {
  const row = Math.max(0, rowAt(col, scrollTop))
  const h = col.heights[row] || 1
  return { row, into: Math.min(1, Math.max(0, (scrollTop - col.tops[row]) / h)) }
}

export function scrollFor(col, anchor) {
  if (!col.tops.length) return 0
  const row = Math.min(anchor.row, col.tops.length - 1)
  return col.tops[row] + anchor.into * col.heights[row]
}

/** Where the view is as a page and how far into its row, which holds when pages pair into other spreads. */
export function pageAnchor(col, groups, scrollTop) {
  const a = anchorOf(col, scrollTop)
  return { page: groups[a.row]?.[0] ?? 0, into: a.into }
}

export function scrollForPage(col, spreadAt, anchor) {
  return scrollFor(col, { row: spreadAt[anchor.page] ?? 0, into: anchor.into })
}

/** The long edge to ask Curio for, in steps so pages shown at nearly the same size share one picture; 0 for the picture as it is. With the size unknown, the step: Curio sends a smaller or animated picture as it is anyway. */
export function sizeToAsk(shownLong, naturalLong, animated) {
  if (animated) return 0
  const step = Math.max(256, Math.ceil(shownLong / 256) * 256)
  return naturalLong && step >= naturalLong ? 0 : step
}

/** A comic drawn to be read in a long strip: most pages more than two and a half times as tall as wide. */
export function looksLikeStrip(aspects) {
  if (aspects.length < 3) return false
  const sorted = [...aspects].sort((a, b) => a - b)
  return sorted[sorted.length >> 1] < 0.4
}

/**
 * Pages as thumbnails across `width`: in cells of `size` (`grid`, each page within its square), in rows `size` tall stretched to the width (`justified`, the last row left as it is), or in columns `size` wide (`masonry`, each page under the shortest column).
 * Answers each page's box and the whole height.
 */
export function thumbs(aspects, { width, size, gap = 8, style = 'grid' }) {
  const n = aspects.length
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const w = new Float64Array(n)
  const h = new Float64Array(n)
  const inner = Math.max(1, width - 2 * gap)
  if (style === 'justified') {
    let top = gap
    let start = 0
    while (start < n) {
      let end = start
      let sum = 0
      while (end < n && (end === start || (sum + aspects[end]) * size + (end - start) * gap <= inner)) sum += aspects[end++]
      const full = end < n
      const rowH = full ? Math.min(size * 2, (inner - (end - start - 1) * gap) / sum) : size
      let left = gap
      for (let i = start; i < end; i++) {
        x[i] = left
        y[i] = top
        w[i] = Math.floor(rowH * aspects[i])
        h[i] = Math.floor(rowH)
        left += w[i] + gap
      }
      top += Math.floor(rowH) + gap
      start = end
    }
    return { x, y, w, h, total: n ? top : 0 }
  }
  const cols = Math.max(1, Math.floor((inner + gap) / (size + gap)))
  const cell = Math.floor((inner - (cols - 1) * gap) / cols)
  if (style === 'masonry') {
    const heights = new Float64Array(cols).fill(gap)
    for (let i = 0; i < n; i++) {
      let c = 0
      for (let k = 1; k < cols; k++) if (heights[k] < heights[c]) c = k
      x[i] = gap + c * (cell + gap)
      y[i] = heights[c]
      w[i] = cell
      h[i] = Math.floor(cell / aspects[i])
      heights[c] += h[i] + gap
    }
    return { x, y, w, h, total: n ? Math.max(...heights) : 0 }
  }
  for (let i = 0; i < n; i++) {
    const a = aspects[i]
    const [pw, ph] = a >= 1 ? [cell, Math.floor(cell / a)] : [Math.floor(cell * a), cell]
    x[i] = gap + (i % cols) * (cell + gap) + (cell - pw) / 2
    y[i] = gap + Math.floor(i / cols) * (cell + gap) + (cell - ph) / 2
    w[i] = pw
    h[i] = ph
  }
  return { x, y, w, h, total: n ? gap + Math.ceil(n / cols) * (cell + gap) : 0 }
}
