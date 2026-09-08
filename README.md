# dsh-skill-manager

A DeepSeek Harness (DSH) external plugin that adds a **DSH Skill Manager** page
to the DSH WebUI settings. From it, a user will be able to search skills.sh,
install and update skills, and manage the plugin-managed skills on this machine.

> **Status: install shipped (Issue #14).** The production plugin skeleton
> (Issue #9) plus the domain/manifest, path-safety, and SkillsShClient
> foundations (#10–#12) and the atomic install transaction (#14). Search,
> update, uninstall, and the managed-list UI land in later tickets (#15–#18).

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
  probe plus the `install` endpoint (Issue #14).
- **Install transaction** (`src/install.ts`) — source/snapshot validation,
  staged writes through the path-safety boundary, atomic publish (backup-swap
  on overwrite), and a manifest update written only after publish succeeds,
  with full rollback on failure.
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
by `tsdown.config.mjs` (the client `deps.neverBundle` list) and
`scripts/verify-client-purity.mjs` (the build-time purity gate). The derivation
from the installed rc.1 `dsh-web-frontend` source — and the difference from the
Phase 2 spike's rc.6-derived list — is recorded in `scripts/seed-modules.md`.

## Runtime smoke

The host-side contract is smoke-tested against the built bundle:

```sh
pnpm run smoke    # registers /skill-manager; health + ping answer; unknown endpoint fails typed
```

Full install + boot verification (performed once per release; the `github:`
spec is the same pnpm reconcile path as the `link:` smoke used locally):

```sh
export DSH_HOME="$PWD/.proto-dsh-home"      # isolated from ~/.dsh (gitignored)
node <dsh>/lib/bin.js plugin --profile web add link:"$PWD"
node <dsh>/lib/bin.js web --port 4123 --no-open
```

Evidence expected at boot: `[dsh-skill-manager] registered /skill-manager RPC
channel` and the `dsh web: http://…` URL with no client-module loader error.
The settings page title, its rendered layout, and the browser → host → browser
health round trip are confirmed in a real browser (see the PR for Issue #9).

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

- Search, update, uninstall, and the managed-list UI are not implemented yet —
  those are Issues #15–#18. Install (Issue #14) is implemented end-to-end.
- The well-known (non-GitHub) source boundary surfaces as **unavailable source**
  on install (see ADR-0004).
- Real-browser rendering of the settings section and the browser→host→browser
  RPC round trip are verified manually (see the runtime-smoke evidence in the
  PR for Issue #9).
