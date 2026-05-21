# Algo Runner Vercel Project

This folder is the dedicated deploy target for `algo.layerwallet.com`.

## Vercel Setup

Create a second Vercel project pointing at this repo with:

- Root Directory: `packages/algo-runner`
- Production Branch: `main`
- Production Domain: `algo.layerwallet.com`

The main app remains a separate Vercel project rooted at:

- `packages/web-ui`

With both projects targeting `main`, one push deploys both origins.

## Files

- `host.html`: hidden iframe entrypoint
- `host.js`: handshake and runner command handling
- `host-worker.js`: isolated dynamic strategy execution
- `runner-config.js`: allowed parent origins
- `vercel.json`: runner CSP and static headers

## Parent Origins

Edit `runner-config.js` if the allowed app origins change.

Current allowlist:

- `https://layerwallet.com`
- `https://www.layerwallet.com`
- `https://app.layerwallet.com`
- `http://localhost:4200`
