# Phase 1 Architecture — Noumena DSH Skill Manager

Discovery output. No application code is written in this phase. Terms follow
`CONTEXT.md`; hard-to-reverse decisions live in `docs/adr/`. Primary evidence:
DSH `@deepseek-ai/*@0.1.2-rc.1` (local checkout) and the live skills.sh API.

## 1. Product shape

A DeepSeek Harness (DSH) plugin installed via `dsh plugin` from GitHub that
adds a **Skill Manager** page to the DSH WebUI settings. It searches skills.sh,
installs/updates/uninstalls skills into DSH's user skills root, and lists the
skills it manages.

## 2. DSH integration

- **Install:** `dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager`
  (a thin `pnpm` forwarder that reconciles `dsh.profile.bundles`). The repo must
  declare, in `package.json`: `dsh.bundle.patch` → `cordis.patch.yml` (host half),
  `dsh.client` (`platform: "web"`, `inject: [...]`) plus `exports["."]` (host
  entry) and `exports["./client"]` (browser bundle).
- **Settings entry:** the browser half registers a top-level `settings.section`
  page (nav `id` + `order` + localized `label`) via `ctx.slots.inject`.
- **Host / client split:** the host half (Node, inside the DSH process) owns all
  filesystem and network work; the browser half owns only the UI. This is forced,
  not chosen — the browser runtime has no `fetch`/filesystem access.
- **RPC:** the host registers `connection.rpc.handle('/skill-manager', handler)`
  (rc.1: handler `(endpoint, payload, signal) → {ok,value}|{ok,false,error}`); the
  browser calls `connection.rpc.call('/skill-manager', endpoint, payload)`.
  Endpoints: `search`, `install`, `list`, `checkUpdates`, `update`, `uninstall`.
- **Build:** reproduce the un-published `clientBundle` preset (as the
  `AKS1st/dsh-skill-manager` precedent does) so `tsdown` emits both
  `lib/index.js` (host) and `lib/client.js` (browser). Commands:
  `pnpm run check` (tsc --noEmit), `pnpm run build` (tsc + tsdown),
  `pnpm run test` (vitest).

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
  remote snapshot hash (§4.5).
- **Description source:** `SKILL.md` YAML frontmatter `description`, parsed from
  a snapshot. The **fetch strategy** for the search list is an open Phase 2
  benchmark (§8), not a locked decision.
- **Networking policy:** timeout ~10s; exponential backoff + jitter; honor
  `Retry-After` on 429; retry 503; map 400/401/403/404/429/503 to typed errors.
  All calls are host-side; the browser never contacts skills.sh.

## 4. Area resolutions

1. **Ownership** — plugin owns `$DSH_HOME/skills` (user root, rank 400); a
   *plugin-managed skill* is one recorded in the manifest; foreign entries are
   never listed/updated/uninstalled. (ADR-0001)
2. **Manifest** — `$DSH_HOME/skills/.system/skill-manager/manifest.json`; fields
   `source, slug, hash, installedAt, updatedAt`; atomic via `dsh-atomic-write`;
   drift reconciled on load. (ADR-0002)
3. **Path safety** — validate the skill name against DSH's kebab grammar, resolve
   against the skills root, require `realpath` containment; refuse `..`, absolute,
   drive-letter, backslash, and symlink/junction escapes; stage writes and rename
   in. Writes/deletes can never leave `$DSH_HOME/skills/<name>`.
4. **Install** — one `/api/download` snapshot → write `files[].path` under
   `$DSH_HOME/skills/<name>/`; existing directory ⇒ duplicate/overwrite prompt;
   stage to `.system/skill-manager/.staging/` then rename (dir appears complete or
   not at all); remove staging on failure.
5. **Content hash & update** — the manifest records the **remote snapshot hash**
   (`/api/download` `hash`). Update available ⇐ latest snapshot `hash` ≠ manifest
   `hash`. Local modification is detected by recomputing the **local content
   hash** with the identical function and comparing; if it diverges from the
   recorded hash, do not silently replace — require confirmation. (See below.)
6. **Uninstall** — only manifest-recorded + hash-matching skills; remove directory
   then manifest entry (atomic); confirm; reconcile on next load if interrupted.
7. **Description source** — `SKILL.md` frontmatter from a snapshot (ADR-0003);
   hydration strategy is open (§8).
8. **Networking** — `SkillsShClient` adapter over search + download; typed errors
   and retry/backoff as in §3.
9. **DSH integration** — `settings.section` page; host owns fs/network/path
   validation; browser UI via `/skill-manager` Connection RPC (ADR-0001…0003).
10. **UI states** — see §5.
11. **Testing boundaries** — see §6.
12. **Acceptance criteria** — see §7.

**Snapshot/content hash (deterministic function).** SHA-256 over the snapshot's
files sorted lexicographically by path, updating the digest with each file's
path followed by its contents:

```
snapshotHash(files):
  h = SHA256()
  for f in files sorted by path (byte order):
    h.update(f.path); h.update(f.contents)
  return hex(h.digest())
```

