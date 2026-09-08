// Host half (Node, inside the DSH process). Proves the Connection RPC channel.
// rc.1 signature: connection.rpc.handle(channel, handler)
//   handler(endpoint, payload) -> Promise<{ok,value}|{ok:false,error}>
export const inject = ['connection'];

export async function handler(endpoint: string, _payload: unknown) {
  if (endpoint === 'ping') {
    return {
      ok: true,
      value: { ok: true, version: 'prototype', now: Date.now() },
    };
  }
  return {
    ok: false,
    error: {
      code: 'internal',
      message: `unknown skill-manager endpoint "${endpoint}"`,
      details: {},
    },
  };
}

export function apply(ctx: any) {
  console.log('[dsh-skill-manager] host apply: registering /skill-manager RPC');
  const connection = ctx.get('connection') as any;
  const disposer = connection.rpc.handle('/skill-manager', handler);
  ctx.effect(() => disposer, 'dsh-skill-manager: /skill-manager channel');
}
