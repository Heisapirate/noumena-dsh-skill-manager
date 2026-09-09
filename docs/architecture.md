# Architecture — DSH Skill Manager

Delivery-facing summary of how the plugin is built. Terms follow
[`CONTEXT.md`](../CONTEXT.md); decisions that are hard to reverse are recorded in
[`docs/adr/`](adr/). The detailed planning record (with Phase 2 prototype
evidence) lives in [`docs/planning/architecture.md`](planning/architecture.md).

## Shape at a glance

```
Browser client (settings.section "DSH Skill Manager")
   │  React page; owns only the interface
   ▼
typed RPC  /skill-manager  (DSH Connection RPC)
   │  every endpoint returns { ok: true, value } | { ok: false, error: { code, message, details } }
   ▼
host service  SkillManagerService (src/service.ts)
   ├─ SkillsShClient      skills.sh networking, the only code that knows endpoint shapes
   ├─ ManifestStore       plugin-owned provenance; atomic write + reconcile
   ├─ path safety         SkillRoot: grammar + containment + realpath for every mutation
   ├─ install transaction  validate → fetch → stage → publish → manifest
   ├─ update transaction   detect → drift-gate → stage → swap → manifest
   └─ uninstall transaction managed-only → drift-gate → confirm → delete dir → drop entry
        │
        ▼
$DSH_HOME/skills  (default ~/.dsh/skills) — the only directory the plugin mutates
```

## Two halves across the DSH process boundary

DSH external plugins are Cordis plugins with two faces. The split here is
*forced, not stylistic*: the browser runtime has no filesystem or network
access, so those responsibilities must live in the host.

| Half | Source | Runtime | Responsibilities |
|---|---|---|---|
| Host | `src/index.ts` | DSH Node process | registers the RPC channel; networking, filesystem, manifest, hashing, path validation, install/update/uninstall |
| Client | `src/client/` | WebUI browser | renders the settings page; search/manage state; owns only the interface |

- **Host registration** — `apply(ctx)` declares `inject = ['connection']` and
  calls `connection.rpc.handle('/skill-manager', handler)` with an rc.1 handler
  of shape `(endpoint, payload, signal) => Promise<{ok,value}|{ok:false,error}>`.
- **Client registration** — `apply(ctx)` declares
  `inject = ['connection', 'slots']` and registers a top-level `settings.section`
  page (`id: 'skill-manager'`, `order: 15`, label **DSH Skill Manager**).
- **Package contract** (`package.json`) — `dsh.bundle.patch` →
  `cordis.patch.yml` (mounts the host into the profile entry tree);
  `dsh.client` = `{ platform: 'web', inject: [...] }`; `exports['.']` → host
  `lib/index.js`, `exports['./client']` → browser `lib/client.js`,
  `exports['./package.json']`. The built `lib/` is committed, so `dsh plugin add`
  needs no post-install build.

## The `/skill-manager` RPC channel

One channel, nine endpoints. The names are single-sourced in `src/contract.ts`
so host and client cannot drift apart.

| Endpoint | Purpose |
|---|---|
| `health` / `ping` | liveness probe proving the host is alive behind RPC |
| `search({ query })` | search skills.sh, return basic normalized results |
| `describe({ id })` | lazily hydrate one result's description from its snapshot |
| `install({ id, overwrite? })` | install one GitHub-backed skill (transaction) |
| `list()` | list plugin-managed skills with provenance + update status |
| `checkUpdates()` | per-skill update detection |
| `update({ id, discardLocalChanges? })` | update one skill (transaction) |
| `uninstall({ id, confirm?, discardLocalChanges? })` | remove one managed skill (transaction) |

Every endpoint's outcome is normalized through a single error normalizer
(`src/rpc-error.ts`); no raw throw ever crosses the boundary. The client maps
`error.code` to localized copy plus one safe action — retry, confirm, or none —
in `src/client/copy.ts`.

The `id` field is overloaded by endpoint: `install`/`update` take the full
skills.sh `owner/repo/slug`, while `uninstall` takes the kebab-case skill name
(the manifest key) — matching the wire contract in `src/types.ts`.

## skills.sh compatibility adapter boundary

`src/skills-sh/client.ts` is the **only** code that knows skills.sh endpoint
shapes (ADR-0003). Everything else depends on its typed results.

