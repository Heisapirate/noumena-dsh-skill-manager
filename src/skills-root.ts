// Resolve the DSH user skills root — the only directory this plugin writes into.
// Per CONTEXT.md, the skills root is `$DSH_HOME/skills` (default `~/.dsh/skills`).

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve `$DSH_HOME/skills` (default `~/.dsh/skills`). Injectable for tests. */
export function resolveSkillsRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const dshHome = env.DSH_HOME && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : join(home, '.dsh');
  return join(dshHome, 'skills');
}
