# Open Questions (Phase 0 → Phase 1)

Phase 0 recorded the two unknowns below during environment verification.
Phase 1 (requirements & architecture discovery) has resolved both against
primary sources; the remaining items carry forward to the prototype and
implementation phases.

## A. Skill description source in `skills.sh` search response — RESOLVED

> The `skills.sh` search response appears **not** to expose a standalone
> `description` field. Open item: verify whether the required skill description
> should be obtained by fetching skill detail and parsing the `description` field
> from the `SKILL.md` YAML frontmatter.

**Resolution:** confirmed. Neither `GET /api/search` (legacy) nor
`GET /api/v1/skills/search` (documented) returns a `description`. The plugin
fetches `GET /api/download/{owner}/{repo}/{slug}` (anonymous), whose
`files[].contents` include `SKILL.md`, and parses the `description` from its
YAML frontmatter. The same call supplies the install payload and the update
`hash`. See ADR-0003 and the architecture doc.

## B. DSH external-plugin client build/settings integration (highest risk) — RESOLVED

> The DSH external-plugin client **build/settings integration** is the
> highest-risk unknown. It must be proven with a minimal prototype **before** any
> production implementation.

**Resolution:** the mechanism is now known. A plugin is a package whose
`package.json` declares `dsh.bundle.patch` (→ `cordis.patch.yml`, the host
half) and `dsh.client` (`platform: "web"` + `exports["./client"]`, the browser
half); it registers a `settings.section` page and speaks host↔client over
Connection RPC. A working community precedent (`AKS1st/dsh-skill-manager`)
reproduces the un-published `clientBundle` build preset. The prototype is
narrowed to **verifying the rc.6→rc.1 API drift and the reproduced build**
rather than proving the whole integration from scratch.

## Remaining open questions (carry forward)

1. **rc.6 → rc.1 API drift** — the reference example pins `@deepseek-ai/dsh-*@^0.1.0-rc.6`
   and calls `connection.rpc.handle(channel, handler, { authority })`; the
   installed `0.1.2-rc.1` types define `handle(channel, handler)` with a
   3-argument handler `(endpoint, payload, signal)`. Confirm the exact rc.1
   signature and the reproduced `clientBundle` preset in the Phase 2 prototype.
2. **skills.sh rate-limit facts** — `Retry-After` / `X-RateLimit-*` header values
   and any anonymous limit on `/api/search` or `/api/download` could not be
   captured live; treat 429/503 defensively regardless.
3. **Well-known (non-GitHub) sources** — deliberately out of install scope for
   now (ADR-0004); revisit the RFC 8615 `/.well-known/` flow only if a deliverable
   requires installing a domain-sourced skill.
