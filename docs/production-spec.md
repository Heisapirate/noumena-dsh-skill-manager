# Production Specification — Noumena DSH Skill Manager

Status: ready-for-agent. This spec converts the verified Phase 1 architecture and
Phase 2 prototype findings into an implementable production specification.
Inputs: the Noumena exam spec, `CONTEXT.md`, `docs/planning/architecture.md`,
ADR-0001…0004, `docs/planning/open-questions.md`, and the verified Phase 2
prototype (`docs/prototype/phase-2-findings.md`).

## Problem Statement

A DSH user has no way to discover, install, and manage skills from skills.sh from
inside the DSH WebUI. Today skills must be added by hand or by external CLI, and
there is no in-app notion of which skills the plugin owns versus skills the user
or other tools installed.

## Solution

A DSH external plugin — installed via one `dsh plugin` command from GitHub — adds
a **Skill Manager** page to the DSH WebUI settings. From it a user searches
skills.sh, sees name/description/source/install-count/page-link, installs skills
so DSH discovers them, lists the skills the plugin manages, checks for updates,
updates, and uninstalls them — all with loading/empty/error/confirmation/success
states, and with every filesystem mutation confined to DSH's user skills root.

## User Stories

1. As a DSH user, I want to search skills.sh by keyword, so that I can find a skill for my task.
2. As a DSH user, I want to see each result's name, description, source, install count, and a link to its skills.sh page, so that I can judge it before installing.
3. As a DSH user, I want to install a skill with one action, so that DSH discovers and can use it.
4. As a DSH user, I want the install to ask before overwriting an existing skill, so that I never lose my local changes by accident.
5. As a DSH user, I want to see a list of the skills the plugin manages, so that I know what this plugin owns.
6. As a DSH user, I want to see a per-skill "update available" indicator, so that I know when upstream changed.
7. As a DSH user, I want to update a skill with confirmation, so that I get upstream changes deliberately.
8. As a DSH user, I want locally modified skills to be protected from silent overwrite, so that my edits are never destroyed.
9. As a DSH user, I want to uninstall a skill with confirmation, so that removal is deliberate.
10. As a DSH user, I want only plugin-managed skills to be removable, so that foreign skills are never touched.
11. As a DSH user, I want a clear loading state during search/install/update, so that I know work is in progress.
12. As a DSH user, I want a clear empty state when search returns nothing or the query is too short, so that I know why there are no results.
13. As a DSH user, I want a clear error state on network failure, so that I can retry.
14. As a DSH user, I want a clear "unavailable source" state for skills that cannot be installed, so that I am not misled.
15. As a DSH user, I want success feedback after install/update/uninstall, so that I know it worked.
16. As a DSH user, I want destructive actions to require an explicit confirmation dialog, so that I do not trigger them accidentally.
17. As a DSH user, I want search to remain responsive while descriptions load progressively, so that I am not blocked by slow metadata.
18. As a DSH user, I want the plugin to keep working (degrading gracefully) if skills.sh endpoints change, so that a registry change does not crash the UI.
19. As a DSH user, I want the plugin installable from its GitHub repo with a single copy-paste command, so that setup is trivial.

## 1. Product scope

**In scope:** search skills.sh; display name/description/source/install-count/page-link;
install; managed local-skill list; update check; update; uninstall; the full set of
loading/empty/error/confirmation/success states.

**Non-goals:** installing well-known (non-GitHub) sources; managing skills the
plugin does not own; modifying or removing foreign skills; editing skill file
contents in-app.

## 2. DSH plugin package

- **Layout:** root `package.json` (manifest), `cordis.patch.yml`, `src/index.ts`
  (host face), `src/client/index.ts` (browser face), built `lib/index.js` +
  `lib/client.js`, `tsconfig.json`, `tsdown.config.mjs`, `test/`.
