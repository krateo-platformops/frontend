/**
 * SHA-256 (FIPS 180-4) over bytes, returned as lower-case hex. Synchronous and dependency-free.
 *
 * WHY NOT `crypto.subtle.digest`: Web Crypto's `subtle` is SECURE-CONTEXT-ONLY, and the portal is
 * routinely reached over plain `http://<LoadBalancer IP>` (see utils.ts `randomId` for the same
 * constraint on `crypto.randomUUID`). There `crypto.subtle` is `undefined`, so a hash the write
 * path depends on cannot come from it. One implementation everywhere, rather than subtle-when-
 * available plus a fallback, keeps a single definition to prove against the published vectors.
 */

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits))

/** Pad per FIPS 180-4 section 5.1.1: 0x80, zeros, then the bit length as a 64-bit big-endian. */
const pad = (message: Uint8Array): DataView => {
  const blocks = Math.ceil((message.length + 9) / 64)
  const padded = new Uint8Array(blocks * 64)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = message.length * 8
  // The high word: lengths past 2^32 bits (512 MiB) — never a confirmed set, but stated correctly.
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)
  return view
}

export const sha256Hex = (message: Uint8Array): string => {
  const view = pad(message)
  const state = Uint32Array.from(INITIAL_STATE)
  const schedule = new Uint32Array(64)

  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let i = 0; i < 16; i++) { schedule[i] = view.getUint32(offset + i * 4) }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(schedule[i - 15], 7) ^ rotr(schedule[i - 15], 18) ^ (schedule[i - 15] >>> 3)
      const s1 = rotr(schedule[i - 2], 17) ^ rotr(schedule[i - 2], 19) ^ (schedule[i - 2] >>> 10)
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0
    }

    let [aa, bb, cc, dd, ee, ff, gg, hh] = state
    for (let i = 0; i < 64; i++) {
      const sum1 = rotr(ee, 6) ^ rotr(ee, 11) ^ rotr(ee, 25)
      const choice = (ee & ff) ^ (~ee & gg)
      const temp1 = (hh + sum1 + choice + ROUND_CONSTANTS[i] + schedule[i]) >>> 0
      const sum0 = rotr(aa, 2) ^ rotr(aa, 13) ^ rotr(aa, 22)
      const majority = (aa & bb) ^ (aa & cc) ^ (bb & cc)
      const temp2 = (sum0 + majority) >>> 0
      hh = gg
      gg = ff
      ff = ee
      ee = (dd + temp1) >>> 0
      dd = cc
      cc = bb
      bb = aa
      aa = (temp1 + temp2) >>> 0
    }
    state[0] += aa
    state[1] += bb
    state[2] += cc
    state[3] += dd
    state[4] += ee
    state[5] += ff
    state[6] += gg
    state[7] += hh
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('')
}

/** SHA-256 of a string's UTF-8 bytes, lower-case hex. */
export const sha256HexOfUtf8 = (text: string): string => sha256Hex(new TextEncoder().encode(text))
