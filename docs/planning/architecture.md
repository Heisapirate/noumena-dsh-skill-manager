# Architecture — Noumena DSH Skill Manager

Production-facing architecture, updated with verified Phase 2 prototype
evidence. Terms follow `CONTEXT.md`; hard-to-reverse decisions live in
`docs/adr/`. Primary evidence: DSH `@deepseek-ai/*@0.1.2-rc.1` (verified
end-to-end by the Phase 2 prototype) and the live skills.sh API.

## 1. Product shape

A DeepSeek Harness (DSH) plugin installed via `dsh plugin` from GitHub that
adds a **Skill Manager** page to the DSH WebUI settings. It searches skills.sh,
installs/updates/uninstalls skills into DSH's user skills root, and lists the
skills it manages.

## 2. DSH integration — proven on 0.1.2-rc.1

- **Install:** `dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager`
  (a thin `pnpm` forwarder that reconciles `dsh.profile.bundles`). The repo must
  declare, in `package.json`: `dsh.bundle.patch` → `cordis.patch.yml` (host half),
  `dsh.client` (`platform: "web"`, `inject: [...]`) plus `exports["."]` (host
  entry) and `exports["./client"]` (browser bundle). **Verified:** the exact
  GitHub-commit install cloned, installed, and reconciled the bundle into the
  profile.
- **Settings entry:** the browser half registers a top-level `settings.section`
  page (nav `id` + `order` + localized `label`) via `ctx.slots.inject`.
  **Verified:** rendered in a real Windows browser.
- **Host / client split:** the host half (Node, inside the DSH process) owns all
  filesystem and network work; the browser half owns only the UI. This is forced,
  not chosen — the browser runtime has no `fetch`/filesystem access.
- **RPC:** the host registers `connection.rpc.handle('/skill-manager', handler)`
  (rc.1: handler `(endpoint, payload, signal) → {ok,value}|{ok,false,error}`); the
  browser calls `connection.rpc.call('/skill-manager', endpoint, payload)`.
  Endpoints: `search`, `install`, `list`, `checkUpdates`, `update`, `uninstall`.
  **Verified:** the browser → host → browser round trip succeeded on rc.1.
- **Build:** reproduce the un-published `clientBundle` preset (as the
  `AKS1st/dsh-skill-manager` precedent does) so `tsdown` emits both
  `lib/index.js` (host) and `lib/client.js` (browser closure), with
  `fixedExtension: false` so the host emits `.js` not `.mjs`. Commands:
  `pnpm run check` (tsc --noEmit), `pnpm run build` (tsc + tsdown),
  `pnpm run test` (vitest). **Before freezing the production build config,**
  confirm the rc.1 `PLATFORM_MODULES` table (the client `external` list) against
  the installed rc.1 source — the prototype used the rc.6 reference list.

## 3. skills.sh integration

- **API tiers.** `/api/v1/*` is the documented, stable surface but requires a
  Vercel OIDC token a local plugin cannot mint; `/api/search` and
  `/api/download/{owner}/{repo}/{slug}` are credential-free compatibility
  endpoints used by the official `vercel-labs/skills` CLI and carry no stability
  contract. (ADR-0003)
- **Adapter.** a host-side `SkillsShClient` is the only code that knows these
  endpoint shapes; UI/application code depends only on its typed results. Typed
  failure and a defined degradation path are required if the compatibility
  endpoints change.
- **Search:** `GET /api/search?q=<≥2 chars>&limit=&owner=` →
  `skills[].{id, name, skillId, installs, source}`; page link = `https://skills.sh/{id}`.
- **Snapshot:** `GET /api/download/{owner}/{repo}/{slug}` →
  `{ files: [{path, contents}], hash }` (GitHub sources only). `hash` is the
  opaque **remoteSourceHash** (§4.5), fetched only for install/update.
- **Description source:** `SKILL.md` YAML frontmatter `description`, parsed from
  a snapshot. Hydration is **lazy/hybrid** (§8).
- **Networking policy:** timeout ~10s; exponential backoff + jitter; honor
  `Retry-After` on 429; retry 503; map 400/401/403/404/429/503 to typed errors.
  No anonymous rate limits are documented → treat conservatively regardless. All
  calls are host-side; the browser never contacts skills.sh.

## 4. Area resolutions

1. **Ownership** — plugin owns `$DSH_HOME/skills` (user root, rank 400); a
   *plugin-managed skill* is one recorded in the manifest; foreign entries are
   never listed/updated/uninstalled. (ADR-0001)
2. **Manifest** — `$DSH_HOME/skills/.system/skill-manager/manifest.json`; fields
   `source, slug, remoteSourceHash, localContentHash, installedAt, updatedAt`;
   atomic via `dsh-atomic-write`; drift reconciled on load. (ADR-0002)
3. **Path safety** — validate the skill name against DSH's kebab grammar, resolve
   against the skills root, require `realpath` containment; refuse `..`, absolute,
   drive-letter, backslash, and symlink/junction escapes; stage writes and rename
   in. Writes/deletes can never leave `$DSH_HOME/skills/<name>`.
4. **Install** — one `/api/download` snapshot → write `files[].path` under
   `$DSH_HOME/skills/<name>/`; existing directory ⇒ duplicate/overwrite prompt;
   stage to `.system/skill-manager/.staging/` then rename (dir appears complete or
   not at all); remove staging on failure.
5. **Hashes & update (corrected by Phase 2).** The manifest stores two hashes that
   are **separate concepts and must never be compared as equivalent**:
   - **`remoteSourceHash`** — the opaque `/api/download` `hash`, an upstream
     fingerprint. Update detection compares it hash-to-hash (server value now vs
     the value recorded at install); it is **never recomputed locally**.
   - **`localContentHash`** — the plugin-computed deterministic hash over the
     installed files (below), recomputed from disk to detect local modification.
   If `localContentHash` diverges from the recorded value, the skill was modified
   locally — do not silently replace; require confirmation.
