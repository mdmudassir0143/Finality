import type { Hono } from 'hono'; import type { Env } from '../config/env'; import { registerDomain } from './register'
export const registerAiRoutes=(app:Hono,env:Env)=>registerDomain(app,env,'ai.')
