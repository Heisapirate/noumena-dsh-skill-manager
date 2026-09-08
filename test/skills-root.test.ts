// Unit tests for the skills-root resolver (src/skills-root.ts). This is the
// single point that decides the one directory the plugin may write into
// (CONTEXT.md, ADR-0001), so its resolution rules are locked here with an
// injected environment — never by reading the real DSH_HOME or touching a real
// skills root.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSkillsRoot } from '../src/skills-root';

describe('resolveSkillsRoot', () => {
  it('honors an explicit DSH_HOME and appends the skills root', () => {
    expect(resolveSkillsRoot({ DSH_HOME: 'C:\\custom-home' })).toBe(join('C:\\custom-home', 'skills'));
  });

  it('falls back to ~/.dsh/skills when DSH_HOME is absent', () => {
    expect(resolveSkillsRoot({})).toBe(join(homedir(), '.dsh', 'skills'));
  });

  it('treats a blank or whitespace-only DSH_HOME as absent', () => {
    const fallback = join(homedir(), '.dsh', 'skills');
    expect(resolveSkillsRoot({ DSH_HOME: '' })).toBe(fallback);
    expect(resolveSkillsRoot({ DSH_HOME: '   ' })).toBe(fallback);
  });
});
