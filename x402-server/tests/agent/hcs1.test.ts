import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { decodeHcs1, encodeHcs1 } from '../../../agents/core/hcs1'

describe('HCS-1 file encoding', () => {
  const profile = JSON.stringify({ version: '1.0', type: 1, display_name: 'Finality Intelligence Analyst', bio: 'x'.repeat(5000) })

  it('round-trips with a sha256:zstd:base64 memo and ≤1024-byte messages in any order', () => {
    const file = encodeHcs1(profile, 'application/json')
    expect(file.memo).toBe(`${createHash('sha256').update(profile).digest('hex')}:zstd:base64`)
    expect(file.messages.every((m) => Buffer.byteLength(m) <= 1024)).toBe(true)
    expect(JSON.parse(file.messages[0]).c.startsWith('data:application/json;base64,')).toBe(true)
    const shuffled = [...file.messages].reverse()
    const out = decodeHcs1(file.memo, shuffled)
    expect(out.mimeType).toBe('application/json')
    expect(out.content.toString('utf8')).toBe(profile)
  })

  it('rejects content that does not match the memo hash', () => {
    const file = encodeHcs1(profile, 'application/json')
    const other = encodeHcs1(`${profile} `, 'application/json')
    expect(() => decodeHcs1(file.memo, other.messages)).toThrow(/hash/)
  })
})
