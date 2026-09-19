import { describe, expect, it } from 'vitest'
import { toBase64 } from './pdf'

describe('toBase64', () => {
  it('encodes bytes, including buffers larger than one chunk', () => {
    const small = new TextEncoder().encode('%PDF-1.4').buffer
    expect(toBase64(small)).toBe(btoa('%PDF-1.4'))
    const big = new Uint8Array(100_000).fill(65).buffer
    expect(atob(toBase64(big))).toBe('A'.repeat(100_000))
  })
})
