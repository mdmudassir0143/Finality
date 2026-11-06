import { describe,expect,it } from 'vitest'
import { createApp } from '../../app'
import { testEnv } from '../helpers'

const app=createApp(testEnv,{payments:false})
describe('endpoint schemas and envelopes',()=>{
  it('returns a schema-valid mock signal envelope',async()=>{ const r=await app.request('/v1/signals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({symbols:['BTC'],marketType:'crypto',interval:'1h',limit:40})}); const b=await r.json() as any; expect(r.status).toBe(200); expect(b).toMatchObject({success:true,operationId:'intelligence.signals',payment:{network:'hedera-testnet'}}); expect(b.meta?.dataMode).toBeTruthy() })
  it('rejects malformed inputs with stable error envelope',async()=>{ const r=await app.request('/v1/signals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({symbols:[]})}); const b=await r.json() as any; expect(r.status).toBe(400); expect(b).toMatchObject({success:false,error:{code:'invalid_request'}}) })
})
