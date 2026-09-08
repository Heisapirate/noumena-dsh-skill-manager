// Build-contract tests: lock the rc.1 client-module seed set and, once built,
// verify the emitted client bundle only `require()`s seed modules (the purity
// gate's contract, mirrored here so CI's `pnpm test` catches it too).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The rc.1 browser runtime static-module seed set (from dsh-web-frontend's `staticModules`). */
const RC1_SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
];

describe('rc.1 client module seed set', () => {
  it('scripts/seed-modules.json records the exact rc.1 seed set', () => {
    const { seedModules } = JSON.parse(
      readFileSync(join(repoRoot, 'scripts', 'seed-modules.json'), 'utf8'),
    ) as { seedModules: string[] };
    expect(seedModules).toEqual(RC1_SEED_MODULES);
  });
});

const clientBundle = join(repoRoot, 'lib', 'client.js');

describe('client bundle purity', () => {
  it.skipIf(!existsSync(clientBundle))('only require()s rc.1 seed modules', () => {
    const source = readFileSync(clientBundle, 'utf8');
    const required = new Set<string>();
    const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
    let match;
    while ((match = re.exec(source)) !== null) {
      required.add(match[2]);
    }
    const seeds = new Set(RC1_SEED_MODULES);
    const unknown = [...required].filter((specifier) => !seeds.has(specifier));
    expect(unknown).toEqual([]);
  });
});

describe('vitest discovery excludes nested worktrees', () => {
  it('locks the .worktrees exclusion and extends (not replaces) the defaults', () => {
    const config = readFileSync(join(repoRoot, 'vitest.config.mjs'), 'utf8');
    // Drop comment-only lines so a commented-out exclusion cannot satisfy this
    // lock — the tokens must live in executable config, not in a stale comment.
    const active = config
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    // Nested git worktrees are independent checkouts; the coordinator/main
    // worktree must only run its own suite, so discovery must never descend
    // into them. This also keeps the test runner off sibling worktrees (e.g.
    // the Issue #18 checkout).
    expect(active).toContain("'**/.worktrees/**'");
    expect(active).toContain('...configDefaults.exclude');
  });
});
