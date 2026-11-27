// The extractor page: Curio hands it pictures and model files one at a time; pictures are read from their PNG text and EXIF through the API, models from the files grouped into them and their own header.
import { fromExif, fromTextChunks } from './pictures.js'
import { readModel } from './models.js'

const curio = Curio.connect()

// the longest text kept, in bytes: a long text slows every field filter
const MAX_TEXT = 16 * 1024

function capped(s) {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= MAX_TEXT) return s
  return new TextDecoder().decode(bytes.subarray(0, MAX_TEXT)).replace(/�+$/, '')
}

const answer = (v) => (typeof v === 'string' ? capped(v) : Array.isArray(v) ? v.map(answer) : v)

/** The values as Curio takes them, the first of each key kept. */
function values(pairs) {
  const out = {}
  for (const [k, v] of pairs) if (!(k in out)) out[k] = answer(v)
  return out
}

async function pictures(data) {
  const pairs = []
  if (data.ext.toLowerCase() === 'png') {
    const { chunks } = await curio.call('item.pngText', { id: data.item })
    pairs.push(...fromTextChunks(chunks))
  }
  const { tags } = await curio.call('item.exif', { id: data.item })
  pairs.push(...fromExif(tags))
  return values(pairs)
}

curio.on('plugin.extract', async ({ data }) => {
  try {
    const read = data.reader.endsWith('/models') ? values(Object.entries(await readModel(data))) : await pictures(data)
    curio.extractDone(data.request, read)
  } catch (e) {
    curio.extractDone(data.request, null, e?.message || String(e))
  }
})
