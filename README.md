# dsh-skill-manager

A DeepSeek Harness (DSH) external plugin that adds a **DSH Skill Manager** page
to the DSH WebUI settings. From it, a user will be able to search skills.sh,
install/update skills, and manage the skills the plugin owns.

> **Status: foundation (Issue #9).** This release ships the production plugin
> skeleton — GitHub-installable package, host/client split, `settings.section`
> registration, and the typed `/skill-manager` RPC boundary with a live health
> probe. Search, install, update, and uninstall land in later tickets
> (Issues #10–#18).

## Install

```sh
dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager
```

Then start the WebUI:

```sh
dsh web
```

Open **Settings → DSH Skill Manager**. The page shows the plugin title, a short
explanation, and a live **Host connection** status answered by the host half
over the `/skill-manager` RPC channel.

## What's implemented (Issue #9)

- **Package contract** — `dsh.bundle.patch` → `cordis.patch.yml`,
  `dsh.client` (`platform: "web"` + the rc.1 service injects), and
  `exports["."]` / `exports["./client"]` / `exports["./package.json"]`.
- **Host half** (`src/index.ts`) — a cordis entry that registers the
  `/skill-manager` Connection RPC channel and answers a typed `health`/`ping`
  probe.
- **Client half** (`src/client/`) — a `settings.section` page titled
  **DSH Skill Manager**, with stable containers for the future search and
  managed-skills sections and a live host-connectivity status over real RPC.
- **rc.1 build contract** — a tsdown reproduction of the DSH `clientBundle`
  preset: host `lib/index.js` (ESM) + `lib/client.js` (the
  `window.__ModuleLoader__.load` closure), `fixedExtension: false`, and a
  build-time purity gate that fails if the client bundle `require()`s a
  non-seed module.

## Architecture

Two halves, split across the DSH process boundary:

| Half | Runtime | Responsibility |
|---|---|---|
| Host (`src/index.ts`) | DSH Node process | registers the RPC channel; future home of networking, filesystem, manifest, hashing, path validation, and mutations |
| Client (`src/client/`) | WebUI browser | renders the settings page; owns only the interface |

They communicate over a single Connection RPC channel, `/skill-manager`. Every
endpoint returns `{ok:true,value} | {ok:false,error:{code,message,details}}`.

## rc.1 client build contract

The rc.1 browser runtime seeds a static module table
(`window.__DSH_BOOT__` → `staticModules`) and a client bundle may only
`require()` those seed words:

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives
```

This list is the single source of truth in `scripts/seed-modules.json`, consumed
by `tsdown.config.mjs` (the client `external`/`deps.neverBundle` list) and
`scripts/verify-client-purity.mjs` (the build-time purity gate).

## Development

```sh
pnpm install     # install dependencies
pnpm run build   # host + client build + client purity gate
pnpm run check   # typecheck (tsc --noEmit)
pnpm run test    # unit tests (vitest)
pnpm run smoke   # server-side smoke against the built host bundle
```

The built `lib/` is committed so `dsh plugin add` needs no post-install build.

## Known limitations / deferred work

- No search, install, update, or uninstall yet — those are Issues #10–#18.
- The well-known (non-GitHub) source boundary is not exercised by the
  foundation (see ADR-0004).
- Real-browser rendering of the settings section and the browser→host→browser
  RPC round trip are verified manually (see the runtime-smoke evidence in the
  PR for Issue #9).
