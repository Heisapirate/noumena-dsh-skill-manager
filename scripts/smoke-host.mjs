// Server-side smoke check against the BUILT host bundle (`lib/index.js`).
// Proves the host face registers the `/skill-manager` channel and answers the
// typed health/ping probe — the same contract the browser exercises over RPC.

import { apply } from '../lib/index.js';

let channel;
let capturedHandler;

const ctx = {
  get: () => ({
    rpc: {
      handle: (c, h) => {
        channel = c;
        capturedHandler = h;
        return () => {};
      },
    },
  }),
  effect: () => {},
};

apply(ctx);

const health = await capturedHandler('health', {}, new AbortController().signal);
const ping = await capturedHandler('ping', {}, new AbortController().signal);
const bad = await capturedHandler('nope', {}, new AbortController().signal);

const checks = [
  ['channel is /skill-manager', channel === '/skill-manager'],
  ['health returns ok', health.ok === true && health.value.plugin === 'dsh-skill-manager'],
  ['ping returns ok', ping.ok === true],
  ['unknown endpoint fails typed', bad.ok === false && bad.error.code === 'not-found'],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failed += 1;
}
if (failed > 0) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log('smoke-host: all checks passed');
