/**
 * End-to-end wallet test: headless Chrome drives the Finality UI while a real WalletConnect test wallet
 * (HederaWeb3Wallet from @hashgraph/hedera-wallet-connect, i.e. the wallet side HashPack implements) pairs with it,
 * approves the session and answers hedera_signTransaction with the testnet agent key.
 *
 * Flow: connect → pay (HBAR) → disconnect → reconnect-must-not-be-silent.
 * Usage (merchant + frontend running):  npm run test:wallet:e2e
 * Env: X402_TEST_PAYER_ACCOUNT_ID, X402_TEST_PAYER_PRIVATE_KEY, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (from .env);
 *      optional APP_URL (default http://localhost:3000/explore/run), ASSET (HBAR|USDC), CHROME_PATH.
 * Each run settles one real testnet payment from the test payer account.
 */
import { spawn } from 'node:child_process'
import { HederaChainId, Wallet as HederaWeb3Wallet } from '@hashgraph/hedera-wallet-connect'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHederaPrivateKey } from '../lib/hedera/keys'

const APP = process.env.APP_URL ?? 'http://localhost:3000/explore/run'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PROFILE = process.env.CDP_PROFILE ?? mkdtempSync(join(tmpdir(), 'finality-e2e-'))
const ASSET = process.env.ASSET ?? 'HBAR'
const agent = process.env.X402_TEST_PAYER_ACCOUNT_ID!
const keyDer = parseHederaPrivateKey(process.env.X402_TEST_PAYER_PRIVATE_KEY!).toStringDer()
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
let chromePid = 0
const killChrome = () => { try { if (chromePid) process.kill(-chromePid, 'SIGKILL') } catch { /* already gone */ } }
process.on('exit', killChrome)
const say = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

