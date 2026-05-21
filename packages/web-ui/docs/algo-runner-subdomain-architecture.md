# Algo Runner Subdomain Architecture

## Goal

Keep the visible product as a single browser app while moving the high-risk algo execution path off the main app origin.

Target properties:

- `app.layerwallet.com` stays the user-facing Angular app.
- `algo.layerwallet.com` runs uploaded strategy code, delegated hot-key buckets, and fast policy checks.
- The main app can ship a strong CSP without `unsafe-eval`.
- The runner origin can have a narrower blast radius if algo code or an approved MM is compromised.

This is driven by the current implementation in:

- `src/app/@core/services/algo-trading.service.ts`
- `src/app/@core/algo.worker.ts`
- `src/app/@core/algo-db.ts`
- `src/assets/algos/tl/keyStore.js`

## Current State

Today the app does all of this on one origin:

- strategy upload and persistence
- strategy execution via `new Function`
- local algo IndexedDB storage
- delegated hot-key storage

That means the main app origin is also the algo origin. If the algo path is compromised, the whole app origin is compromised.

## Target Split

### Main App Origin

Origin: `https://app.layerwallet.com`

Responsibilities:

- visible UI
- wallet extension interaction
- funding and withdrawal UX
- strategy catalog UX
- runner lifecycle management
- policy admin and MM whitelist UX
- revocation dashboard and emergency controls

Security posture:

- no `unsafe-eval`
- no delegated hot-key storage
- only allow framing the runner origin
- strict CSP

### Algo Runner Origin

Origin: `https://algo.layerwallet.com`

Responsibilities:

- hidden iframe host
- strategy code storage
- worker spawning
- delegated bucket state
- local fast-path policy checks
- communication with policy signer and approved MM endpoints

Security posture:

- allowed to use `unsafe-eval` if the current `new Function` runner remains
- looser CSP than the main app, but still narrow
- framed only by `app.layerwallet.com`
- only stores capped delegated buckets, never the full user wallet

## UX Model

The user remains on `app.layerwallet.com`.

The runner is loaded as a hidden iframe, for example:

```html
<iframe
  src="https://algo.layerwallet.com/host.html"
  title="algo-runner"
  hidden
></iframe>
```

The iframe is not user-facing. It acts as a cross-origin execution island. The main app talks to it over `postMessage` or a `MessageChannel`.

Visible UX stays the same:

- upload strategy
- allocate bucket
- start/stop strategy
- view logs and PnL

The difference is that those actions become remote procedure calls into the runner origin.

## Component Model

### 1. Main App Runner Bridge

New service on the main app origin:

- `AlgoRunnerBridgeService`

Responsibilities:

- create and monitor the hidden runner iframe
- establish a `MessageChannel`
- proxy commands from `AlgoTradingService`
- enforce allowed runner origin
- reconnect and rehydrate state after reload

Suggested commands:

- `runner.handshake`
- `runner.importStrategy`
- `runner.listStrategies`
- `runner.startStrategy`
- `runner.stopStrategy`
- `runner.allocateBucket`
- `runner.withdrawBucket`
- `runner.getLogs`
- `runner.getRunning`
- `runner.revokeBucket`

### 2. Runner Host

New app on `algo.layerwallet.com`:

- `host.html`
- `host.js`

Responsibilities:

- validate parent origin
- own the runner-side IndexedDB
- launch worker instances
- keep runner state isolated to the subdomain

### 3. Runner Worker Pool

The current `algo.worker.ts` logic moves to the runner origin.

The main app should no longer directly instantiate:

- `new Worker(new URL('../algo.worker.ts', import.meta.url), { type: 'module' })`

Instead:

- the main app sends `startStrategy`
- the runner host spawns the worker locally on `algo.layerwallet.com`

### 4. Policy Signer

Separate backend service or signer cluster:

- validates capability envelopes
- enforces revocation epoch
- rate-limits by bucket and MM
- issues approvals, partial signatures, or short-lived capability leases

This service is the actual enforcement point.

## Data Placement

### Main App Origin Storage

Allowed:

- UI preferences
- strategy metadata cache
- revocation/admin state cache
- non-secret runner session metadata

Not allowed:

- delegated WIFs
- loose-key buckets
- raw strategy source if you want the main origin clean

### Runner Origin Storage

Allowed:

- strategy source
- runner manifest/index
- delegated bucket state
- ephemeral logs
- short-lived capability leases

Rules:

- default bucket mode should be memory-only
- persistence should be explicit and low-balance only
- no storage of the user’s primary wallet secret

## Capability Model

The runner should not get a blanket whitelist authorization.

It should get a capability envelope per bucket:

```text
cap_hash =
  H(
    system_hash ||
    model_hash ||
    config_hash ||
    mm_id ||
    bucket_id ||
    market_id ||
    side_mask ||
    max_notional ||
    slippage_band ||
    quote_nonce_scope ||
    expiry ||
    revoke_epoch
  )
```

Meaning:

- `system_hash`: exact algo/MM runtime build identity
- `bucket_id`: blast-radius partition
- `mm_id`: approved MM binding
- `max_notional`: hard bucket cap
- `slippage_band`: trade quality bound
- `expiry`: time bound
- `revoke_epoch`: global kill switch generation