- `search(q)` → `GET /api/search?q=&limit=&owner=` (credential-free
  compatibility endpoint used by the official CLI).
- `getSnapshot(id)` → `GET /api/download/{owner}/{repo}/{slug}` (GitHub sources
  only); returns `{ files: [{path, contents}], hash }`.
- ~10s timeout; retry transient 502/503/504 with bounded exponential backoff +
  jitter; map 429 → rate-limited, 404 (snapshot) → source-unavailable, malformed
  shape → typed "registry changed" error, never a crash.
- The documented `/api/v1/*` surface requires a Vercel OIDC token a local plugin
  cannot mint, so the compatibility endpoints are isolated behind this adapter;
  a future documented credential-free API can be swapped in without touching UI
  or business logic.

## Plugin-managed skills and the manifest

A **plugin-managed skill** is one recorded in the plugin's manifest at
`$DSH_HOME/skills/.system/skill-manager/manifest.json`. Anything else under the
skills root is *foreign* and is never listed, updated, or uninstalled.

- Written atomically via `@deepseek-ai/dsh-atomic-write`
  (`writeFileAtomic` + `withFileLock`); schema `version: 1`.
- Per-skill entry: `source`, `slug`, `remoteSourceHash`, `localContentHash`,
  `installedAt`, `updatedAt`.
- Reconcile-on-load: an entry whose directory is missing is dropped as
  already-uninstalled; a directory with no entry is foreign and left alone. A
  manifest with an unknown version or invalid shape is treated as **corrupt**
  and the transactions refuse rather than silently rebuild provenance.

## Two hashes are not comparable

The manifest records two hashes that are **separate concepts and must never be
compared as equivalent**:

- **`remoteSourceHash`** — the opaque `/api/download` `hash`. It is an **upstream
  update fingerprint**: update detection compares the server's current value
  against the value recorded at install/update. It is *never recomputed
  locally*.
- **`localContentHash`** — the plugin-computed deterministic SHA-256 over the
  installed files (sorted by relative path; digest updated with each file's path
  then contents). It is used *only* to detect **local modification/drift**.

A `remoteSourceHash` change signals an upstream update; a `localContentHash`
change signals local edits that must never be silently overwritten.

## Path safety

One reusable boundary (`src/path-safety.ts`, `SkillRoot`) guards every write and
delete. It fails closed:

1. validates the skill name against DSH's kebab-case grammar
   (`[a-z0-9]+(?:-[a-z0-9]+)*`);
2. refuses `..`, absolute paths, drive letters, UNC, and backslash separators;
3. resolves against `$DSH_HOME/skills` and requires strict containment
   (case-insensitive on Windows);
4. `realpath`/`lstat`s the target and every ancestor and refuses symlink/junction
   escapes;
5. applies the same containment to every nested snapshot file path.

Staged writes go to `.system/skill-manager/.staging/<slug>/` and are renamed
into place; deletes resolve-and-contain before removal. No operation can escape
`$DSH_HOME/skills`.

## Transactional boundaries

Each mutation composes the same primitives rather than re-implementing them:

- **Install** — validate id/source (GitHub `owner/repo` only) → fetch snapshot →
  validate snapshot (`SKILL.md` present with matching kebab-case `name` +
  non-empty `description`; safe paths; no duplicates) → duplicate/foreign gate →
  stage → atomic publish (backup-swap on overwrite) → record manifest *only after
  publish succeeds* → rollback on failure.
- **Update** — fetch latest snapshot → update-available iff latest
  `remoteSourceHash` ≠ recorded → drift iff recomputed `localContentHash` ≠
  recorded (gated behind `discardLocalChanges` consent) → stage → swap → update
  both hashes + `updatedAt` only after the swap succeeds.
- **Uninstall** — only a manifest-recorded skill is removable → drift gate →
  confirmation gate → delete directory → remove manifest entry atomically.
  Interrupted runs are recovered by reconcile-on-load.

## Client bundle purity

The rc.1 browser runtime seeds a fixed module table; a client bundle may only
`require()` those seed words. `scripts/seed-modules.json` is the single source of
truth for the eight seeds; `tsdown.config.mjs` externalizes them (and inlines
everything else), and `scripts/verify-client-purity.mjs` is the build-time gate
that fails if the emitted bundle ever `require()`s a non-seed module. This keeps
cross-plugin collaboration on the injected-service path only.
