# Submission preparation

## What reviewers run

Follow the root README. Supply a Panta live API key in the ignored server environment, run the local gateway and Metro, and launch a native debug build. Android uses USB/emulator reverse port forwarding; iOS Simulator can use the loopback gateway directly.

The production API host used by the gateway is `https://live-api.panta.market/api/v1`. Catalog, categories, market detail/activity, wallet data and primary quote/build routes use real upstream requests. P2P order books and transaction checks also read Solana RPC. The configured deployment and RPC constants are in `tools/panta-gateway/primary-transaction.ts` and related gateway modules.

No submission credential is bundled. The exporter compares selected files against configured server secrets in memory and rejects private-key material before copying. Automated tests deliberately retain synthetic API responses and public transaction fixtures.

## Known limitations

- Primary-market quote/build/purchase requests can fail because of upstream responses or transaction checks. Keep the visible error; do not replace it with a fake receipt.
- A configured HTTPS gateway is required for release builds and physical iPhones. The included loopback gateway is a local development service with in-memory quote and purchase state. Public hosting needs its own deployment, access controls and operational review.
- Privy public identifiers currently identify the owner's development app. A new repository URL alone does not replace authentication dashboard configuration or native app signing.
- Phantom is optional and currently disabled; configure a project identity URL before testing its devnet connection.
- Native targets retain internal Rainbow naming and upstream resources. Renaming them is separate from preparing a reproducible submission and can affect callbacks and signing.
- Run funded trading checks only deliberately with your own wallet. No export or automated test sends a live transaction.

## Export contents

`bun run submission:export` copies only selected working-tree files into a new directory and writes `submission-manifest.json`. It preserves executable file permissions for the Android Gradle wrapper. It does not copy `.git`, local secrets, generated bundles, dependencies, Pods, pitch assets, web projects or review screenshots. Original local assets and existing uncommitted work remain in the source checkout.

Before submitting, install dependencies in the export, run `bun run lint`, and verify a native build and live catalog load. Confirm signing/team settings for your own device. After creating the new remote yourself, initialize and publish the export when you are ready. No commit or remote change is performed by the cleanup tooling.

## Verification on October 13, 2026

- Installed dependencies in the independent export with the frozen lockfile.
- Passed `bun run lint` in both the working checkout and the export using Node 24.
- Built iOS and Android release JavaScript bundles from the export.
- Verified HTTP 200 responses from live gateway category and market reads.

Native device builds, authentication handoff and funded transactions were not exercised in this cleanup pass. Release bundles still need a configured HTTPS gateway to access data.
