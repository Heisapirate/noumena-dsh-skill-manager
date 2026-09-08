# Phase 2 Prototype Findings — DSH Skill Manager

Throwaway / risk-reduction spike. Not production code. Evidence recorded against
the installed `@deepseek-ai/dsh@0.1.2-rc.1` and the live skills.sh service.

## 1. Environment / version

| Item | Value |
|---|---|
| OS | Windows (NTFS) |
| Node | v24.19.0 |
| pnpm | 12.3.4 |
| npm | 11.17.0 |
| DSH | `@deepseek-ai/dsh@0.1.2-rc.1` (`dsh --version` → `0.1.2-rc.1`), run from the npx cache |
| Sandbox constraints | `raw.githubusercontent.com` reset (`ECONNRESET`); git TLS via `schannel` fails (`SEC_E_NO_CREDENTIALS`), `openssl` backend works; child-process `spawn` fails (`EPERM`, no named pipes) — this blocks `vitest`'s worker pool and the browser-open step |

## 2. DSH package/build recipe that worked

- **Manifest** (`package.json`): `dsh.bundle.patch` → `./cordis.patch.yml`; `dsh.client` = `{ platform: "web", inject: ["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-slots"] }`; `exports["."]` → `./lib/index.js`; `exports["./client"]` → `./lib/client.js`.
- **Patch** (`cordis.patch.yml`): an `insert` row `{ id: "dsh-skill-manager", name: "dsh-skill-manager" }`.
- **Build** (`tsdown`): two outputs from one `tsdown.config.mjs` —
  - host half: ESM, node, `src/index.ts` → `lib/index.js` (`@deepseek-ai/*` external; **`fixedExtension: false`** required, otherwise tsdown emits `lib/index.mjs` and the `main` pointer breaks).
  - client half: CJS, browser, `src/client/index.ts` → `lib/client.js`, with `banner: window.__ModuleLoader__.load({ id, factory: (require) => {`, `intro: var module = {exports:{}}; var exports = module.exports;`, `footer: return module.exports; } });`, and `external` = the platform module table (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`).
- **Commands**: `pnpm install --ignore-scripts` (88 packages, ~14 s), `pnpm run build` → `lib/index.js` (0.63 kB) + `lib/client.js` (1.42 kB).
- **Install** (`dsh plugin --profile web add <spec>` is a thin pnpm forwarder + reconciler): `add link:<repo>` succeeded and auto-reconciled `dsh-skill-manager` into `dsh.profile.bundles` (`["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-skill-manager"]`). The `github:` spec uses the identical pnpm flow; it was **not run end-to-end** because git's TLS is broken in this sandbox — the reconciliation path (the part this spike de-risks) is identical and proven via `link:`.

## 3. Settings registration recipe (client)

`src/client/index.ts` declares `inject = ["connection","slots"]` and in `apply(ctx)`:

```
ctx.slots.inject('settings.section', () =>
  ctx.slots.register({ name: 'settings.section', id: 'skill-manager',
    order: 15, label: () => 'DSH Skill Manager Prototype',
    locale: undefined, inject: () => ({ connection }) }, Panel))
```

`dsh web` boots with the plugin installed and no client-module loader error in the
startup log. (The rendered page itself was not visually observed — see §11.)

## 4. RPC API / signatures proven

- Host: `connection.rpc.handle('/skill-manager', handler)` with handler
  `(endpoint, payload) → Promise<{ ok:true, value } | { ok:false, error:{code,message,details} }>`.
  The host `apply()` ran at boot (`[dsh-skill-manager] host apply: registering /skill-manager RPC`).
- Client: `connection.rpc.call('/skill-manager', 'ping', {})`.
- Handler verified by direct invocation: `ping` → `{ok:true, value:{ok:true, version:"prototype", now:<ts>}}`;
  unknown endpoint → `{ok:false, error:{code:"internal", …}}`. Channel registration and handler capture asserted.
- **Not proven**: the browser→host wire round trip (needs a real browser).

## 5. skills.sh endpoint observations (live)

- `GET /api/search?q=react&limit=3` → 200. Per skill: `id` (`owner/repo/slug`), `skillId`, `name` (= slug), `installs`, `source`. **No `description`, no `url`/`sourceType`.**
- `GET /api/download/vercel-labs/skills/find-skills` → 200, `{ files: [{path:"SKILL.md", contents}], hash }` (1 file, 5456 chars / 5472 bytes).
- `SKILL.md` YAML frontmatter `description` extracts cleanly from the snapshot.

## 6. Description-strategy benchmark

Representative query `react`, `limit=5` (strategy A = hydrate each visible result via `/api/download`):

| Metric | Strategy A (download hydration) | Strategy B (GitHub tree + raw SKILL.md) |
|---|---|---|
| Requests | 6 (1 search + 5 downloads) | 1 tree + N raw fetches |
| Total payload | ~572 KB (~978 B search + ~571 KB downloads) | ~5 KB/SKILL.md (expected) |
| Latency | search 1.09 s + 2.21 s downloads (avg 442 ms) | not measured (see below) |
| Per-skill payload | 12 KB … **243 KB** (huge variance) | ~few KB |
| Failure modes | 400 (<2-char q), 404 | GitHub API 60/hr unauth; raw reset in sandbox |
| Cacheability | `Cache-Control: public` on download; no ETag | repo-tree + raw are content-addressed |
| Stale-query cancellation | must cancel in-flight fetches per keystroke | same |
| Rate-limit headers | none observed | GitHub `x-ratelimit-*` |

Strategy B was **not measurable end-to-end** here: `api.github.com` is reachable but
`raw.githubusercontent.com` is reset by this sandbox. In production (user machine)
both are reachable. The evidence already shows A is heavyweight for mere
descriptions — one snapshot was 243 KB and five results cost ~560 KB / ~3.3 s.

## 7. Hash fixture result — the documented convention is WRONG

`/api/download` returned `hash = b1460085…aaaf` for `find-skills`. Recomputing
SHA-256 over sorted `path`+`contents` (the Phase 1 convention) gave
`913b9d37…c396`. **20+ alternative conventions** (contents-only, path+contents,
path+`\n`/`\0`/`\t`+contents, git blob SHA-1/SHA-256 with byte/char length,
JSON serializations, content-hash concatenations, line-ending normalization) all
failed to match. **The remote `hash` is an opaque server-side fingerprint, not
reproducible from the returned bytes.**

Consequence for the design: use the remote `hash` only for **update detection**
(compare server hash now vs server hash recorded at install); use a **separate,
plugin-owned deterministic content hash** (the documented SHA-256 sorted
path+contents function) recorded at install for **local-modification detection**.
This supersedes the "remote == local recompute" assumption in the Phase 1
architecture doc (see §10).

## 8. Rate-limit / error observations

- No `X-RateLimit-*`, no `Retry-After` on `/api/search` or `/api/download`.
- `Cache-Control`: search `public, max-age=0, must-revalidate`; download `public`. No ETag.
- `/api/search?q=a` (1 char) → 400 (min 2 chars). No 429/503 triggered (traffic kept minimal).
- Unknown → design conservatively (timeout + backoff; treat 429/503 defensively) since no limits are advertised.

## 9. Failed approaches and why

- **Hash convention (20+ probes)** — remote `hash` unreproducible → documented in §7.
- **`vitest` worker pool** — `spawn EPERM` (sandbox forbids named pipes); `--pool=threads` still fails because vite shells out for `realpath`. Replaced by the plain-node `verify-host.mjs` (which passes all asserts).
- **Browser open** — `spawn EPERM` (expected; harmless).
- **`raw.githubusercontent.com` from node** — `ECONNRESET` (sandbox network policy); used `web_fetch` for GitHub source instead.
- **git over `schannel`** — `SEC_E_NO_CREDENTIALS`; the `openssl` TLS backend works (`-c http.sslBackend=openssl`). Affects only the `github:` install fetch, not the reconciliation logic.
- **Host emitted `lib/index.mjs`** — fixed with `fixedExtension: false` so `main`/`exports` resolve.

## 10. Production recommendation

1. **Client build**: use the recipe in §2 (reproduce the `clientBundle` preset; the full
   preset in the reference `AKS1st/dsh-skill-manager` adds CSS-module inlining + a
   bundle-purity gate, neither needed for the minimal client).
2. **Description hydration**: do **not** eagerly hydrate via `/api/download` (heavy, §6).
   Recommend a **lazy/hybrid**: render name/source/installs instantly, fetch description
   on scroll/expand with cancellation + cache; full snapshot only at install time.
   Revisit a lighter metadata source if skills.sh exposes one.
3. **Hashing**: remote `hash` is opaque → store it for update detection; store a
   **plugin-computed** local content hash for modification detection (corrects Phase 1).
4. **Settings**: `settings.section` slot + own `/skill-manager` RPC channel (proven shape).

## 11. Remaining risks

- Browser-level proof (settings page renders, RPC wire round trip) needs a real
  browser — not observable in this sandbox.
- `github:` (vs `link:`) install and `dsh web` on a fresh clone need a machine with
  working git TLS + pnpm `allowBuilds` for any `prepare`-build plugin.
- The exact rc.1 `PLATFORM_MODULES` table (client `external` list) was taken from the
  rc.6 reference; verify against rc.1 before production.
- skills.sh anonymous limits remain unknown (§8).

## 12. Commands to reproduce

```sh
pnpm install --ignore-scripts
pnpm run build                                   # -> lib/index.js + lib/client.js
pnpm exec tsx --help >/dev/null 2>&1 || true     # (tsx optional)
node docs/prototype/verify-host.mjs              # host RPC handler + channel asserts

# install into a throwaway DSH home and boot
export DSH_HOME="$PWD/.proto-dsh-home"
node <dsh>/lib/bin.js plugin --profile web add "link:$PWD"
node <dsh>/lib/bin.js web --port 4123 --no-open   # watch for: [dsh-skill-manager] host apply …

# clean removal
node <dsh>/lib/bin.js plugin --profile web remove dsh-skill-manager

# skills.sh experiments
node docs/prototype/experiment-skills.mjs
node docs/prototype/experiment-hash-probe.mjs
node docs/prototype/experiment-benchmark.mjs
```
