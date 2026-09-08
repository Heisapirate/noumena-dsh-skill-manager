# Open Questions (Phase 0 → Phase 1)

Phase 0 recorded the two unknowns below during environment verification.
Phase 1 (requirements & architecture discovery) resolved both against primary
sources. What remains open — the description-fetch strategy and the rc.1
build/RPC proof — feeds the Phase 2 prototype.

## A. Skill description source in `skills.sh` search response — SOURCE resolved, STRATEGY open

> The `skills.sh` search response appears **not** to expose a standalone
> `description` field. Open item: verify whether the required skill description
> should be obtained by fetching skill detail and parsing the `description` field
> from the `SKILL.md` YAML frontmatter.

**Resolution (source):** confirmed. Neither `GET /api/search` nor
`GET /api/v1/skills/search` returns a `description`. The description is the
`SKILL.md` YAML frontmatter `description`, obtained from a
`GET /api/download/{owner}/{repo}/{slug}` snapshot. See ADR-0003.

**Reopened (fetch strategy):** *how* the search list hydrates descriptions is a
Phase 2 benchmark, not a locked decision — `/api/download` returns the whole
snapshot (large for some root-level skills), while the official CLI fetches raw
`SKILL.md` separately for metadata. Candidate approaches and the metrics to
measure are in `architecture.md` §8.

## B. DSH external-plugin client build/settings integration (highest risk) — MECHANISM resolved, prototype still required

> The DSH external-plugin client **build/settings integration** is the
> highest-risk unknown. It must be proven with a minimal prototype **before** any
> production implementation.

**Resolution:** the mechanism is now known. A plugin is a package whose
`package.json` declares `dsh.bundle.patch` (→ `cordis.patch.yml`, the host
half) and `dsh.client` (`platform: "web"` + `exports["./client"]`, the browser
half); it registers a `settings.section` page and speaks host↔client over
Connection RPC. A working community precedent (`AKS1st/dsh-skill-manager`)
reproduces the un-published `clientBundle` build preset. The prototype is now
defined by the explicit DSH 0.1.2-rc.1 acceptance criteria in
`architecture.md` §8.

## Remaining open questions (carry to the Phase 2 prototype)

1. **rc.6 → rc.1 API drift + reproduced `clientBundle` build** — verify the exact
   rc.1 `connection.rpc.handle` signature and that the reproduced preset emits a
   loadable `./client` bundle on the installed 0.1.2-rc.1.
2. **Description-fetch strategy** — benchmark A/B/C and decide from measured
   evidence (requests/search, payload size, latency, rate-limit behavior,
   cacheability, stale-query cancellation, failure UX). See `architecture.md` §8.
3. **Snapshot hash convention** — confirm the SHA-256 sorted-path+contents
   function against a real `/api/download` fixture; assert the locally recomputed
   hash equals the remote `hash` for a clean install and diverges after an edit.
4. **skills.sh rate-limit facts** — `Retry-After` / `X-RateLimit-*` header values
   and any anonymous limit on `/api/search` or `/api/download` could not be
   captured live; treat 429/503 defensively regardless.
5. **Well-known (non-GitHub) sources** — deliberately out of install scope for
   now (ADR-0004); revisit the RFC 8615 `/.well-known/` flow only if a deliverable
   requires installing a domain-sourced skill.
