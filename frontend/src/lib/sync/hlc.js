/**
 * The browser's clock. A mirror of `backend/sync/hlc.py`; see that file for why
 * a wall clock alone cannot order two devices' edits.
 *
 * The phone is the device most likely to have a clock that is wrong, and the
 * most likely to have been asleep for a day, which is the case `observe` exists
 * for: a stamp that arrives from ahead carries this clock forward, so the reply
 * to a change sorts after the change rather than under it.
 */

const WALL_DIGITS = 13
const COUNTER_DIGITS = 6
export const SEP = ':'

const pad = (n, width) => String(n).padStart(width, '0')

export function formatStamp(wall, counter, deviceId) {
  return `${pad(wall, WALL_DIGITS)}${SEP}${pad(counter, COUNTER_DIGITS)}${SEP}${deviceId}`
}

export function parse(stamp) {
  const first = stamp.indexOf(SEP)
  const second = stamp.indexOf(SEP, first + 1)
  if (first < 0 || second < 0) throw new Error(`not a stamp: ${stamp}`)
  return {
    wall: Number(stamp.slice(0, first)),
    counter: Number(stamp.slice(first + 1, second)),
    deviceId: stamp.slice(second + 1),
  }
}

/** Does `challenger` replace `incumbent`? A tie does not, so replay is free. */
export function wins(challenger, incumbent) {
  if (!challenger) return false
  if (!incumbent) return true
  return challenger > incumbent
}

export class Clock {
  constructor(deviceId, now = () => Date.now()) {
    if (deviceId.includes(SEP)) throw new Error(`a device id cannot contain ${SEP}`)
    this.deviceId = deviceId
    this.now = now
    this.wall = 0
    this.counter = 0
  }

  tick() {
    const wall = Math.max(this.now(), this.wall)
    if (wall === this.wall) this.counter += 1
    else { this.wall = wall; this.counter = 0 }
    return formatStamp(this.wall, this.counter, this.deviceId)
  }

  observe(stamp) {
    const { wall, counter } = parse(stamp)
    if (wall > this.wall) { this.wall = wall; this.counter = counter }
    else if (wall === this.wall) this.counter = Math.max(this.counter, counter)
    return this.tick()
  }
}
