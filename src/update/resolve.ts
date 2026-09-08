// Resolve the plugin's skills root from the environment for host wiring. Tests
// inject a temp root; this default is only used by the production host.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** `$DSH_HOME/skills`, where `$DSH_HOME` defaults to `~/.dsh` (spec glossary). */
export function resolveSkillsRoot(): string {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(dshHome, 'skills');
}
