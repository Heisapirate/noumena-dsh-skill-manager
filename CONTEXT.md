# Noumena DSH Skill Manager

A DeepSeek Harness (DSH) plugin that lets a user search skills.sh, install and update skills, and manage the skills the plugin has installed — all from a page in the DSH WebUI settings.

## Language

**Skill**:
A self-contained instruction bundle DSH discovers and hands to the model. On disk it is a directory containing a `SKILL.md`, or a flat `.md` file, whose YAML frontmatter declares at least `name` and `description`.
_Avoid_: agent skill, capability, prompt pack

**Skill name**:
The kebab-case identifier (`a-z0-9` plus hyphens) that keys a skill in DSH; the same string as skills.sh's `slug`/`skillId`.
_Avoid_: id, title, label

**Source**:
Where a skill originates — a GitHub `owner/repo` or a well-known domain — as skills.sh reports it.
_Avoid_: repo, publisher, vendor

**Skills root**:
The DSH user skills directory `$DSH_HOME/skills` (default `~/.dsh/skills`); the only directory this plugin writes into.
_Avoid_: install directory, skills folder

**Plugin-managed skill**:
A skill under the Skills root whose provenance is recorded in the plugin's Manifest. Only these are listed, updated, or uninstalled by the plugin.
_Avoid_: installed skill, owned skill

**Manifest**:
The plugin-owned provenance record — per skill: source, skill name, remote source hash, local content hash, and install time — that separates plugin-managed skills from skills installed by users or other tools.
_Avoid_: lockfile, registry, database, index

**Remote source hash**:
The opaque hash fingerprint returned by skills.sh for a skill's upstream source; used only to detect whether the upstream/source skill has changed.
_Avoid_: content hash, checksum, version

**Local content hash**:
The plugin-computed deterministic SHA-256 over a skill's installed local files; used only to detect local modification or drift.
_Avoid_: remote hash, upstream hash, checksum

**Host / Client**:
The plugin's two halves. The Host runs inside the DSH Node process and owns filesystem and network access; the Client runs in the WebUI browser and owns only the interface. They communicate over Connection RPC.
_Avoid_: backend/frontend, server/browser, main/renderer

**Settings section**:
The top-level page in the DSH WebUI settings (`settings.section`) where this plugin registers its interface.
_Avoid_: settings tab, preferences page
