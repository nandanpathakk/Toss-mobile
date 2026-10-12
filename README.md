# Toss

A React Native prediction-market app built on Panta. Browse live markets, inspect prices and activity, sign in with Privy, view wallet balances and positions, and prepare primary, peer-to-peer, and market-creation transactions.

The app uses Panta's live API through a local Node gateway. API failures remain visible; failed requests never turn into sample markets or simulated successful trades. Primary-market requests may still fail upstream.

## Run locally

Requirements: Node 22.11+ (22.x) or 24.x, Bun 1.3.14, and the native tools for your platform. iOS needs macOS, Xcode, Ruby 3.4+ and CocoaPods 1.16.2. Android needs JDK 17, Android Studio and an installed SDK.

```sh
bun install --frozen-lockfile
cp .env.example .env.panta-server.local
```

Add your own `PANTA_API_KEY=pk_live_...` to `.env.panta-server.local`. This ignored file is read only by the gateway. No Panta credential belongs in the mobile app.

Start these in separate terminals:

```sh
bun run catalog:gateway
```

```sh
bun run start
```

For iOS:

```sh
bundle install
cd ios
bundle exec pod install
cd ..
bun run ios
```

The iOS command defaults to the iPhone 17 Pro simulator; select an installed simulator with the React Native CLI if needed. The workspace and internal native registration retain the Rainbow name.

For Android, start an emulator or connect a device, then forward the development ports:

```sh
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
bun run android
```

Debug builds use `http://127.0.0.1:8787`. A physical iPhone needs a separately deployed HTTPS gateway. Configure its public URL in `src/lib/panta-api.ts`. Release builds require this URL too. The included local gateway binds only to loopback and must not be exposed publicly as-is.

Privy public app/client IDs live in `src/features/panta/privy-config.ts` and `src/lib/panta-account-verification.ts`; they must refer to the same Privy app. For an independent deployment, use your own Privy app, native identifiers and dashboard configuration. Optional Phantom integration remains disabled until `wallet-config.ts` has a public project URL; its cluster is devnet.

## Verify

```sh
bun run lint
```

This checks formatting, TypeScript, configuration JavaScript, ESLint, generated design files, both platform dependency graphs, and gateway/wallet/security tests. Fixture data is confined to automated tests. Passing tests does not establish that a funded transaction completed on a device.

## Prepare a new submission repository

```sh
bun run submission:export
```

This creates `submission` from the current working tree, including uncommitted changes. It includes the app's source dependency closure for both platforms, native projects, required patches, gateway, tests and setup documentation. It excludes old Rainbow application source outside that closure, pitch recordings, design reviews, the marketing site, dependencies, build products, local server credentials and Git history. The upstream license is preserved.

The exporter refuses to overwrite a destination. To repeat it, supply a fresh path:

```sh
bun run submission:export -- submission-v2
```

Use the exported directory as the starting point for your new remote repository. The exporter does not initialize Git, commit or push. See [submission notes](docs/submission.md) for the remaining deployment and device checks.

## Attribution

Toss is derived from Rainbow's React Native codebase and retains parts of its design system and native scaffolding. The upstream GPL-3.0 license is included in `LICENSE`; retain the license and applicable notices when redistributing the source.
