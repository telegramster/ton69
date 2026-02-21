# Trustless Agents

On-chain identity, reputation and validation infrastructure for autonomous AI agents on [TON](https://ton.org), written in [Tact](https://docs.tact-lang.org/).

Three permissionless registries allow agents to register an on-chain identity, build verifiable reputation through authorized feedback, and request independent validation of their work — all without pre-existing trust between parties.

## Motivation

Telegram has become the default interface for interacting with AI agents — its bot API, inline keyboards, payments and 950M+ user base make it the fastest path from prototype to production for any agent-based product.  Thousands of trading bots, assistant agents and autonomous services already live there.

What's missing is a trust layer.  Today there is no way to verify that the agent you're talking to is the same one that served someone else yesterday, no on-chain reputation trail, and no mechanism to request independent validation of an agent's output.  Users rely on screenshots and word of mouth.

TON is the native blockchain of the Telegram ecosystem.  It shares the same account system, the same wallet infrastructure, and the same user base.  This project closes the loop: agents that already operate inside Telegram can now anchor their identity, reputation and work quality directly on-chain — in the network their users already have wallets for.

## Why TON

Most blockchains treat smart contracts as passive objects that share a global state machine.  TON is different — every contract is an independent **actor** with its own address, balance and storage, communicating exclusively through asynchronous messages.  This is a natural fit for autonomous agents: each agent is a sovereign entity that sends and receives messages on its own schedule, exactly like a TON contract.

Key properties of TON that this project relies on:

- **Protocol-level sender authentication** — `sender()` is enforced by the TVM at the message-routing layer.  There is no way to spoof it without the private key.  This eliminates the need for signature registries or off-chain attestations to prove identity.
- **Native cross-contract calls** — verification round-trips (ReputationRegistry → AgentRegistry → ReputationRegistry) happen through internal messages settled within the same block (~5 s finality).  No bridges, no relayers, no event-log polling.
- **Deterministic addresses** — contract addresses are `hash(code, data)`, so the registries deploy to globally predictable addresses and act as natural singletons without governance.
- **Storage rent model** — every cell in persistent state costs rent.  This creates a natural economic incentive for explicit garbage collection (our `Cleanup*` receivers), which keeps long-term costs bounded even under adversarial spam.
- **Cashback pattern** — unused gas is returned to the caller via `cashback(sender())`, making interactions gas-efficient by default.  Agents don't overpay for cheap operations.
- **Infinite sharding** — each contract lives in its own potential shard.  As the network grows, agent interactions scale horizontally without shared-state bottlenecks.

## Architecture

```
┌──────────────┐  VerifyAgent / Response   ┌─────────────────────┐
│              │◄─────────────────────────►│                     │
│ AgentRegistry │                          │ ReputationRegistry  │
│  (Identity)  │                           │ (Feedback auth)     │
└──────────────┘                           └─────────────────────┘
       ▲
       │  (reference)
       ▼
┌─────────────────────┐
│ ValidationRegistry   │
│ (Work validation)    │
└─────────────────────┘
```

### AgentRegistry

Permissionless identity registry.  Each address registers itself as an agent — the identity is the `sender()`, proven at the protocol level.  A reverse-lookup map (`address → agentId`) enforces strict 1:1 uniqueness: one address, one agent, no exceptions.

The `VerifyAgent` receiver turns the registry into a **composable on-chain oracle**: any contract on the network can send a verification request and get a typed callback response within the same block.  This is the backbone that the reputation and validation layers build on.

Identity transfer is supported — the current owner can migrate their agent to a new address, atomically updating both the forward and reverse maps.

### ReputationRegistry

Feedback-authorization layer that uses TON's native async messaging for cross-contract identity verification.

When an agent claims feedback, the contract:
1. Stores a pending entry with the caller's address and a timestamp
2. Forwards a `VerifyAgent` message to the identity registry
3. Receives the `VerifyAgentResponse` callback and checks whether the original caller matches the registered agent address
4. Authorizes the feedback only if all checks pass, and **always** deletes the pending entry

Step 4 is critical: the callback handler is non-reverting by design.  On TON, a reverted transaction does not commit state changes, which would leave the pending entry in storage forever — an unbounded DoS vector that racks up storage rent.  By using conditional logic instead of `require`, the cleanup always commits.

A separate `CleanupPendingFeedback` receiver handles entries orphaned by lost messages (e.g. insufficient gas on the outbound hop).  Anyone can trigger it after the TTL expires and receive a gas cashback.

### ValidationRegistry

Time-bounded work validation with designated validators.

A requester opens a validation slot by specifying a validator address and a data hash.  Only that exact address can submit a response (score 0–100) before the on-chain TTL expires.  This is enforced by `require(sender() == request.validatorAddress)` — backed by TVM's protocol-level sender guarantee.

After expiry, unresponded requests can be garbage-collected by anyone via `CleanupExpiredValidation`, freeing cells and returning gas to the cleaner.  Responded entries are preserved as permanent on-chain records.

## Quick start

```bash
npm install
npm run build
npm test
```

Requires Node.js >= 20 (22+ recommended).

### Project layout

```
contracts/
  messages.tact              shared message/struct definitions
  agent_registry.tact        identity registry
  reputation_registry.tact   feedback authorization
  validation_registry.tact   work validation
tests/
  AgentRegistry.spec.ts      12 tests
  ReputationRegistry.spec.ts  7 tests
  ValidationRegistry.spec.ts 15 tests
wrappers/
  *.compile.ts               Blueprint compilation configs
```

## Security model

| Property | Mechanism |
|---|---|
| No identity spoofing | `sender()` is protocol-level; reverse-lookup map enforces uniqueness |
| Validator binding | designated address is stored at request time; only it can respond |
| Callback safety | non-reverting handler always deletes pending entry, no storage-leak DoS |
| Bounded storage | TTL-based `Cleanup*` receivers let anyone free expired cells |
| Init validation | registry addresses and TTL are checked at deploy time with `require` |

### Known limitations

- Map-based storage is practical for hundreds to low thousands of entries.  For larger deployments a sharded child-contract architecture (à la TON NFT collections) would be needed.
- The `VerifyAgent` response uses `myAddress()` as a placeholder when the agent doesn't exist.  Consumers must check the `verified` flag.
- Identity transfer is single-step.  A production deployment may want a two-step handshake with consent from the receiving address.

## References

- [Tact language docs](https://docs.tact-lang.org/)
- [TON Blueprint](https://github.com/ton-org/blueprint)
- [TON actor model](https://docs.ton.org/learn/overviews/ton-blockchain)

## License

MIT
