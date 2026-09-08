# skills.sh API: documented v1 is unusable locally; compatibility endpoints sit behind a client adapter

skills.sh exposes two distinct tiers, and the plugin treats them differently:

- **`/api/v1/*`** is the **documented, stable** surface. It is neither rejected nor obsolete — it is simply **unsuitable for this plugin** because it requires a Vercel OIDC bearer token, which a locally installed DSH plugin cannot mint.
- **`/api/search`** and **`/api/download/{owner}/{repo}/{slug}`** are **credential-free compatibility endpoints** that the official `vercel-labs/skills` CLI itself uses (`src/find.ts`, `src/blob.ts`). They are implementation-backed and carry **no documented stability contract** — their shape may change or disappear without notice.

Both tiers are therefore hidden behind a single host-side **`SkillsShClient`** adapter, the only code allowed to know endpoint shapes. Application and UI code depend only on the adapter's typed results (`search`, `getSnapshot`), never on raw response JSON. The adapter maps every failure — including a change in a compatibility endpoint's shape, a 404, an auth/rate-limit response, or a timeout — to typed errors and a defined degradation path ("search unavailable" / "unavailable source"), so the plugin fails gracefully instead of breaking when skills.sh changes.

Descriptions still come from the `SKILL.md` YAML frontmatter inside a download snapshot; search returns no `description` on either tier. The search-list hydration strategy is now **decided (Phase 2): lazy/hybrid** — render basic search fields immediately, hydrate the description on visible/expanded rows with bounded concurrency + cancellation + cache, and fetch the full snapshot only for install/update. The snapshot `hash` is an **opaque** upstream fingerprint (`remoteSourceHash`); it is not reproducible from the returned bytes and is never compared to the plugin's own `localContentHash`.

**Revisit trigger:** if skills.sh later publishes a *documented, credential-free* API usable by a local client, reopen this ADR and prefer that surface over the compatibility endpoints.
