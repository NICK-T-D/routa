---
title: Self-Hosting
---

# Self-Hosting

Routa can be used as a packaged Desktop app, but the web/runtime surface can also be run in your
own environment.

## What Self-Hosting Means Today

Today, self-hosting is primarily about running the Next.js web surface and, when needed, wiring
it to a local or remote backend/runtime.

## Basic Local Flow

Run the web surface from source:

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at a local backend:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Operational Concerns

The main things to think about are:

- which provider paths are available
- which environment variables are set
- whether the backend/runtime surface is reachable from the web UI
- whether Docker-backed execution paths are available when required

## Recommended Source Checkout For Local Customizations

If your self-hosted deployment needs a few local-only patches, do not carry them in the same
working copy you use for upstream pulls.

Use the local overlay pattern:

- keep one clean worktree pinned to upstream
- keep one long-lived overlay branch for your local-only behavior
- run the browser/runtime surface from the overlay worktree

The repository includes helper commands for this:

```bash
npm run overlay:bootstrap -- \
  --clean-dir ../routa-upstream \
  --overlay-dir ../routa-overlay \
  --overlay-branch local/routa-overlay-team
```

After bootstrap, start the self-hosted web runtime from the overlay worktree:

```bash
cd ../routa-overlay
npm install --legacy-peer-deps
npm run dev
```

When upstream ships updates, sync with:

```bash
npm run overlay:sync -- \
  --clean-dir ../routa-upstream \
  --overlay-dir ../routa-overlay
```

For the underlying branch model and the manual fallback flow, see
[Local Overlay And Upstream Sync](/developer-guide/local-overlay-sync).

## What This Is Not Yet

The repository currently has stronger release and contributor docs than full public production
self-hosting runbooks. Treat this page as the operational entry point, not as a complete hosting
manual.

## Read Next

- [Configuration](/configuration)
- [Deployment](/deployment)
- [Release Guide](/release-guide)