- **Manifest (`package.json`):** `dsh.bundle.patch` → `./cordis.patch.yml`;
  `dsh.client` = `{ platform: "web", inject: [...] }`; `exports["."]` → host
  entry; `exports["./client"]` → browser bundle; `exports["./package.json"]`.
- **Patch (`cordis.patch.yml`):** an `insert` row `{ id: "dsh-skill-manager", name: "dsh-skill-manager" }`.
- **Settings registration (browser face):** `ctx.slots.inject('settings.section',
  () => ctx.slots.register({ name: 'settings.section', id: 'skill-manager',
  order: 15, label, inject }, Panel))`.
- **RPC boundary:** host `connection.rpc.handle('/skill-manager', handler)`
  (rc.1: handler `(endpoint, payload, signal)`); browser
  `connection.rpc.call('/skill-manager', endpoint, payload)`.
- **Build/typecheck/test:** `pnpm run build` (tsdown → `lib/index.js` + the
  `window.__ModuleLoader__.load({id,factory})` client closure), `pnpm run check`
  (tsc --noEmit), `pnpm run test` (vitest).
- **Shipping built artifacts:** the built `lib/` is committed so `dsh plugin add`
  works without a post-install build; a `prepare` build script is an alternative
  that would require a profile `allowBuilds` entry.
- **Resolved — rc.1 client-build external list.** The rc.1 client module system
  seeds a runtime module table (`window.__DSH_BOOT__` → `staticModules`) and a
  bundle may only `require()` those seed words; a non-seed `@deepseek-ai/*`
  import fails at runtime ("missed the module table"). The production client
  build therefore **externalizes** the react family (`react`, `react/jsx-runtime`,
  `react-dom`, `react-dom/client`), `@deepseek-ai/cordis`, and any
  `@deepseek-ai/dsh-client-*` package the client imports, and **inlines** every
  non-platform dependency. A build-time purity gate rejects non-seed
  `@deepseek-ai/*` value imports (mirroring the rc.1 runtime check), so
  cross-plugin collaboration happens only through services. This was verified by
  the Phase 2 prototype (externalized `react` + injected `connection`/`slots`
  services rendered in a real browser). `fixedExtension: false` is required so the
  host emits `lib/index.js` rather than `.mjs`.

## 3. Host / client responsibility and RPC contracts

- **Browser:** rendering, user interactions, search-query state, optimistic/
  progressive UI state (only where safe); it never performs filesystem or network
  work.
- **Host:** all skills.sh networking, filesystem, manifest, hashing, path
  validation, install/update/uninstall, and retry/error normalization.

Typed RPC contract (single `/skill-manager` channel; every endpoint returns
`{ok:true,value} | {ok:false,error:{code,message,details}}`):

```
search({ query })            → { results: SkillSummary[], complete: boolean }
install({ id })              → { ok: true }                        // id = owner/repo/slug
list()                       → { skills: ManagedSkill[] }
checkUpdates()               → { updates: UpdateInfo[] }
update({ id })               → { ok: true }
uninstall({ id })            → { ok: true }
```

where `SkillSummary = { id, name, source, installs, pageUrl, description? }`
(description present only once hydrated), `ManagedSkill = { slug, source,
remoteSourceHash, localContentHash, installedAt, updatedAt, localModified,
updateAvailable }`, and `UpdateInfo = { slug, updateAvailable, upstreamChanged }`.

## 4. SkillsShClient adapter

A host-side adapter is the only code that knows skills.sh endpoint shapes.

- `search(q)` → `GET /api/search?q=&limit=&owner=` (compatibility endpoint);
  returns `id`/`name`/`skillId`/`installs`/`source`; page link is `https://skills.sh/{id}`.
- `getSnapshot(id)` → `GET /api/download/{owner}/{repo}/{slug}` (compatibility
  endpoint); returns `{ files: [{path, contents}], hash }` (GitHub sources only).
- **Stability risk:** both are undocumented compatibility endpoints used by the
  official CLI, with no stability contract; `/api/v1/*` is documented but requires
  a Vercel OIDC token a local plugin cannot mint.
