import type { Hono } from 'hono'; import type { Env } from '../config/env'; import { registerDomain } from './register'
export const registerMarketRoutes=(app:Hono,env:Env)=>registerDomain(app,env,'market.')
