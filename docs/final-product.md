# Finality — Final Product Guide (Hedera)

## Product

Finality is a pay-per-result market-intelligence service for people and autonomous agents. A browser user connects **HashPack** (Hedera WalletConnect); an agent supplies its own Hedera signer. Both call the same catalog of HTTP resources and pay the displayed amount in **USDC (HTS)** or **HBAR** through x402. **Blocky402** verifies and settles the payment (as fee payer) before Finality executes the provider operation.

## Surfaces

| Surface | URL |
|---|---|
| Landing page | https://finality.accuracy.wtf |
| Human endpoint explorer | https://finality.accuracy.wtf/explore |
| Merchant health | https://finality-x402-backend.onrender.com/health |
| Agent catalog | https://finality-x402-backend.onrender.com/v1/catalog |
| Facilitator (testnet) | https://api.testnet.blocky402.com |

## Payment flow

1. Request a paid resource without payment → HTTP `402` + dual accepts (USDC + HBAR).
2. Client builds a partially signed Hedera `TransferTransaction` with facilitator `feePayer`.
3. Retry with payment payload / `PAYMENT-SIGNATURE`.
4. Blocky402 `/verify` then `/settle`.
5. Finality returns live JSON + `PAYMENT-RESPONSE`.

## On-chain catalog (Mirror Node)

- `POST /v1/onchain/hedera/account`
- `POST /v1/onchain/hedera/balances`
- `POST /v1/onchain/hedera/token`
- `POST /v1/onchain/hedera/transaction`
- `POST /v1/onchain/hedera/topic`
- `GET /v1/onchain/hedera/network/supply`
- `GET /v1/onchain/hedera/network/nodes`
- `GET /v1/onchain/hedera/blocks`

Market / intelligence / agent / AI routes are unchanged aside from the Hedera payment rail.

## Env

See `.env.example`. Required for paid testnet: `X402_PAYTO_ADDRESS` (Hedera `0.0.x`), Blocky402 facilitator URL, USDC token id, Mirror Node URL, and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for HashPack.