- **Error mapping:** 400 (bad query) / 401 / 403 / 404 (not found) / 429 / 503 →
  typed errors; malformed/unknown shapes → a "registry changed" typed error, never
  a crash.
- **Timeouts/retry:** ~10s timeout; exponential backoff + jitter; honor
  `Retry-After` on 429; retry 503; cap retries.
- **Cancellation:** every in-flight search/snapshot request is abortable; stale
  query responses are discarded (see §5).
- **Future migration path:** if skills.sh publishes a documented credential-free
  API, swap it in behind the adapter without touching UI/business logic (ADR-0003).

## 5. Search + description UX

- Render basic fields (name/source/install-count/page-link) immediately from
  search.
- Hydrate the description lazily/progressively for visible/expanded rows via the
  snapshot (or a lighter metadata source if one becomes available), with bounded
  concurrency (≈4) and an in-memory cache keyed by slug.
- Stale-query cancellation/ignore: responses for a superseded query are dropped.
- One metadata failure must not fail the whole list — the row shows a degraded
  "description unavailable" state while the rest render.
- The full snapshot is fetched only on install/update, never for listing.
- **While description loads, the row shows a placeholder/skeleton** (a subtle
  shimmer or "…" in the description slot), not a blank or an error.

## 6. Ownership + manifest

A **plugin-managed skill** is a skill under `$DSH_HOME/skills/<slug>` whose
provenance is recorded in the manifest. Anything else is foreign and is never
listed/updated/uninstalled.

Manifest at `$DSH_HOME/skills/.system/skill-manager/manifest.json`, written
atomically via `@deepseek-ai/dsh-atomic-write`:

```
{
  "version": 1,
  "skills": {
    "<slug>": {
      "source": "owner/repo",
      "slug": "<slug>",
      "remoteSourceHash": "<opaque upstream fingerprint>",
      "localContentHash": "<plugin-computed SHA-256>",
      "installedAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>"
    }
  }
}
```

A `version` field (schema version) is included for future migrations. No
additional fields are needed. Reconciliation: a skill dir on disk with no manifest
entry is foreign (left alone); a manifest entry whose dir is missing is dropped as
already-uninstalled; a manifest whose `version` is unknown is treated as corrupt
(see §12).

## 7. Two-hash model

- **`remoteSourceHash`** — the opaque `/api/download` `hash`; used only to detect
  upstream change (compare server value now vs the value recorded at install).
  Never recomputed locally.
- **`localContentHash`** — plugin-computed SHA-256; used only to detect local
  modification/drift. Recomputed from the installed files and compared to the
  recorded value.
- **Never compare the two as equivalent.**

Exact local algorithm (prototype-derived):

```
localContentHash(files):
  h = SHA256()
  for f in files sorted by relative path (byte order):
    h.update(f.path); h.update(f.contents)
  return hex(h.digest())
```

**Exclusions:** the hash covers only the skill directory's own files (the snapshot
files). The manifest and staging area live in `.system/` (outside the skill dir)
and are never included, and the plugin writes no metadata into the skill dir.

## 8. Path safety

One reusable safe-path boundary guards every write/delete. For any skill `name`
from the registry it must:

