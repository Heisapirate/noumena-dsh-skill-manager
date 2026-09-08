# The plugin owns the DSH user skills root

The skill manager installs skills into `$DSH_HOME/skills` (default `~/.dsh/skills`) — the DSH **user skills root**. This is the one directory the plugin writes into, and DSH discovers it with no configuration: `@deepseek-ai/dsh-skill-filesystem` scans that root (rank 400) and surfaces any directory containing a `SKILL.md` (or flat `.md`) with valid `name`/`description` frontmatter. Installing into it therefore satisfies "make DSH discover the skill" with zero DSH source changes.

Because that root is shared with skills that users or other tools may have installed, the plugin never lists, updates, or uninstalls an entry that is not recorded in its own manifest (see ADR-0002), and it treats the root's `.system` subdirectory (skipped by DSH discovery) as reserved.

**Considered options:**

- **`$DSH_HOME/skills`** (chosen): DSH-native, discovered automatically, no config, global scope.
- **A plugin-private directory registered via `customSkillDirs`**: isolated from user/third-party skills, but requires changing DSH configuration and re-implements discovery that DSH already provides.
- **The project-scoped `.dsh/skills` root**: wrong scope — per-workspace rather than a machine-level install.

**Consequences:** every filesystem mutation the plugin performs must be confined to `$DSH_HOME/skills/<validated-skill-name>`, and the plugin must distinguish its own skills from foreign ones via the manifest rather than by directory ownership alone.
