// Resolve the DSH user skills root (`$DSH_HOME/skills`, default `~/.dsh/skills`).
// This is the only directory the plugin writes into (CONTEXT.md, ADR-0001) and
// the resolution is host-only — the browser never sees it.

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the skills root from the environment. `DSH_HOME` (the same variable
 * DSH's own runtime uses) overrides the `~/.dsh` default.
 */
export function resolveSkillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, 'skills');
}