async function main() {
  // ---------- browser ----------
  const port = 9334
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })
  chromePid = chrome.pid ?? 0
  let targets: any[] = []
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(250) }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  const appLogs: string[] = []
  const waiters: Array<{ re: RegExp; resolve: (s: string) => void }> = []
  ws.addEventListener('message', (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); return }
    let line: string | null = null
    if (msg.method === 'Runtime.consoleAPICalled') {
      line = `[${msg.params.type}] ` + msg.params.args.map((a: any) => a.value ?? (a.preview ? JSON.stringify(Object.fromEntries((a.preview.properties ?? []).map((p: any) => [p.name, p.value]))) : a.description) ?? a.type).join(' ')
    } else if (msg.method === 'Runtime.exceptionThrown') {
      line = `[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`
    }
    if (!line) return
    appLogs.push(line)
    if (/finality-wallet|exception|\[error\]/.test(line) && !/pairing uri/.test(line)) say('PAGE', line.slice(0, 260))
    for (const w of [...waiters]) if (w.re.test(line)) { w.resolve(line); waiters.splice(waiters.indexOf(w), 1) }
  })
  const waitLog = (re: RegExp, ms: number) => {
    const hit = appLogs.find((l) => re.test(l))
    if (hit) return Promise.resolve(hit)
    return Promise.race([
      new Promise<string>((resolve) => waiters.push({ re, resolve })),
      sleep(ms).then(() => { throw new Error(`timeout waiting for ${re}`) }),
    ])
  }
  const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value
  const clickButton = (re: string) => evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => ${re}.test(b.innerText)); if (b) b.click(); return b ? b.innerText : null })()`)
  const buttons = () => evaluate(`Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean).slice(0, 10).join(' | ')`)
  // Click an element inside AppKit's shadow DOM by its visible text.
  const clickModalText = (text: string) => evaluate(`(() => {
    const deep = (n) => { const s = []; const w = (x) => { if (!x) return; if (x.nodeType === 3) s.push(x.textContent); if (x.shadowRoot) w(x.shadowRoot); for (const c of x.childNodes || []) w(c) }; w(n); return s.join('').trim() };
    const all = []; const walk = (n) => { if (!n) return; if (n.nodeType === 1) { all.push(n); if (n.shadowRoot) walk(n.shadowRoot) } for (const c of n.childNodes || []) walk(c) };
    walk(document.querySelector('w3m-modal'));
    const cands = all.filter(e => /^(WUI-|BUTTON)/i.test(e.tagName) && deep(e).includes(${JSON.stringify(text)}) && deep(e).length < 60);
    cands.sort((a, b) => deep(a).length - deep(b).length);
    const target = cands.find(e => /LIST|BUTTON/i.test(e.tagName)) || cands[0] || null;
    if (target) target.click(); return target ? target.tagName + ':' + deep(target) : null })()`)
  const pageText = () => evaluate(`document.body.innerText.slice(0, 4000)`)

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: APP })
  await sleep(3000)
  await evaluate(`localStorage.setItem('finality:debug', '1')`)
  appLogs.length = 0
  await send('Page.reload')
  await waitLog(/wallet kit ready/, 30000)
  await sleep(2000)
  say('STEP 1 kit ready; buttons:', await buttons())

  // ---------- test wallet ----------
  const wallet = await HederaWeb3Wallet.create(projectId, {
    name: 'Finality E2E test wallet', description: 'headless', url: 'https://localhost', icons: [],
  }, [HederaChainId.Testnet])
  const hederaWallet = wallet.getHederaWallet(HederaChainId.Testnet, agent, keyDer)
  let signRequests = 0
  let proposals = 0
  wallet.on('session_proposal', async (proposal) => {
    proposals++
    say('WALLET session_proposal → approve', `hedera:testnet:${agent}`)
    await wallet.buildAndApproveSession([`hedera:testnet:${agent}`], proposal)
  })
  wallet.on('session_request', async (event) => {
    signRequests++
    say('WALLET session_request', event.params.request.method)
    try { await wallet.executeSessionRequest(event, hederaWallet) } catch (e) { say('WALLET request failed', String(e)) }
  })
  wallet.on('session_delete', () => say('WALLET session_delete received (dApp disconnected)'))

  // ---------- 1. connect ----------
  await clickButton('/connect wallet/i'); await sleep(500); await clickButton('/^HashPack/')
  await sleep(2500)
  say('modal click WalletConnect →', await clickModalText('WalletConnect'))
  const uriLine = await waitLog(/pairing uri/, 20000)
  const uri = uriLine.match(/wc:[^\s"]+/)![0]
  say('STEP 2 got pairing uri; wallet pairing…')
  await wallet.pair({ uri })
  await waitLog(new RegExp(`account hedera:testnet:${agent.replace(/\./g, '\\.')}`), 30000)
  await sleep(3000)
  say('STEP 3 connected; buttons:', await buttons())

  // ---------- 2. pay ----------
  await evaluate(`(() => { const set = (sel, val) => { const el = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === val)); if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); return true };
    return [set(0, 'onchain.hederaNetworkSupply'), set(0, ${JSON.stringify(ASSET)})] })()`)
  await sleep(1500)
  // The Run page shows the asset as a USDC / HBAR toggle (buttons) for HashPack sessions.
  say('asset toggle →', await clickButton(`/^\\s*${ASSET}\\s*$/`))
  await sleep(500)
  say('STEP 4 click Pay →', await clickButton(`/^\\s*pay\\b.*${ASSET}/i`))
  const outcome = await Promise.race([
    waitLog(/signature received/, 90000).then(() => 'signed'),
    waitLog(/signature failed/, 90000).then((l) => `sign failed: ${l}`),
  ]).catch((e) => String(e))
  say('sign outcome:', outcome, '| wallet sign requests:', signRequests)
  await sleep(12000)
  const text = (await pageText()) as string
  const err = text.match(/(The wallet did not respond[^\n]*|invalid_[a-z_]+[^\n]*|Request failed[^\n]*|Connect a wallet[^\n]*|x402 on Hedera settles[^\n]*)/)
  say('STEP 5 page after pay:', err ? `ERROR → ${err[0]}` : /settled|SETTLED|receipt|released_supply/i.test(text) ? 'OK (result/receipt shown)' : text.slice(0, 300).replace(/\n/g, ' / '))

  // ---------- 3. disconnect ----------
  say('open menu →', await clickButton(`new RegExp(${JSON.stringify(agent.replace(/\./g, '\\.'))})`))
  await sleep(800)
  say('STEP 6 click Disconnect →', await clickButton('/^disconnect$/i'))
  await waitLog(/disconnected \(session and pairings cleared\)/, 20000).catch((e) => say(String(e)))
  await sleep(3000)
  say('after disconnect buttons:', await buttons())

  // ---------- 4. reconnect must not be silent ----------
  const mark = appLogs.length
  await clickButton('/connect wallet/i'); await sleep(500); await clickButton('/^HashPack/')
  await sleep(6000)
  const silent = appLogs.slice(mark).some((l) => new RegExp(`account hedera:testnet:${agent.replace(/\./g, '\\.')}`).test(l))
  say('STEP 7 after Connect click (before any approval): buttons:', await buttons(), '| silent reconnect:', silent)
  say('STEP 7 modal shows:', await evaluate(`(() => { const out = []; const w = (n) => { if (!n) return; if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t) } if (n.shadowRoot) w(n.shadowRoot); for (const c of n.childNodes || []) w(c) }; w(document.querySelector('w3m-modal')); return [...new Set(out)].slice(0, 25).join(' | ') })()`))
  say('modal click WalletConnect →', await clickModalText('WalletConnect'))
  const uri2 = await new Promise<string>((resolve, reject) => {
    const started = appLogs.length
    const timer = setInterval(() => {
      const hit = appLogs.slice(started - 5).reverse().find((l) => /pairing uri/.test(l) && !l.includes(uri))
      if (hit) { clearInterval(timer); resolve(hit.match(/wc:[^\s"]+/)![0]) }
    }, 300)
    setTimeout(() => { clearInterval(timer); reject(new Error('no fresh pairing uri')) }, 20000)
  }).catch((e) => { say(String(e)); return '' })
  if (uri2) {
    say('STEP 8 fresh pairing uri (different from first):', uri2 !== uri, '→ wallet pairs again')
    await wallet.pair({ uri: uri2 })
    await sleep(6000)
    say('STEP 8 reconnected after new approval; buttons:', await buttons(), '| proposals approved total:', proposals)
  }
  const count = (re: RegExp) => appLogs.filter((l) => re.test(l)).length
  say('WARNINGS: core-initialized-twice', count(/already initialized/), '| empty CAIP-10', count(/invalid CAIP-10/), '| exceptions', count(/\[exception\]/), '| errors', count(/^\[error\]/))
  for (const l of appLogs.filter((l) => /^\[error\]|\[exception\]/.test(l)).slice(0, 5)) say('  ', l.slice(0, 200))
  ws.close()
  killChrome()
  process.exit(0)
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1) })
