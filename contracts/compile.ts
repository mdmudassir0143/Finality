/**
 * Compile contracts/FinalityUSD.sol with solc-js (no Hardhat workspace) into contracts/artifacts/FinalityUSD.json.
 *
 *   npm run fusd:compile
 *
 * evmVersion is pinned to "paris" so the bytecode runs on Hedera EVM without depending on newer opcodes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require('solc') as { compile(input: string, opts: { import: (p: string) => unknown }): string; version(): string }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const source = readFileSync(path.join(root, 'contracts/FinalityUSD.sol'), 'utf8')

const input = {
  language: 'Solidity',
  sources: { 'FinalityUSD.sol': { content: source } },
  settings: {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}

function findImports(importPath: string) {
  try {
    return { contents: readFileSync(path.join(root, 'node_modules', importPath), 'utf8') }
  } catch {
    return { error: `not found: ${importPath}` }
  }
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>
}
const errors = (output.errors ?? []).filter((e) => e.severity === 'error')
for (const e of output.errors ?? []) console.error(e.formattedMessage)
if (errors.length) process.exit(1)

const contract = output.contracts['FinalityUSD.sol'].FinalityUSD
mkdirSync(path.join(root, 'contracts/artifacts'), { recursive: true })
writeFileSync(
  path.join(root, 'contracts/artifacts/FinalityUSD.json'),
  JSON.stringify({ contractName: 'FinalityUSD', compiler: solc.version(), evmVersion: 'paris', abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2) + '\n',
)
console.log(`FinalityUSD compiled with solc ${solc.version()} (${contract.evm.bytecode.object.length / 2} bytes)`)
