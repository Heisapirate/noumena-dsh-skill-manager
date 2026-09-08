// Browser half. Registers a top-level settings.section and proves the
// host<->client RPC round trip with a ping() call.
import { createElement, useEffect, useState } from 'react';

export const inject = ['connection', 'slots'];

function Panel({ connection }: any) {
  const [text, setText] = useState('pinging…');

  useEffect(() => {
    let alive = true;
    connection.rpc
      .call('/skill-manager', 'ping', {})
      .then((r: any) => {
        if (!alive) return;
        setText(r.ok ? `ping ok: ${JSON.stringify(r.value)}` : `ping error: ${r.error?.message ?? 'unknown'}`);
      })
      .catch((e: any) => {
        if (alive) setText(`ping failed: ${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [connection]);

  return createElement(
    'div',
    { style: { padding: '16px', fontFamily: 'sans-serif' } },
    'DSH Skill Manager Prototype — ',
    text,
  );
}

export function apply(ctx: any) {
  const connection = ctx.get('connection');
  ctx.slots.inject(
    'settings.section',
    () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'skill-manager',
          order: 15,
          label: () => 'DSH Skill Manager Prototype',
          locale: undefined,
          inject: () => ({ connection }),
        },
        Panel,
      ),
  );
}