1. validate against DSH's kebab-case grammar (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`);
2. reject `..`, absolute paths, Windows drive-letter paths, and backslash
   separators (normalize `/` vs `\` before checking);
3. resolve against `$DSH_HOME/skills` and require the result is strictly inside
   it (byte-prefix check), case-insensitively on Windows;
4. `realpath`/`lstat` the target and every ancestor and refuse symlink/junction
   escapes (the resolved real path must still be inside the skills root);
5. apply the same containment to every nested file in a snapshot (each
   `files[].path` is itself validated and resolved relative to the skill dir).

Staged writes go to `.system/skill-manager/.staging/<slug>/` then rename into
place; deletes resolve-and-contain before removal. No install/update/uninstall
operation may escape `$DSH_HOME/skills`.

## 9. Install transaction

Order: (1) validate the `id` shape and that `source` is a GitHub `owner/repo`
(else "unavailable source"); (2) fetch the snapshot; (3) validate the snapshot
(`files` array, each path safe, `SKILL.md` present with valid frontmatter);
(4) if the target dir exists: if not plugin-managed → refuse (foreign); if
plugin-managed → duplicate/overwrite confirmation; (5) stage to `.staging/<slug>/`;
(6) atomically rename into place; (7) record the manifest entry (remoteSourceHash
+ freshly computed localContentHash + timestamps); (8) on any failure, remove the
staging dir and leave the prior state untouched. The skill dir appears complete or
not at all.

## 10. Update transaction

Order: (1) fetch the latest snapshot; (2) **update-available** iff the latest
`remoteSourceHash` ≠ the manifest's `remoteSourceHash`; (3) recompute
`localContentHash` and, if it ≠ the manifest's `localContentHash`, the skill is
locally modified — **never silently overwrite**; require an explicit confirmation
that discards local changes; (4) stage the replacement; (5) atomically swap;
(6) update `remoteSourceHash` + `localContentHash` + `updatedAt` only after the
swap succeeds. Source-unavailable (404/snapshot missing) is a typed error; the
installed skill is left intact. Recovery: on interruption, the old dir still
exists or the staged dir is discarded — reconcile on next load.

## 11. Uninstall transaction

Order: (1) only a manifest-recorded skill is removable (foreign → refuse);
(2) recompute `localContentHash`; if it diverges, confirm that local changes will
be discarded; (3) confirm removal; (4) delete the skill dir; (5) remove the
manifest entry atomically. Recovery: if deletion is interrupted, reconcile on next
load (a dir with no manifest entry is foreign; a manifest entry with no dir is
dropped).

## 12. Error model

Typed user-facing states (no raw stack traces in normal UI):
`network-unavailable`, `timeout`, `rate-limited`, `registry-unavailable`,
`malformed-response`, `source-unavailable`, `skill-not-found`, `duplicate-install`,
`local-modification-conflict`, `unsafe-path`, `filesystem-permission`,
`install/update/uninstall-partial-failure`, `manifest-corruption`
(reconciliation state). The RPC layer returns `{ok:false,error:{code,message}}`
and the UI maps `code` → localized copy + action (retry / confirm / nothing).

## 13. UI specification

A polished Settings page, visually consistent with DSH Web: search input (debounced,
min 2 chars); results list; installed/managed section; per-item status and
"update available" badge; install/update/uninstall actions; confirmation dialogs
for destructive actions; success/error feedback; disabled/loading action states;
responsive layout; keyboard-accessible controls and aria labels. Loading uses
skeleton rows; empty states are explanatory; errors are per-item where possible
(one row failure never blanks the page).

## 14. Test specification

**Unit:** path validation (table-driven); local hash (deterministic + drift);
manifest schema/reconciliation; `SkillsShClient` error normalization; search
metadata parsing.

**Filesystem integration (temp skills root + mocked fetch):** install; duplicate
install; failed-install cleanup; update; local-modification conflict; uninstall;
manifest drift; path traversal; symlink/junction escape where testable on Windows.

**RPC:** request/response contract (each endpoint's `{ok,value}|{ok:false,error}`).

**Build:** host build; client build; typecheck (all three succeed in CI).

**Runtime smoke:** `dsh plugin` install; DSH Web boot; Settings page presence;
RPC round trip (the six rc.1 checks proven in Phase 2).

## 15. Security (threat model)

- **Malicious skills.sh file paths** → §8 safe-path boundary (grammar + containment + realpath).
- **Malicious/huge snapshots** → validate shape; cap total snapshot size and file
  count; reject non-UTF-8/non-text where appropriate.
- **Unexpected source types** → install only GitHub `owner/repo`; well-known → "unavailable source".
- **Symlink/junction attacks** → realpath containment before write/delete.
- **Corrupted manifest** → treat as reconciliation state; never crash; rebuild from filesystem where possible.
- **Local user modifications** → drift detection (§7) gates update/uninstall behind confirmation.
- **Network response manipulation/failure** → the host is the only network actor;
  typed error mapping; no secrets cross the RPC boundary.

## 16. Performance

Search debounce (~250–350ms); metadata-hydration concurrency ≈4; network timeout
~10s with bounded retries; in-memory slug cache; full snapshots fetched only for
install/update (never for listing); localContentHash recomputed only on demand
(install/update/check), not on every list.

## 17. Observability / debugging

Minimal structured logs: install/update/uninstall lifecycle (start/end/result),
normalized network errors, reconciliation warnings. **Never log** secrets,
Authorization headers, session tokens, or unnecessary sensitive paths.

## 18. README / delivery requirements

The production repo must ship: a single copy-paste `dsh plugin --profile web add
github:Heisapirate/noumena-dsh-skill-manager` command; usage instructions;
architecture explanation; test instructions; screenshots; known limitations
(well-known sources, anonymous rate limits unknown); a 3–6 minute demo video; and
the GitHub Issues/PR history.

## 19. Acceptance matrix

| Exam requirement | Area | Test/evidence | Expected user-visible result |
|---|---|---|---|
| 按关键词搜索 | SkillsShClient + search UI | unit + filesystem test; smoke | results for ≥2-char query; empty/validation otherwise |
| 展示名称/简介/来源/安装量/链接 | search UI + hydration | unit (parse) + UI test | each row shows name, description, source, install count, `https://skills.sh/{id}` |
| 安装并让 DSH 发现 | install transaction | filesystem integration + smoke | `$DSH_HOME/skills/<slug>/SKILL.md` exists; DSH lists it |
| 列出插件管理的本机技能 | manifest + list | unit (manifest) + filesystem | only manifest-recorded skills on disk listed |
| 检查更新并更新 | update transaction | filesystem integration | "update available" when remoteSourceHash differs; update replaces files |
| 卸载 | uninstall transaction | filesystem integration | dir + manifest entry removed; DSH no longer lists it |
| 处理 6 种状态 | error model + UI | UI/unit | loading/empty/network-failure/duplicate/update-failure/unavailable-source all reachable |
| `dsh plugin` 安装 | package manifest | build + smoke | repo installs from GitHub; settings page appears |
| 独立入口 | settings.section | smoke | a top-level Settings section exists |
| 不改 DSH 源码 | package layout | review | zero DSH source edits |
| 写入/更新/删除只在技能目录 | path safety | unit (table-driven) | all mutations confined to `$DSH_HOME/skills` |
| 覆盖/更新/卸载前确认 | UI confirmation | UI test | confirmation dialog before each destructive op |
| build/typecheck/test 命令 | package scripts | CI | `pnpm build`/`check`/`test` succeed |
| 测试覆盖 | test spec | CI | install/update/uninstall/path-safety covered |
| README 安装命令 | README | review | copy-paste install command present |

## Testing Decisions

Tests assert external behavior only (what the user sees/DSH observes), not
internal implementation. The primary seams are the `/skill-manager` RPC boundary
and the host `SkillsShClient` + manifest + safe-path modules, all testable against
a temp skills root with mocked `fetch`. Prior art: the Phase 2 prototype's
`verify-host.mjs` and `experiment-*.mjs` scripts (plain-node; vitest is used for
the production suite with a worker pool that runs in a normal environment).

## Out of Scope

Well-known (non-GitHub) source install; editing skill file contents; managing
foreign skills; any DSH source modification.

## Further Notes

The spec freezes the decisions in `docs/planning/architecture.md` and ADR-0001…0004.
The two hashes are never compared as equivalent (§7). The only low-risk unknowns
carried into `/to-tickets` are the exact runtime seed list observed at build time
and skills.sh's undocumented rate limits, both handled conservatively.
