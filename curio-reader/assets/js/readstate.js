// Reading status and progress, as fields everyone can sort and filter by: reading once the reader moved on from where it opened, finished at the end.
// Finished and dropped are the reader's own word on a book: reading in one again changes neither, nor how far it was read; the Book widget is where they are taken back.
// Progress is written in steps, so reading doesn't keep every window busy, and at once on leaving.

const PROGRESS_STEP = 5
const SETTLED = ['finished', 'dropped']

export class ReadState {
  /** `enabled()` answers whether the user wants the fields written. */
  constructor(curio, enabled) {
    this.curio = curio
    this.enabled = enabled
    this.r = null
  }

  /** A new item, with the fields it has now. */
  start(id, fields = {}) {
    const state = fields.read_state || ''
    const progress = fields.read_progress ?? null
    this.r = { id, moved: false, state, progress, written: { state, progress } }
  }

  stop() {
    this.r = null
  }

  /** Where the reader is now, in percent, and whether that is the end; `moved` once it left the place it opened at. */
  note(id, { moved, progress, finished }) {
    const r = this.r
    if (!r || r.id !== id) return
    if (moved) r.moved = true
    if (!r.moved || SETTLED.includes(r.state)) return
    r.progress = Math.max(0, Math.min(100, Math.round(progress)))
    r.state = finished ? 'finished' : 'reading'
    this.write(false)
  }

  write(leaving) {
    const r = this.r
    if (!r?.moved || !this.enabled()) return
    const fields = {}
    if (r.state !== r.written.state) fields.read_state = r.state
    if (r.state !== 'finished' && r.progress !== r.written.progress && (leaving || Math.abs(r.progress - (r.written.progress ?? 0)) >= PROGRESS_STEP)) fields.read_progress = r.progress
    if (r.state === 'finished' && r.written.progress !== 100) fields.read_progress = 100
    if (!Object.keys(fields).length) return
    Object.assign(r.written, { state: fields.read_state ?? r.written.state, progress: fields.read_progress ?? r.written.progress })
    this.curio.item.update({ ids: [r.id], fields }).catch(() => {})
  }
}
