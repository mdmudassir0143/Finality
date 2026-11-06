import type { Hono } from 'hono'
import type { Env } from '../config/env'
import { byOperationId } from '../registry/endpoints'
import { executeOperation } from '../services/operation'

const defaults: Record<string,any> = {
  market:{
    symbols:['BTC'],marketType:'crypto',interval:'1h',limit:20,query:'BTC',
    network:'eth',
    addresses:['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0x6b175474e89094c44da98b954eedeac495271d0f'],
  },
  intelligence:{ symbols:['BTC'],marketType:'crypto',interval:'1h',limit:40,strategy:{fastPeriod:5,slowPeriod:10,initialCapital:10000} },
  agent:{ symbols:['BTC'],marketType:'crypto',interval:'1h',limit:40,risk:'balanced',prompt:'buy when fast 10 crosses above slow 30' }, ai:{symbols:['BTC'],marketType:'crypto',interval:'1h',limit:20,prompt:'Analyze BTC'},
  onchain:{accountId:'0.0.1001',tokenId:'0.0.429274',transactionId:'0.0.1001@1700000000.000000000',topicId:'0.0.1002',limit:10},
}
export function registerTestRoutes(app: Hono, env: Env) {
  app.get('/v1/test/dummy', async c => {
    if (!env.ENABLE_DUMMY_ENDPOINT || env.NODE_ENV === 'production') return c.notFound()
    const operationId = c.req.query('operationId') ?? ''
    if (!byOperationId.has(operationId)) return c.json({success:false,requestId:(c as any).get('requestId'),error:{code:'operation_not_found',message:'Unknown operationId'}},404)
    const domain = operationId.split('.')[0]
    const mockEnv = {...env,DATA_MODE:'mock' as const}
    const result = await executeOperation(mockEnv,operationId,defaults[domain] ?? defaults.intelligence)
    return c.json({success:true,operationId,requestId:(c as any).get('requestId'),data:result.data,meta:{...result.meta,source:'finality-deterministic-fixture',provider:'internal',dataMode:'mock',synthetic:true,fallback:true,fallbackReason:operationId.startsWith('ai.')?'model_unavailable':'upstream_error',limitations:['Test data only; not current market information']}})
  })
}
