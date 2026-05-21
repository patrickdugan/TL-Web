# Algo Runner Vercel Deploy

This repo now supports a two-project Vercel deploy on the same `main` branch.

## Projects

Main app:

- Root Directory: `packages/web-ui`
- Domain: `layerwallet.com`

Runner app:

- Root Directory: `packages/algo-runner`
- Domain: `algo.layerwallet.com`

Both projects can watch `main`, so one push deploys both origins.

## Production Wiring

The web app production environment now points at the runner origin in:

- `src/environments/environment.prod.ts`

Production settings:

- `algoRunner.enabled = true`
- `algoRunner.origin = https://algo.layerwallet.com`
- `algoRunner.path = /host.html`
- `algoRunner.allowLocalExecution = false`

That means production will not fall back to local `new Function` execution if the runner is unavailable.

## Main App CSP

The main app Vercel headers in `vercel.json` now assume remote runner execution and remove `unsafe-eval` from the production CSP header.

## Runner CSP

The runner project ships its own Vercel config in:

- `../algo-runner/vercel.json`

That policy:

- allows framing only by approved app origins
- allows `unsafe-eval` only on the runner origin
- keeps the worker and host files on the isolated origin

## First Deploy Checklist

1. Create the new Vercel project with root `packages/algo-runner`.
2. Attach `algo.layerwallet.com` to that project.
3. Confirm `host.html`, `host.js`, `host-worker.js`, and `runner-config.js` resolve on the runner domain.
4. Push `main`.
5. Verify the main app loads a hidden iframe from `https://algo.layerwallet.com/host.html`.
6. Start a strategy and confirm logs/metrics flow through `postMessage`.
