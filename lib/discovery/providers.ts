/**
 * Hedera ecosystem services shown on the landing page and the Discover page.
 *
 * Every entry is backed by a public source that ties it to Hedera (`source`): Hedera's own docs, hedera.com, or the
 * provider's Hedera page. Logos are each provider's own published site icon, stored in public/providers/hedera/.
 * Keep descriptions factual: no pricing, uptime or volume claims that the source does not state.
 */

export type DiscoverCategory = 'intelligence' | 'aggregators' | 'oracles' | 'indexers' | 'infrastructure'

export const CATEGORIES: { id: DiscoverCategory; label: string; short: string }[] = [
  { id: 'intelligence', label: 'Intelligence', short: 'Intel' },
  { id: 'aggregators', label: 'Data Aggregators', short: 'Data' },
  { id: 'oracles', label: 'Oracle Aggregators', short: 'Oracle' },
  { id: 'indexers', label: 'Indexers', short: 'Indexer' },
  { id: 'infrastructure', label: 'RPC & Nodes', short: 'RPC' },
]

export type DiscoverProvider = {
  id: string
  name: string
  category: DiscoverCategory
  logo: string
  /** One factual line. */
  description: string
  tags: string[]
  website: string
  /** Public page that documents the Hedera support. */
  source: string
}

