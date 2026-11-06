import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHederaTransaction, toMirrorTransactionId } from '../../../lib/onchain/hedera/mirror'
import { requestSchemas } from '../../schemas'

describe('Hedera transaction id normalization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('converts SDK form to Mirror Node form', () => {
    expect(toMirrorTransactionId('0.0.1001@1700000000.123456789')).toBe('0.0.1001-1700000000-123456789')
  })

  it('passes Mirror Node form through and trims whitespace', () => {
    expect(toMirrorTransactionId(' 0.0.9319491-1793919635-805226472 ')).toBe('0.0.9319491-1793919635-805226472')
  })

  it.each(['0.0.1001', 'abc', '0.0.1001@1700000000', '0.0.1001-1700000000.1', '../accounts'])(
    'rejects %s with a 400 invalid_request',
    bad => {
      expect(() => toMirrorTransactionId(bad)).toThrow(expect.objectContaining({ code: 'invalid_request', status: 400 }))
    },
  )

  it('requests the Mirror Node path in dash form', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transactions: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchHederaTransaction({ MIRROR_NODE_URL: 'https://mirror.test/' }, '0.0.1001@1700000000.000000001')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'https://mirror.test/api/v1/transactions/0.0.1001-1700000000-000000001',
    )
  })

  it('schema rejects malformed ids before any upstream call', () => {
    const schema = requestSchemas['onchain.hederaTransaction']
    expect(schema.safeParse({ transactionId: '0.0.1001@1700000000.000000000' }).success).toBe(true)
    expect(schema.safeParse({ transactionId: 'not-a-tx-id' }).success).toBe(false)
  })
})
