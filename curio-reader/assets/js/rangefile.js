// A file read in parts from its address, as foliate-js reads books: zip.js and the MOBI parser only ask for slices, so a large book is never fetched whole.
// Reads are rounded out to blocks that are kept, so zip.js's many small reads of an index or a chapter cost one request.
import { t } from './text.js'

const BLOCK = 64 << 10
const KEPT_BYTES = 32 << 20

export class RangeFile {
  constructor(url, size, name, type = '') {
    this.url = url
    this.size = size
    this.name = name
    this.type = type
    this.blocks = new Map()
    this.requests = 0
  }

  /** The file's size from the server, when Curio didn't say. */
  static async open(url, name, size) {
    if (!size) {
      const r = await fetch(url, { headers: { Range: 'bytes=0-0' } })
      size = Number(r.headers.get('Content-Range')?.split('/')[1]) || Number(r.headers.get('Content-Length')) || 0
      await r.body?.cancel()
    }
    return new RangeFile(url, size, name)
  }

  slice(start = 0, end = this.size) {
    if (start < 0) start = Math.max(0, this.size + start)
    if (end < 0) end = Math.max(0, this.size + end)
    end = Math.min(end, this.size)
    start = Math.min(start, end)
    const file = this
    return {
      size: end - start,
      type: '',
      arrayBuffer: () => file.read(start, end),
      text: async () => new TextDecoder().decode(await file.read(start, end)),
      slice: (a = 0, b = end - start) => file.slice(start + a, start + Math.min(b, end - start)),
    }
  }

  arrayBuffer() {
    return this.read(0, this.size)
  }

  async text() {
    return new TextDecoder().decode(await this.read(0, this.size))
  }

  async read(start, end) {
    const out = new Uint8Array(end - start)
    if (end <= start) return out.buffer
    const first = Math.floor(start / BLOCK)
    const last = Math.floor((end - 1) / BLOCK)
    // missing blocks next to each other come in one request
    const runs = []
    for (let b = first; b <= last; b++) {
      if (this.blocks.has(b)) continue
      if (runs.length && runs[runs.length - 1][1] === b - 1) runs[runs.length - 1][1] = b
      else runs.push([b, b])
    }
    await Promise.all(runs.map(([a, z]) => this.fetchRun(a, z)))
    for (let b = first; b <= last; b++) {
      const data = await this.blocks.get(b)
      // most recently used last, for letting go of the oldest
      this.blocks.delete(b)
      this.blocks.set(b, data)
      const from = Math.max(start, b * BLOCK)
      const to = Math.min(end, (b + 1) * BLOCK)
      out.set(data.subarray(from - b * BLOCK, to - b * BLOCK), from - start)
    }
    this.trim(first, last)
    return out.buffer
  }

  fetchRun(a, z) {
    const from = a * BLOCK
    const to = Math.min(this.size, (z + 1) * BLOCK) - 1
    this.requests++
    const whole = fetch(this.url, { headers: { Range: `bytes=${from}-${to}` } }).then(async (r) => {
      if (!r.ok) throw new Error(t('reader.readFailed', { status: r.status }))
      let bytes = new Uint8Array(await r.arrayBuffer())
      // a server that ignores Range answers the whole file
      if (r.status === 200 && bytes.length > to - from + 1) bytes = bytes.subarray(from, to + 1)
      return bytes
    })
    for (let b = a; b <= z; b++) {
      const p = whole.then((bytes) => bytes.subarray((b - a) * BLOCK, (b - a + 1) * BLOCK))
      this.blocks.set(b, p)
      p.catch(() => this.blocks.delete(b))
    }
    return whole
  }

  trim(first, last) {
    let over = this.blocks.size - KEPT_BYTES / BLOCK
    for (const b of this.blocks.keys()) {
      if (over <= 0) break
      if (b >= first && b <= last) continue
      this.blocks.delete(b)
      over--
    }
  }
}