export const PROVIDERS: DiscoverProvider[] = [
  // Intelligence
  {
    id: 'finality',
    name: 'Finality',
    category: 'intelligence',
    logo: '/logo.webp',
    description: 'Pay-per-call market and Hedera intelligence over x402.',
    tags: ['x402', 'HBAR', 'USDC', 'fUSD'],
    website: '/explore/endpoints',
    source: '/docs',
  },
  {
    id: 'thetie',
    name: 'The Tie',
    category: 'intelligence',
    logo: '/providers/hedera/thetie.png',
    description: 'Institutional crypto data with an HBAR Insights dashboard built on Hedera on-chain data.',
    tags: ['Dashboards', 'On-chain data'],
    website: 'https://www.thetie.io/',
    source: 'https://www.thetie.io/insights/introducing-hbar-insights',
  },
  {
    id: 'dune',
    name: 'Dune',
    category: 'intelligence',
    logo: '/providers/hedera/dune.png',
    description: 'SQL analytics platform with community Hedera dashboards.',
    tags: ['SQL', 'Dashboards'],
    website: 'https://dune.com/',
    source: 'https://hedera.com/ecosystem/',
  },
  {
    id: 'hashstream',
    name: 'HashStream',
    category: 'intelligence',
    logo: '/providers/hedera/hashstream.svg',
    description: 'Live Hedera mainnet traffic: transactions per second, fee revenue by type, a live transaction river.',
    tags: ['Real-time', 'Mainnet'],
    website: 'https://hashstream.app/',
    source: 'https://hashstream.app/',
  },

  // Data aggregators
  {
    id: 'coingecko',
    name: 'CoinGecko',
    category: 'aggregators',
    logo: '/providers/coingecko.png',
    description: 'Aggregated HBAR and Hedera token market data. A Finality data source.',
    tags: ['Prices', 'API'],
    website: 'https://www.coingecko.com/',
    source: 'https://www.coingecko.com/en/coins/hedera-hashgraph',
  },
  {
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    category: 'aggregators',
    logo: '/providers/coinmarketcap.png',
    description: 'Aggregated HBAR market data, rankings and exchange listings.',
    tags: ['Prices', 'API'],
    website: 'https://coinmarketcap.com/',
    source: 'https://coinmarketcap.com/currencies/hedera/',
  },
  {
    id: 'dexscreener',
    name: 'DEX Screener',
    category: 'aggregators',
    logo: '/providers/hedera/dexscreener.png',
    description: 'Hedera DEX pairs, liquidity and trades in one view. A Finality data source.',
    tags: ['DEX', 'Pairs'],
    website: 'https://dexscreener.com/',
    source: 'https://dexscreener.com/hedera',
  },

  // Oracle aggregators
  {
    id: 'chainlink',
    name: 'Chainlink',
    category: 'oracles',
    logo: '/providers/hedera/chainlink.png',
    description: 'Decentralized price feeds for Hedera smart contracts.',
    tags: ['Price feeds', 'Hedera EVM'],
    website: 'https://chain.link/',
    source: 'https://docs.hedera.com/evm/integrations/oracles/chainlink',
  },
  {
    id: 'pyth',
    name: 'Pyth',
    category: 'oracles',
    logo: '/providers/hedera/pyth.png',
    description: 'Pull-oracle price feeds across crypto, FX, equities and commodities, live on Hedera.',
    tags: ['Pull oracle', 'Price feeds'],
    website: 'https://www.pyth.network/',
    source: 'https://www.pyth.network/blog/pyth-price-feeds-launch-on-hedera',
  },
  {
    id: 'supra',
    name: 'Supra',
    category: 'oracles',
    logo: '/providers/hedera/supra.png',
    description: 'DORA decentralized oracle price feeds, including HBAR/USD, on Hedera.',
    tags: ['DORA', 'Price feeds'],
    website: 'https://supra.com/',
    source: 'https://docs.hedera.com/evm/integrations/oracles/supra',
  },

  // Indexers
  {
    id: 'mirror',
    name: 'Hedera Mirror Node',
    category: 'indexers',
    logo: '/providers/hedera/hedera.png',
    description: 'The network’s own REST API for accounts, tokens, transactions and HCS topics. Finality reads it.',
    tags: ['REST', 'Official'],
    website: 'https://docs.hedera.com/',
    source: 'https://testnet.mirrornode.hedera.com/api/v1/docs/',
  },
  {
    id: 'hgraph',
    name: 'Hgraph',
    category: 'indexers',
    logo: '/providers/hedera/hgraph.png',
    description: 'Mirror node provider with a GraphQL API, plus managed JSON-RPC.',
    tags: ['GraphQL', 'Mirror node'],
    website: 'https://hgraph.com/',
    source: 'https://hgraph.com/blog/hedera-mirror-node',
  },
  {
    id: 'goldsky',
    name: 'Goldsky',
    category: 'indexers',
    logo: '/providers/hedera/goldsky.png',
    description: 'Managed subgraphs and data pipelines for Hedera, compatible with The Graph.',
    tags: ['Subgraphs', 'Streaming'],
    website: 'https://goldsky.com/',
    source: 'https://goldsky.com/chains/hedera',
  },
  {
    id: 'thegraph',
    name: 'The Graph',
    category: 'indexers',
    logo: '/providers/hedera/thegraph.png',
    description: 'Deploy subgraphs over the Hedera JSON-RPC relay and query them with GraphQL.',
    tags: ['Subgraphs', 'GraphQL'],
    website: 'https://thegraph.com/',
    source: 'https://docs.hedera.com/evm/tools/other/the-graph',
  },
  {
    id: 'hashscan',
    name: 'HashScan',
    category: 'indexers',
    logo: '/providers/hedera/hashscan.png',
    description: 'Network explorer for accounts, tokens, contracts, topics and transactions.',
    tags: ['Explorer'],
    website: 'https://hashscan.io/',
    source: 'https://hashscan.io/',
  },

  // RPC & nodes
  {
    id: 'arkhia',
    name: 'Arkhia',
    category: 'infrastructure',
    logo: '/providers/hedera/arkhia.png',
    description: 'Hosted JSON-RPC relay and Hedera API services.',
    tags: ['JSON-RPC', 'APIs'],
    website: 'https://www.arkhia.io/',
    source: 'https://docs.hedera.com/evm/development/json-rpc',
  },
  {
    id: 'quicknode',
    name: 'QuickNode',
    category: 'infrastructure',
    logo: '/providers/hedera/quicknode.png',
    description: 'Managed Hedera JSON-RPC endpoints.',
    tags: ['JSON-RPC'],
    website: 'https://www.quicknode.com/',
    source: 'https://www.quicknode.com/docs/hedera',
  },
  {
    id: 'validationcloud',
    name: 'Validation Cloud',
    category: 'infrastructure',
    logo: '/providers/hedera/validationcloud.png',
    description: 'Hedera JSON-RPC and mirror node endpoints on its Node API.',
    tags: ['JSON-RPC', 'Mirror node'],
    website: 'https://www.validationcloud.io/',
    source: 'https://www.validationcloud.io/hedera',
  },
  {
    id: 'infstones',
    name: 'InfStones',
    category: 'infrastructure',
    logo: '/providers/hedera/infstones.svg',
    description: 'Node infrastructure supporting Hedera’s block node architecture.',
    tags: ['Nodes', 'Block nodes'],
    website: 'https://infstones.com/',
    source: 'https://infstones.com/blog/industry/hedera-hashgraph-redefining-distributed-ledger-technology',
  },
  {
    id: 'hashio',
    name: 'Hashio',
    category: 'infrastructure',
    logo: '/providers/hedera/hashio.png',
    description: 'Free public JSON-RPC relay by Hashgraph, for development and testing only.',
    tags: ['JSON-RPC', 'Free', 'Testing'],
    website: 'https://www.hashgraph.com/hashio/',
    source: 'https://docs.hedera.com/evm/development/json-rpc',
  },
  {
    id: 'thirdweb',
    name: 'thirdweb',
    category: 'infrastructure',
    logo: '/providers/hedera/thirdweb.png',
    description: 'Managed RPC and developer tooling for EVM chains, including Hedera.',
    tags: ['RPC', 'SDK'],
    website: 'https://thirdweb.com/',
    source: 'https://docs.hedera.com/operators/json-rpc',
  },
]

/** The providers featured on the landing page diagram, in display order. */
export const LANDING_PROVIDER_IDS = [
  'arkhia',
  'hgraph',
  'quicknode',
  'validationcloud',
  'infstones',
  'hashio',
  'hashstream',
  'dune',
  'thetie',
  'thirdweb',
] as const

export const isExternal = (href: string) => /^https?:\/\//.test(href)
