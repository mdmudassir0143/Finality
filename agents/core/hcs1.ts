/**
 * HCS-1 file encoding (hol.org/docs/standards/hcs-1): sha256 memo, zstd compression, base64, ≤1024-byte chunks
 * `{ "o": index, "c": chunk }`, first chunk prefixed with `data:<mime>;base64,`. Uses Node's built-in zstd, so no
 * inscription service is needed: the file is written straight to a Hedera topic.
 */
import { createHash } from 'node:crypto'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

/** Max bytes of `c` per message, leaving room for the JSON wrapper inside HCS's 1024-byte single-chunk limit. */
const CHUNK = 1000

export type Hcs1File = { memo: string; messages: string[] }

export function encodeHcs1(content: Buffer | string, mimeType: string): Hcs1File {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const payload = `data:${mimeType};base64,${zstdCompressSync(bytes).toString('base64')}`
  const messages: string[] = []
  for (let o = 0, i = 0; i < payload.length; o++, i += CHUNK) messages.push(JSON.stringify({ o, c: payload.slice(i, i + CHUNK) }))
  return { memo: `${hash}:zstd:base64`, messages }
}

/** Reassemble and verify an HCS-1 file from its topic memo and raw message strings (any order). */
export function decodeHcs1(memo: string, messages: string[]): { mimeType: string; content: Buffer } {
  const [hash, algo, encoding] = memo.split(':')
  if (algo !== 'zstd' || encoding !== 'base64') throw new Error(`Unsupported HCS-1 memo ${memo}`)
  const chunks = messages.map((m) => JSON.parse(m) as { o: number; c: string }).sort((a, b) => a.o - b.o)
  const joined = chunks.map((c) => c.c).join('')
  const match = /^data:([^;]+);base64,(.*)$/s.exec(joined)
  if (!match) throw new Error('HCS-1 data is missing its data: prefix')
  const content = zstdDecompressSync(Buffer.from(match[2], 'base64'))
  if (createHash('sha256').update(content).digest('hex') !== hash) throw new Error('HCS-1 hash does not match the topic memo')
  return { mimeType: match[1], content }
}
