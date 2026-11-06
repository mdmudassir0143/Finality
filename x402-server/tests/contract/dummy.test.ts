import { describe,expect,it } from 'vitest'
import { createApp } from '../../app'
import { endpoints } from '../../registry/endpoints'
import { testEnv } from '../helpers'

const app=createApp(testEnv,{payments:false})
describe('deterministic dummy endpoint',()=>{
  for(const endpoint of endpoints) it(endpoint.operationId,async()=>{ const r=await app.request(`/v1/test/dummy?operationId=${encodeURIComponent(endpoint.operationId)}`); const b=await r.json() as any; expect(r.status).toBe(200); expect(b.meta).toMatchObject({dataMode:'mock',synthetic:true,source:'finality-deterministic-fixture'}) })
  it('rejects unknown operations',async()=>expect((await app.request('/v1/test/dummy?operationId=unknown')).status).toBe(404))
  it('is disabled in production',async()=>{ const prod={...testEnv,NODE_ENV:'production' as const,ENABLE_DUMMY_ENDPOINT:false}; expect((await createApp(prod,{payments:false}).request('/v1/test/dummy?operationId=market.quotes')).status).toBe(404) })
})
