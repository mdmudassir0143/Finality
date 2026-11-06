import { describe, expect, it } from 'vitest'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import {
  agentRegistryId,
  buildRegistrationFile,
  erc8004Config,
  parseAgentUri,
  readAgent,
  REGISTRATION_TYPE,
  toDataUri,
  toViemPrivateKey,
} from '../../../lib/evm/erc8004'
import type { AgentReader } from '../../routes/erc8004'

const config = erc8004Config('hedera-testnet')!

describe('ERC-8004 helpers', () => {
  it('uses the canonical Hedera testnet registries and agentRegistry format', () => {
    expect(config.identityRegistry).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e')
    expect(agentRegistryId(config)).toBe('eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e')
  })

  it('round-trips an on-chain registration file through a data: URI', () => {
    const file = buildRegistrationFile({
      name: 'Finality', description: 'x402 API', services: [{ name: 'x402', endpoint: 'https://x/.well-known/x402' }],
      x402Support: true, agentId: 144n, agentRegistry: agentRegistryId(config),
    })
    expect(file.type).toBe(REGISTRATION_TYPE)
    expect(file.registrations).toEqual([{ agentId: 144, agentRegistry: 'eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e' }])
    const uri = toDataUri(file)
    expect(uri.startsWith('data:application/json;base64,')).toBe(true)
    expect(parseAgentUri(uri)).toEqual(file)
    expect(parseAgentUri('https://example.com/agent.json')).toBeNull()
  })

  it('accepts raw hex ECDSA keys with or without 0x and rejects DER', () => {
    const hex = 'ab'.repeat(32)
    expect(toViemPrivateKey(hex)).toBe(`0x${hex}`)
    expect(toViemPrivateKey(`0x${hex}`)).toBe(`0x${hex}`)
    expect(() => toViemPrivateKey('3030020100300706052b8104000a04220420' + hex)).toThrow()
  })

  it('averages individual non-revoked feedback values', async () => {
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case 'ownerOf': return '0xBB168355570708002DFe73743AE2E068e298Ca98'
          case 'tokenURI': return 'https://example.com/a.json'
          case 'getAgentWallet': return '0x0000000000000000000000000000000000000000'
          case 'getClients': return ['0x7Ff7fEc31cA0B18D5289400Ca0E12a5315328938']
          case 'readAllFeedback': return [[], [], [100n, 80n], [0, 0], [], [], []]
          default: throw new Error(functionName)
        }
      },
    }
    const profile = await readAgent(config, 144n, client as any)
    expect(profile.reputation).toEqual({ clients: 1, count: 2, average: 90 })
    expect(profile.wallet).toBeNull()
  })
})

describe('ERC-8004 routes and discovery', () => {
  const reader: AgentReader = async (_c, agentId) => ({
    agentId: agentId.toString(), agentRegistry: agentRegistryId(config), owner: '0xBB168355570708002DFe73743AE2E068e298Ca98',
    wallet: null, uri: '', registration: null, reputation: { clients: 0, count: 0, average: null },
  })

  it('reports an unregistered merchant without calling the relay', async () => {
    const app = createApp(testEnv, { payments: false, erc8004Reader: async () => { throw new Error('must not be called') } })
    const body = await (await app.request('/v1/erc8004/merchant')).json() as any
    expect(body.data).toEqual({ registered: false })
  })

  it('looks up agents and validates ids', async () => {
    const app = createApp({ ...testEnv, ERC8004_MERCHANT_AGENT_ID: '144' }, { payments: false, erc8004Reader: reader })
    const merchant = await (await app.request('/v1/erc8004/merchant')).json() as any
    expect(merchant.data).toMatchObject({ registered: true, agentId: '144', ownerUrl: 'https://hashscan.io/testnet/account/0xBB168355570708002DFe73743AE2E068e298Ca98' })
    expect((await app.request('/v1/erc8004/agents/abc')).status).toBe(400)
  })

  it('maps a nonexistent token to 404', async () => {
    const app = createApp(testEnv, { payments: false, erc8004Reader: async () => { throw new Error('ERC721NonexistentToken(999)') } })
    expect((await app.request('/v1/erc8004/agents/999')).status).toBe(404)
  })

  it('advertises the merchant identity in discovery when registered', async () => {
    const app = createApp({ ...testEnv, ERC8004_MERCHANT_AGENT_ID: '144' }, { payments: false, erc8004Reader: reader })
    const wellKnown = await (await app.request('/.well-known/x402')).json() as any
    expect(wellKnown.identity).toMatchObject({ standard: 'ERC-8004', chainId: 296, agentId: 144 })
    const card = await (await app.request('/.well-known/agent-card.json')).json() as any
    expect(card.registrations).toEqual([{ agentId: 144, agentRegistry: 'eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e' }])
    expect(await (await app.request('/llms.txt')).text()).toContain('ERC-8004 agent #144')
  })
})