The remote `/api/download` `hash` and the locally recomputed content hash are
this **same function** computed at different times/places: they are semantically
identical for an unmodified install and diverge exactly when the on-disk files
differ from the snapshot (the drift signal). The exact byte-level convention
(path/contents separator, encoding) is confirmed against a real `/api/download`
fixture in the Phase 2 prototype.

## 5. UI states

| State | Trigger | Render |
|---|---|---|
| loading | search/install/update in flight | spinner / disabled action |
| empty search | 0 results (or query < 2 chars) | empty message |
| network failure | fetch/HTTP error | retry affordance + error |
| duplicate install | target directory already exists | confirm-overwrite dialog |
| update available | latest hash ≠ manifest hash | badge + update action |
| update failure | replace failed | error, skill unchanged |
| unavailable source | non-GitHub source / 404 on install | unavailable message |
| destructive confirm | overwrite/update/uninstall | explicit confirm gate |
| success | op completed | confirmation toast |

## 6. Testing boundaries (Vitest, host logic against a temp skills root + mocked fetch)

- **install** — writes files; duplicate detection; partial-failure leaves no
  partial directory.
- **update** — hash comparison; local-modification detection; manifest update on
  success only.
- **uninstall** — removes only manifest+hash-matching dirs; foreign dirs
  untouched; manifest entry removed.
- **path safety** — table-driven: `../`, absolute, `C:\`, backslash,
  symlink/junction, `..\..` all refused; valid names pass.
- **manifest** — load/reconcile drift; atomic write; foreign-vs-managed
  classification.
- **content hash** — deterministic function (sorted path + contents); recomputed
  local hash equals a downloaded fixture's remote `hash`; a one-byte edit changes
  it.
- **API client** — 400/401/403/404/429/503 → typed errors; retry/backoff; timeout;
  compatibility-endpoint shape change → typed degradation, never a crash.

## 7. Acceptance criteria (implementation)

| Exam requirement | Testable criterion |
|---|---|
| 按关键词搜索 | query ≥2 chars returns skills.sh results; <2 chars shows empty/validation state |
| 展示名称/简介/来源/安装量/链接 | each result row renders name, description, source, install count, link `https://skills.sh/{id}` |
| 安装并让 DSH 发现 | after confirm, `$DSH_HOME/skills/<name>/SKILL.md` exists with valid frontmatter and DSH lists the skill |
| 列出插件管理的本机技能 | lists exactly manifest-recorded skills present on disk; foreign skills excluded |
| 检查更新并更新 | "update available" when latest remote snapshot hash ≠ manifest hash; local recompute detects edits; update replaces files + updates manifest |
| 卸载 | removes skill dir + manifest entry; DSH no longer lists it |
| 处理 6 种状态 | loading/empty/network-failure/duplicate-install/update-failure/unavailable-source all reachable (§5) |
| `dsh plugin` 安装 | repo has `dsh.bundle.patch` + `cordis.patch.yml` + `exports["."]` + `dsh.client` + `exports["./client"]`; install succeeds and settings page appears |
| 独立入口 | registers a top-level `settings.section` |
| 不改 DSH 源码 | zero DSH source edits |
| 写入/更新/删除只在技能目录 | path-safety tests prove all mutations stay inside `$DSH_HOME/skills` |
| 覆盖/更新/卸载前确认 | UI confirmation gate before each destructive op |
| build/typecheck/test 命令 | `pnpm build`, `pnpm check`, `pnpm test` succeed |
| 测试覆盖 | vitest covers install, update, uninstall, path safety, content hash (§6) |
| README 安装命令 | README has a copy-paste `dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager` |

## 8. Phase 2 prototype — open decision + acceptance criteria

**Description-fetch strategy (benchmark, then decide).** `/api/download` returns
the full snapshot (not just `SKILL.md`), and some root-level skills have large
snapshots; the official CLI fetches raw `SKILL.md` separately for metadata before
downloading the full snapshot for install. Candidate approaches to benchmark:

- **A.** bounded visible-row `/api/download` hydration (concurrency-capped + cached);
- **B.** GitHub Trees API + raw `SKILL.md` metadata fetch, full snapshot only on install;
- **C.** any other current-source-supported approach discovered during the prototype.

The prototype must measure, per candidate: requests per search, payload size,
latency, rate-limit behavior, cacheability, stale-query cancellation, and failure
UX. The production choice is made from this evidence.

**DSH 0.1.2-rc.1 prototype acceptance criteria.** On the exact installed rc.1
environment, the prototype must prove all six:
1. `dsh plugin` installs the plugin from its GitHub repository;
2. `dsh web` still boots with no client-module loader failures;
3. the custom `settings.section` renders;
4. browser → host RPC succeeds;
5. host → browser response succeeds;
6. uninstall + restart returns DSH to a clean state.

## 9. Remaining open questions

See `docs/planning/open-questions.md`.
