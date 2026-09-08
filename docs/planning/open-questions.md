# Open Questions (Phase 0 → Phase 1 → Phase 2)

Phase 0 recorded the two unknowns below. Phase 1 resolved their mechanism; Phase 2
(prototype) resolved the remaining risk and corrected the hash model against live
evidence. The short list at the end is what still remains before `/to-spec`.

## A. Skill description source in `skills.sh` search response — RESOLVED (source + strategy)

> The `skills.sh` search response appears **not** to expose a standalone
> `description` field. Open item: verify whether the required skill description
> should be obtained by fetching skill detail and parsing the `description` field
> from the `SKILL.md` YAML frontmatter.

**Resolution:** confirmed. Neither `GET /api/search` nor
`GET /api/v1/skills/search` returns a `description`; it is the `SKILL.md` YAML
frontmatter `description`, obtained from a `GET /api/download/{owner}/{repo}/{slug}`
snapshot. **Hydration strategy (Phase 2):** lazy/hybrid — render name/source/
installs immediately, hydrate the description on visible/expanded rows with
bounded concurrency + cancellation + cache, full snapshot only on install/update.
See ADR-0003 and `architecture.md` §8.

## B. DSH external-plugin client build/settings integration (highest risk) — RESOLVED (proven on rc.1)

> The DSH external-plugin client **build/settings integration** is the
> highest-risk unknown. It must be proven with a minimal prototype **before** any
> production implementation.

**Resolution:** proven end-to-end on `0.1.2-rc.1` (Phase 2 prototype, real browser):
GitHub-commit install via `dsh plugin`, DSH Web boot, external client bundle load,
`settings.section` render, browser→host→browser RPC round trip, and clean
uninstall/restart all confirmed. The host RPC signature is
`connection.rpc.handle('/skill-manager', (endpoint, payload, signal) => …)`.

## Remaining open questions (carry to /to-spec)

1. **rc.1 `PLATFORM_MODULES` table** — the client build `external` list was taken
   from the rc.6 reference; confirm it against the installed rc.1 source before
   freezing the production build config.
2. **skills.sh rate-limit facts** — no `Retry-After`/`X-RateLimit-*` headers or
   anonymous limits were observable; implement conservative retry/backoff.
3. **Well-known (non-GitHub) sources** — still out of install scope (ADR-0004);
   revisit the RFC 8615 `/.well-known/` flow only if a deliverable requires
   installing a domain-sourced skill.

## Resolved (no longer open)

- **Snapshot hash convention (Phase 1 assumption, corrected in Phase 2):** the
  `/api/download` `hash` is an **opaque** upstream fingerprint, not the
  documented SHA-256 sorted-path+contents function (fixture test disproved 20+
  conventions). `remoteSourceHash` (update detection) and `localContentHash`
  (plugin-computed drift detection) are separate and never compared as equivalent.