## Lease Model

Use short-lived signed leases instead of long-lived delegated authority.

Runner requests:

- `lease(bucket_id, system_hash, mm_id, cap_hash, max_actions, max_notional, ttl_ms)`

Policy signer returns:

- `lease_id`
- `lease_expiry`
- `revoke_epoch`
- `lease_sig`

Runner can only request signature release while:

- lease is still valid
- revoke epoch matches
- nonce has not been used
- trade remains inside bucket limits

This makes blue-team latency explicit:

```text
max_loss_per_bucket <= drain_rate_per_bucket * (detection_latency + lease_ttl + settlement_tail)
```

MM bond sizing should cover the sum of those bounded per-bucket losses, not total platform TVL.

## Message Flow

### Strategy Upload

1. User uploads a strategy in the main app.
2. Main app computes metadata and `system_hash`.
3. Main app sends `runner.importStrategy`.
4. Runner stores source in runner IndexedDB.
5. Runner returns strategy id and status.

### Bucket Allocation

1. User approves allocation from the main app.
2. Main app performs the funding flow.
3. Main app sends `runner.allocateBucket` with:
   - strategy id
   - bucket id
   - MM id
   - allowed market scope
   - cap parameters
4. Runner stores the bucket locally.
5. Policy signer records the bucket envelope.

### Start Strategy

1. Main app sends `runner.startStrategy`.
2. Runner spawns the worker.
3. Worker runs strategy code and emits intents, not final spends.
4. Runner validates intent shape locally.
5. Runner requests a lease or signature release from the policy signer.
6. If approved, runner finalizes the bounded action.

### Emergency Revoke

1. Admin increments `revoke_epoch` for one MM or one bucket family.
2. Policy signer refuses further lease refreshes or signature releases.
3. Runner receives `revoked` on next refresh.
4. Main app marks the strategy stopped.

## CSP Split

### Main App CSP

Goal: no dynamic code evaluation.

Example shape:

```text
default-src 'self';
script-src 'self';
worker-src 'self';
connect-src 'self' https://api.layerwallet.com https://ob.layerwallet.com https://algo.layerwallet.com;
frame-src https://algo.layerwallet.com;
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

### Runner CSP

Goal: permit strategy execution, but only on the isolated origin.

Example shape:

```text
default-src 'self';
script-src 'self' 'unsafe-eval';
worker-src 'self' blob:;
connect-src 'self' https://api.layerwallet.com https://policy.layerwallet.com https://approved-mm.example;
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
object-src 'none';
base-uri 'self';
frame-ancestors https://app.layerwallet.com;
```

## Code Changes in This Package

### Phase 1

- keep `AlgoTradingService` API stable for the UI
- replace direct worker spawn with a bridge call
- add a new bridge service on the main origin
- move strategy source persistence out of `src/app/@core/algo-db.ts`

### Phase 2

- move `algo.worker.ts` logic to the runner app
- make `registerStrategy` upload to the runner instead of storing locally
- make `fetchDiscovery` and `fetchRunning` read from runner state

### Phase 3

- move delegated key storage out of `src/assets/algos/tl/keyStore.js`
- replace it with runner-local capped bucket storage
- default storage mode to memory-only

### Phase 4

- integrate lease-based policy signer checks
- add revoke epoch handling
- add per-MM and per-bucket quotas

## Recommended Interfaces

### Main App -> Runner

```ts
type RunnerCommand =
  | { type: 'handshake'; sessionId: string }
  | { type: 'importStrategy'; id: string; name: string; source: string; meta: any }
  | { type: 'startStrategy'; strategyId: string; bucketId: string; amount: number }
  | { type: 'stopStrategy'; strategyId: string }
  | { type: 'allocateBucket'; bucket: BucketEnvelope }
  | { type: 'withdrawBucket'; bucketId: string }
  | { type: 'listStrategies' }
  | { type: 'listRunning' };
```

### Runner -> Main App

```ts
type RunnerEvent =
  | { type: 'ready'; version: string }
  | { type: 'strategyImported'; strategyId: string }
  | { type: 'runningState'; rows: any[] }
  | { type: 'log'; strategyId: string; level: 'info' | 'warn' | 'error'; line: string }
  | { type: 'metric'; strategyId: string; pnlUsd: number }
  | { type: 'revoked'; bucketId: string; reason: string }
  | { type: 'fatal'; reason: string };
```

## Risks That Still Remain

- The runner origin is still a hot environment if it holds delegated buckets.
- A compromised approved MM can still drain its own bucket class until revocation lands.
- `unsafe-eval` remains on the runner origin if the current execution model stays.
- Extensions or browser malware can still attack the user session globally.

The point of the split is not perfect safety. It is reducing compromise from:

- `entire app origin + all delegated hot buckets`

to:

- `one isolated runner origin + bounded per-MM buckets`

## Immediate Next Steps

1. Deploy the dedicated runner project from `packages/algo-runner` onto `algo.layerwallet.com`.
2. Move strategy source persistence from main-origin IndexedDB to runner-origin IndexedDB.
3. Make `fetchDiscovery` and `fetchRunning` hydrate from runner state after reconnect.
4. Define the policy signer lease payload and revoke epoch semantics.
5. Move delegated bucket material out of the main-app asset path entirely.
