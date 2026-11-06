import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { loadEnv } from './config/env'
import { createApp } from './app'

// Root .env is the single source of truth; x402-server/.env is an optional override (loaded first, so it wins).
config({ path:'x402-server/.env' })
config({ path:'.env' })
const env = loadEnv()
const app = createApp(env)
serve({ fetch:app.fetch, port:env.X402_SERVER_PORT }, info => {
  console.log(JSON.stringify({level:'info',message:'Finality merchant server listening',port:info.port,network:env.X402_NETWORK,dataMode:env.DATA_MODE}))
})

export { app }
