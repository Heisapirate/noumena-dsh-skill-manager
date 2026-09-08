# DSH Skill Manager

A DeepSeek Harness (DSH) plugin that adds a **DSH Skill Manager** page to the
DSH WebUI settings. Search [skills.sh](https://skills.sh), install and update
skills, and manage the plugin-managed skills on this machine — all without
leaving DSH.

It installs from GitHub with a single command, requires no changes to DSH
source, and confines every filesystem mutation to DSH's user skills root
(`$DSH_HOME/skills`).

## Features

- **Live search** of skills.sh, debounced with a minimum 2-character query and
  progressive description hydration.
- **Result metadata** per hit: `name`, `description`, `source`, install count,
  and a link to the skill's skills.sh page (the description hydrates
  progressively and degrades to "description unavailable" rather than failing
  the row).
- **One-click install** of GitHub-backed skills into `$DSH_HOME/skills` so DSH
  discovers them automatically.
- **Plugin-managed skills list** — only skills this plugin installed (recorded
  in its manifest) are listed, updated, or uninstalled.
- **Update detection** — an "Update available" badge appears when the upstream
  `remoteSourceHash` changes; updates are confirmation-gated.
- **Uninstall** with explicit confirmation and local-modification protection.
- **Complete state handling** — loading, empty, error, duplicate, source-
  unavailable, update-failure, and success states, plus confirmation gates for
  every destructive action.

## Install

One command installs the plugin into DSH's `web` profile:

```sh
dsh plugin --profile web add github:Heisapirate/noumena-dsh-skill-manager
```

Then start the WebUI:

```sh
dsh web
```

Open **Settings → DSH Skill Manager**. The page appears under the WebUI
settings and shows a live **Host connection** status answered over RPC.

The built `lib/` is committed, so the install needs no post-install build and no
separate `npm`/`pnpm` step. The command was verified against DSH `0.1.2-rc.1`
(it initializes the profile and reconciles `dsh-skill-manager` into the
profile's bundle list).

## Usage

DSH WebUI → **Settings → DSH Skill Manager**:

1. **Search** — type a keyword (≥2 characters) into *Search skills.sh*; results
   show name, description, source, install count, and a link to the skill's
   skills.sh page.
2. **Install** — click **Install** on a result; it appears in *Managed skills*.
3. **Managed skills** — lists what the plugin installed, with source and install
   time; click **Refresh** to re-check update status.
4. **Update** — when a skill shows **Update available**, click **Update** and
   confirm.
5. **Uninstall** — click **Uninstall** and confirm; the skill and its manifest
   entry are removed.

## Screenshots

Screenshots are captured as real images — none are fabricated, and the files are
added as a human capture step before final submission. The exact capture
checklist and filenames live in [`docs/screenshots.md`](docs/screenshots.md);
images are placed in [`docs/assets/`](docs/assets/). The five planned captures
are:

- `docs/assets/search-results.png` — the settings page with populated search
  results and their metadata
- `docs/assets/install-success.png` — a search row flipped to the "Installed"
  success state after install
- `docs/assets/managed-update-available.png` — managed skill with update badge
- `docs/assets/uninstall-confirmation.png` — uninstall confirmation prompt
- `docs/assets/managed-empty-state.png` — empty state after uninstall

## Architecture

Two halves split across the DSH process boundary, joined by one typed RPC
channel:

```
Browser client (settings.section "DSH Skill Manager")
   ↓
typed RPC  /skill-manager
   ↓
host service
   ├─ SkillsShClient     skills.sh adapter (only code that knows endpoint shapes)
   ├─ ManifestStore      plugin-owned provenance; atomic write + reconcile
   ├─ path safety        grammar + containment + realpath for every mutation
   ├─ install / update / uninstall transactions
   ↓
$DSH_HOME/skills
```

- The **host** (Node, inside the DSH process) owns networking, filesystem,
  manifest, hashing, path validation, and all mutations.
- The **client** (WebUI browser) owns only the interface and calls the host over
  the `/skill-manager` Connection RPC channel; every endpoint returns
  `{ok,value} | {ok:false,error:{code,message,details}}`.
- The manifest records two hashes that are **never compared as equivalent**:
  `remoteSourceHash` (opaque upstream update fingerprint) and
  `localContentHash` (plugin-computed local-drift hash).

Full details in [`docs/architecture.md`](docs/architecture.md) and the ADRs in
[`docs/adr/`](docs/adr/).

## Safety / ownership

- Only **plugin-managed** skills are mutated; foreign skills are never listed,
  updated, or uninstalled.
- The plugin writes only into `$DSH_HOME/skills`; no arbitrary browser path ever
  reaches a mutation.
- Local modifications are detected via the local content hash and are never
  silently overwritten — update/uninstall require explicit confirmation.
- Path safety rejects traversal, absolute paths, drive letters, backslashes, and
  symlink/junction escapes, with `realpath` containment before every write.
- A corrupt manifest is refused (never silently rebuilt), so provenance is never
  orphaned.

## Testing

The accepted merged-main evidence (Issue #20 is documentation-only, so these
figures are unchanged):

- `pnpm run test` — **441 passed / 28 files**
- `pnpm run check` — **PASS** (typecheck)
- `pnpm run build` — **PASS** (host + client build + client purity gate)
- `pnpm run smoke` — **PASS** (host-side RPC smoke against the built bundle)

Major test groups: path safety (table-driven escapes), manifest
(store/reconcile/hash/read), skills.sh (client/domain/errors/frontmatter/
validation), install and uninstall transactions, update (manager/status/swap/
RPC), and the client (search engine/view/hydrator, copy, actions store, RPC).

## Known limitations

- skills.sh search/download use **credential-free compatibility endpoints** that
  are undocumented and carry no stability contract; they are isolated behind the
  `SkillsShClient` adapter so a shape change degrades gracefully rather than
  crashing (ADR-0003).
- Live availability can be affected by skills.sh, network, or rate limits; these
  surface as typed, retryable error states, not product failures.
- Installing **well-known (non-GitHub) sources** is out of scope; such results
  surface the required **unavailable source** state (ADR-0004).

## Engineering workflow

Built issue-by-issue on isolated branches/worktrees with TDD and code review,
each PR linked to its issue and merged into a green `main`. Representative
PR/issue pairs: #22→#9 (plugin foundation), #24→#11 (path safety), #23→#12
(skills.sh client), #25→#10 (manifest), #30→#13 (search UI), #28→#14 (install),
#32→#15 (managed skills), #29→#16 (update), #31→#17 (uninstall), #34→#18 (error
polish), #33→#19 (test hardening).

## AI / tooling disclosure

This repository was produced with the DeepSeek Harness and the
**DeepSeek-V4-Pro High** model, using the `implement`, `tdd`, and `code-review`
skills. Key human judgments were recorded in the ADRs and PR descriptions.

## Development

```sh
pnpm install    # install dependencies
pnpm run check  # typecheck (tsc --noEmit)
pnpm run build  # host + client build + client purity gate
pnpm run test   # unit tests (vitest)
pnpm run smoke  # host-side RPC smoke against the built bundle
```

The committed `lib/` is rebuilt by `pnpm run build`; `dsh plugin add` consumes
the committed bundle directly.

## License

MIT (declared in `package.json`).