6. **Uninstall** — only manifest-recorded skills whose local content matches; remove
   directory then manifest entry (atomic); confirm; reconcile on next load if
   interrupted.
7. **Description source** — `SKILL.md` frontmatter from a snapshot (ADR-0003);
   hydration = lazy/hybrid (§8).
8. **Networking** — `SkillsShClient` adapter over search + download; typed errors
   and conservative retry/backoff as in §3.
9. **DSH integration** — `settings.section` page; host owns fs/network/path
   validation; browser UI via `/skill-manager` Connection RPC (ADR-0001…0003).
10. **UI states** — see §5.
11. **Testing boundaries** — see §6.
12. **Acceptance criteria** — see §7.

**Local content hash (deterministic function).** The plugin's own `localContentHash`
is SHA-256 over the installed files sorted lexicographically by path, digest
updated with each file's path followed by its contents:

```
localContentHash(files):
  h = SHA256()
  for f in files sorted by path (byte order):
    h.update(f.path); h.update(f.contents)
  return hex(h.digest())
```

This function is used **only** for local drift detection. The remote
`/api/download` `hash` is an opaque server fingerprint and is **not reproducible**
from the returned bytes — the Phase 2 fixture test disproved the documented
convention and 20+ alternatives — so `remoteSourceHash` and `localContentHash`
are never compared against each other.

## 5. UI states

| State | Trigger | Render |
|---|---|---|
| loading | search/install/update in flight | spinner / disabled action |
| empty search | 0 results (or query < 2 chars) | empty message |
| network failure | fetch/HTTP error | retry affordance + error |
| duplicate install | target directory already exists | confirm-overwrite dialog |
| update available | latest remoteSourceHash ≠ manifest remoteSourceHash | badge + update action |
| update failure | replace failed | error, skill unchanged |
| unavailable source | non-GitHub source / 404 on install | unavailable message |
| destructive confirm | overwrite/update/uninstall | explicit confirm gate |
| success | op completed | confirmation toast |

## 6. Testing boundaries (Vitest, host logic against a temp skills root + mocked fetch)

- **install** — writes files; duplicate detection; partial-failure leaves no
  partial directory.
- **update** — remoteSourceHash comparison; localContentHash drift detection;
  manifest update on success only.
- **uninstall** — removes only manifest-recorded + matching skills; foreign dirs
  untouched; manifest entry removed.
- **path safety** — table-driven: `../`, absolute, `C:\`, backslash,
  symlink/junction, `..\..` all refused; valid names pass.
- **manifest** — load/reconcile drift; atomic write; foreign-vs-managed
  classification.
- **local content hash** — deterministic function (sorted path + contents); a
  one-byte edit changes it; it is independent of the opaque remoteSourceHash.
- **API client** — 400/401/403/404/429/503 → typed errors; retry/backoff; timeout;
  compatibility-endpoint shape change → typed degradation, never a crash.

## 7. Acceptance criteria (implementation)

| Exam requirement | Testable criterion |
|---|---|
| 按关键词搜索 | query ≥2 chars returns skills.sh results; <2 chars shows empty/validation state |
| 展示名称/简介/来源/安装量/链接 | each result row renders name, description, source, install count, link `https://skills.sh/{id}` |
| 安装并让 DSH 发现 | after confirm, `$DSH_HOME/skills/<name>/SKILL.md` exists with valid frontmatter and DSH lists the skill |
| 列出插件管理的本机技能 | lists exactly manifest-recorded skills present on disk; foreign skills excluded |
| 检查更新并更新 | "update available" when latest remoteSourceHash ≠ manifest remoteSourceHash; local drift via localContentHash; update replaces files + updates both hashes |
| 卸载 | removes skill dir + manifest entry; DSH no longer lists it |
| 处理 6 种状态 | loading/empty/network-failure/duplicate-install/update-failure/unavailable-source all reachable (§5) |
| `dsh plugin` 安装 | repo has `dsh.bundle.patch` + `cordis.patch.yml` + `exports["."]` + `dsh.client` + `exports["./client"]`; install succeeds and settings page appears |
| 独立入口 | registers a top-level `settings.section` |
| 不改 DSH 源码 | zero DSH source edits |
| 写入/更新/删除只在技能目录 | path-safety tests prove all mutations stay inside `$DSH_HOME/skills` |
| 覆盖/更新/卸载前确认 | UI confirmation gate before each destructive op |
| build/typecheck/test 命令 | `pnpm build`, `pnpm check`, `pnpm test` succeed |
| 测试覆盖 | vitest covers install, update, uninstall, path safety, local content hash (§6) |
| README 安装命令 | README has a copy-paste `dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager` |

## 8. Phase 2 prototype — verified + resolved

**Verified chain (all confirmed on DSH 0.1.2-rc.1, real browser):** exact GitHub
commit install → DSH Web boot → external client bundle load → `settings.section`
render → browser→host→browser RPC round trip → clean uninstall/restart.

**Description hydration (DECIDED): lazy/hybrid.** Render the basic search fields
(name, source, install count, page link) immediately; hydrate the description on
visible/expanded rows with bounded concurrency, cancellation, and an in-memory
cache keyed by slug; fetch the full snapshot only for install/update. Evidence:
eager `/api/download` hydration cost ≈ 6 requests / ~572 KB / ~3.3 s for 5
results (one snapshot was 243 KB), and skills.sh exposes no description field in
search.

## 9. Remaining open questions

See `docs/planning/open-questions.md`.
