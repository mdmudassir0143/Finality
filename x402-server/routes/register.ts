import type { Hono } from 'hono'
import type { Env } from '../config/env'
import { endpoints } from '../registry/endpoints'
import { operationHandler } from '../handlers/operation'

export function registerDomain(app: Hono,env: Env,prefix: string) {
  for(const endpoint of endpoints.filter(v=>v.operationId.startsWith(prefix))) {
    const handler=operationHandler(env,endpoint.operationId)
    if(endpoint.method==='GET') app.get(endpoint.path,handler)
    else app.post(endpoint.path,handler)
  }
}
