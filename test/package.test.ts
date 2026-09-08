import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface PackageJson {
  name: string;
  version: string;
  main: string;
  exports: Record<string, string>;
  dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } };
  scripts: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as PackageJson;

describe('package metadata (structural validity)', () => {
  it('is named dsh-skill-manager', () => {
    expect(pkg.name).toBe('dsh-skill-manager');
  });

  it('declares the DSH bundle patch', () => {
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml');
  });

  it('declares a web client platform with the required service injects', () => {
    expect(pkg.dsh.client.platform).toBe('web');
    expect(pkg.dsh.client.inject).toEqual(
      expect.arrayContaining([
        '@deepseek-ai/dsh-client-connection',
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-ui-slots',
      ]),
    );
  });

  it('exposes host, client, and package.json entries', () => {
    expect(pkg.main).toBe('./lib/index.js');
    expect(pkg.exports['.']).toBe('./lib/index.js');
    expect(pkg.exports['./client']).toBe('./lib/client.js');
    expect(pkg.exports['./package.json']).toBe('./package.json');
  });

  it('defines build, check, and test commands', () => {
    expect(pkg.scripts.build).toContain('tsdown');
    expect(pkg.scripts.check).toContain('tsc');
    expect(pkg.scripts.test).toContain('vitest');
  });
});

describe('gitignore hygiene (generated artifacts never committed)', () => {
  const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
  const lines = gitignore.split(/\r?\n/);

  it.each(['node_modules/', '.pnpm-store/', '.proto-dsh-home/'])('ignores %s', (pattern) => {
    expect(lines).toContain(pattern);
  });

  it('keeps the built lib/ committed (the installed package ships prebuilt)', () => {
    expect(lines).not.toContain('lib/');
  });
});
