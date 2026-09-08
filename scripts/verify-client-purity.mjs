// Build-time purity gate for the client bundle.
//
// The rc.1 client module system seeds a runtime module table
// (`window.__DSH_BOOT__` → `staticModules`) and a bundle may only `require()`
// those seed words. This gate scans the emitted `lib/client.js` and fails the
// build if any `require()` references a non-seed module, so an unsupported
// runtime dependency surfaces here rather than as a browser loader error.

import { readFileSync } from 'node:fs';

const seedModules = JSON.parse(
  readFileSync(new URL('./seed-modules.json', import.meta.url), 'utf8'),
).seedModules;

const seeds = new Set(seedModules);
const clientPath = new URL('../lib/client.js', import.meta.url);

let source;
try {
  source = readFileSync(clientPath, 'utf8');
} catch {
  console.error('verify-client-purity: lib/client.js not found — run `pnpm build` first');
  process.exit(1);
}

const required = new Set();
const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
let match;
while ((match = re.exec(source)) !== null) {
  required.add(match[2]);
}

const unknown = [...required].filter((specifier) => !seeds.has(specifier));
if (unknown.length > 0) {
  console.error(
    `verify-client-purity: client bundle requires non-seed modules: ${unknown.join(', ')}`,
  );
  console.error(`verify-client-purity: seed modules are: ${[...seeds].join(', ')}`);
  process.exit(1);
}

console.log(`verify-client-purity: ok (${required.size} require site(s), all seed modules)`);
