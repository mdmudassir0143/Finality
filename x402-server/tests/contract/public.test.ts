import { describe,expect,it } from 'vitest'
import { createApp } from '../../app'
import { endpoints } from '../../registry/endpoints'
import { testEnv } from '../helpers'
import { loadEnv } from '../../config/env'

const app = createApp(testEnv,{payments:false})
describe('public merchant contract',()=>{
  it('reports health without secrets',async()=>{ const r=await app.request('/health'); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({status:'ok',service:'Finality Market Intelligence'}) })
  it('publishes every product operation in catalog',async()=>{ const r=await app.request('/v1/catalog'); const body=await r.json() as any; expect(body.data).toHaveLength(endpoints.length); expect(body.data.some((v:any)=>v.operationId==='test.dummy')).toBe(false) })
  it('publishes OpenAPI',async()=>{ const r=await app.request('/v1/openapi.json'); const body=await r.json() as any; expect(body.openapi).toBe('3.1.0'); expect(body.paths['/v1/signals'].post.operationId).toBe('intelligence.signals') })
})

describe('network-aware discovery', () => {
  const mainnetEnv = loadEnv({
    NODE_ENV: 'test',
    DATA_MODE: 'mock',
    X402_PAYTO_ADDRESS: '0.0.777',
    X402_NETWORK: 'hedera-mainnet',
    X402_FACILITATOR_URL: 'https://api.blocky402.com',
    X402_USD_PER_HBAR: '0.25',
  })
  const mainnetApp = createApp(mainnetEnv, { payments: false })

  it('advertises Hedera mainnet, mainnet USDC and numeric tinybar amounts', async () => {
    const body = await (await mainnetApp.request('/.well-known/x402')).json() as any
    expect(body.network).toBe('hedera:mainnet')
    expect(body.facilitator).toBe('https://api.blocky402.com')
    const usdc = body.resources.filter((r: any) => r.asset === '0.0.456858')
    const hbar = body.resources.filter((r: any) => r.asset === '0.0.0')
    expect(usdc).toHaveLength(endpoints.length)
    expect(hbar).toHaveLength(endpoints.length)
    for (const r of body.resources) {
      expect(r.network).toBe('hedera:mainnet')
      expect(r.payTo).toBe('0.0.777')
      expect(r.amount).toMatch(/^\d+$/)
    }
    // $0.10 at 0.25 USD/HBAR = 0.4 HBAR = 40,000,000 tinybars
    const supply = hbar.find((r: any) => r.url.endsWith('/v1/onchain/hedera/network/supply'))
    expect(supply.amount).toBe('40000000')
  })

  it('labels llms.txt and agent.json with the configured network', async () => {
    const llms = await (await mainnetApp.request('/llms.txt')).text()
    expect(llms).toContain('Hedera mainnet (hedera:mainnet)')
    expect(llms).toContain('PayTo: 0.0.777')
    const manifest = await (await mainnetApp.request('/.well-known/agent.json')).json() as any
    expect(manifest.payments).toMatchObject({ network: 'hedera-mainnet', usdcTokenId: '0.0.456858', payTo: '0.0.777' })
  })

  it('keeps Hedera testnet defaults for the test env', async () => {
    const body = await (await app.request('/.well-known/x402')).json() as any
    expect(body.network).toBe('hedera:testnet')
    expect(body.resources.every((r: any) => r.payTo === '0.0.1001')).toBe(true)
  })
})
