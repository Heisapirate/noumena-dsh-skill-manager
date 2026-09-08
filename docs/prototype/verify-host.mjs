// Plain-node verifier for the host RPC handler + channel registration
// (no vitest worker pool, which cannot spawn in this sandbox).
import { handler, apply } from '../../lib/index.js';

const ping = await handler('ping', {});
const bad = await handler('nope', {});
console.log('ping ->', JSON.stringify(ping));
console.log('nope ->', JSON.stringify(bad));

let channel;
let captured;
const ctx = {
  get: () => ({
    rpc: {
      handle: (c, h) => {
        channel = c;
        captured = h;
        return () => {};
      },
    },
  }),
  effect: () => {},
};
apply(ctx);
console.log('channel ->', channel, '| captured is handler ->', captured === handler);
console.log('ASSERT ping.ok ->', ping.ok === true && ping.value.version === 'prototype');
console.log('ASSERT bad.ok ->', bad.ok === false && bad.error.code === 'internal');
console.log('ASSERT channel ->', channel === '/skill-manager');
