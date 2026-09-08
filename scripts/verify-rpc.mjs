// Server-side verification of the BUILT host bundle (`lib/index.js`) against an
// isolated skills root and a mocked skills.sh fetch. Proves the plugin registers
// the `/skill-manager` channel and answers every endpoint — including an install
// round trip, the managed list, and a safe error state — without touching the
// real user skills or the network. This is the host half of the Issue #18
// browser-verification prep; the browser half runs `dsh web` against the same
// `.dsh-home-18`.

import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const isolatedHome = join(root, '..', '.dsh-home-18');
const skillsRoot = join(isolatedHome, 'skills');

// A GitHub search result + snapshot fixture keyed by slug, so install/update
// round-trip deterministically. The two hashes are opaque and distinct by slug.
function snapshotBody(owner, repo, slug) {
  return {
    files: [
      {
        path: 'SKILL.md',
        contents: `---\nname: ${slug}\ndescription: A controlled test fixture for ${slug}\n---\n# ${slug}\n`,
      },
    ],
    hash: `opaque-remote-hash-${slug}`,
  };
}

function searchBody() {
  return {
    skills: [
      {
        id: 'vercel-labs/skills/find-skills',
        skillId: 'find-skills',
        name: 'find-skills',
        source: 'vercel-labs/skills',
        installs: 170535,
      },
    ],
  };
}

function mockFetch(url) {
  const u = String(url);
  if (u.includes('/api/search')) {
    return Promise.resolve(new Response(JSON.stringify(searchBody()), { status: 200 }));
  }
  const match = /\/api\/download\/([^/]+)\/([^/]+)\/([^/]+)/.exec(u);
  if (match) {
    const [, owner, repo, slug] = match;
    return Promise.resolve(new Response(JSON.stringify(snapshotBody(owner, repo, slug)), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
}

async function main() {
  // Clear ONLY the skills subtree, never the whole DSH_HOME: the same home holds
  // the installed plugin profile (`profiles/web`), which must survive a
  // verification run. The real DSH runtime always creates `$DSH_HOME/skills`;
  // recreate it here so the host's safe-path boundary can resolve the skills root.
  await rm(skillsRoot, { recursive: true, force: true });
  await mkdir(skillsRoot, { recursive: true });
  process.env.DSH_HOME = isolatedHome;
  globalThis.fetch = mockFetch;

  let channel;
  let handler;
  const ctx = {
    get: () => ({
      rpc: {
        handle: (c, h) => {
          channel = c;
          handler = h;
          return () => {};
        },
      },
    }),
    effect: () => {},
  };
  apply(ctx);

  const signal = new AbortController().signal;
  const call = (endpoint, payload) => handler(endpoint, payload, signal);

  const checks = [];
  const record = (label, pass, extra = '') =>
    checks.push({ label, pass, extra });

  record('channel is /skill-manager', channel === '/skill-manager');

  const health = await call('health', {});
  record('health answers ok', health.ok === true && health.value?.plugin === 'dsh-skill-manager');

  const ping = await call('ping', {});
  record('ping answers ok', ping.ok === true);

  const search = await call('search', { query: 'find' });
  record(
    'search returns one GitHub result',
    search.ok === true && search.value?.results?.length === 1 && search.value.results[0].id === 'vercel-labs/skills/find-skills',
  );

  const describe = await call('describe', { id: 'vercel-labs/skills/find-skills' });
  record(
    'describe hydrates the fixture description',
    describe.ok === true && typeof describe.value?.description === 'string',
  );

  const install = await call('install', { id: 'vercel-labs/skills/find-skills' });
  record(
    'install succeeds and records provenance',
    install.ok === true && install.value?.slug === 'find-skills' && install.value?.remoteSourceHash === 'opaque-remote-hash-find-skills',
  );

  const list = await call('list', {});
  record(
    'managed list shows the installed skill',
    list.ok === true && list.value?.skills?.length === 1 && list.value.skills[0].slug === 'find-skills',
  );

  const checkUpdates = await call('checkUpdates', {});
  record(
    'checkUpdates reports the managed skill',
    checkUpdates.ok === true && checkUpdates.value?.updates?.length === 1,
  );

  const update = await call('update', { id: 'vercel-labs/skills/find-skills' });
  record(
    'update answers idempotently (applied: false)',
    update.ok === true && update.value?.applied === false,
  );

  // Uninstall round trip on a second fixture so `find-skills` stays as the seed.
  const secondInstall = await call('install', { id: 'owner/repo/temp-skill' });
  record('second install succeeds', secondInstall.ok === true && secondInstall.value?.slug === 'temp-skill');
  const uninstall = await call('uninstall', { id: 'temp-skill', confirm: true });
  record('uninstall removes the second fixture', uninstall.ok === true);
  const afterUninstall = await call('list', {});
  record(
    'managed list still shows only the seeded skill',
    afterUninstall.ok === true &&
      afterUninstall.value?.skills?.length === 1 &&
      afterUninstall.value.skills[0].slug === 'find-skills',
  );

  const badInstall = await call('install', { id: 'not-a-valid-id' });
  record(
    'invalid install surfaces a typed source-unavailable error',
    badInstall.ok === false && badInstall.error?.code === 'source-unavailable',
  );

  const unknown = await call('definitely-not-an-endpoint', {});
  record(
    'unknown endpoint fails typed',
    unknown.ok === false && unknown.error?.code === 'not-found',
  );

  // Leave find-skills installed as the controlled seed for the browser check.
  let failed = 0;
  for (const { label, pass, extra } of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
    if (!pass) failed += 1;
  }
  if (failed > 0) {
    console.error(`verify-rpc: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log(`verify-rpc: all ${checks.length} checks passed; seeded ${isolatedHome}`);
}

main().catch((err) => {
  console.error('verify-rpc: unexpected failure');
  console.error(err);
  process.exit(1);
});
