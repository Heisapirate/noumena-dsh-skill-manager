// Host half (Node, inside the DSH process). Registers the `/skill-manager`
// Connection RPC channel and wires the production service behind it.
//
// rc.1 contract: `connection.rpc.handle(channel, handler)` with a handler of
// shape `(endpoint, payload, signal) => Promise<{ok,value}|{ok:false,error}>`.

import { PLUGIN_NAME, PLUGIN_VERSION } from './meta';
import { createRpcHandler } from './rpc';
import { SkillManagerService } from './service';
import type { RpcHandler } from './types';

/** Declared cordis service dependencies for the host half. */
export const inject = ['connection'];

/** Minimal typed view of the cordis host context this plugin consumes. */
export interface HostConnection {
  rpc: {
    handle(channel: string, handler: RpcHandler): () => void | (() => Promise<void>);
  };
}

export interface HostContext {
  get(name: 'connection'): HostConnection;
  effect(disposer: () => void | (() => void) | Promise<void>, label?: string): void;
}

/** Entry point invoked by the DSH host runner at boot. */
export function apply(ctx: HostContext): void {
  const service = new SkillManagerService({ version: PLUGIN_VERSION });
  const connection = ctx.get('connection');
  const disposer = connection.rpc.handle('/skill-manager', createRpcHandler(service));
  ctx.effect(() => disposer, `${PLUGIN_NAME}: /skill-manager channel`);
  console.log(`[${PLUGIN_NAME}] registered /skill-manager RPC channel`);
}
