// Turning pages with the wheel: the first notch of a spin turns at once, and each notch after it turns one more, so a long spin flips through many pages.
const NOTCH_PX = 100
const LINE_PX = 40
// a pause this long starts a new spin
const IDLE_MS = 200

export class WheelTurns {
  constructor() {
    this.sum = 0
    this.at = 0
    this.dir = 0
  }

  /** Feeds a wheel event already known to turn pages; `turn(dir)` is called for each page turned. */
  feed(e, turn, page = 800) {
    const px = Math.abs(e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? e.deltaY * page : e.deltaY)
    const dir = Math.sign(e.deltaY)
    if (!dir) return
    const now = performance.now()
    const fresh = now - this.at > IDLE_MS || dir !== this.dir
    this.at = now
    this.dir = dir
    if (fresh) {
      this.sum = 0
      turn(dir)
      return
    }
    this.sum += px
    while (this.sum >= NOTCH_PX) {
      this.sum -= NOTCH_PX
      if (turn(dir) === false) return (this.sum = 0)
    }
  }

  reset() {
    this.sum = 0
    this.at = 0
  }
}
