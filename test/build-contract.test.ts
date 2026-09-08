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
