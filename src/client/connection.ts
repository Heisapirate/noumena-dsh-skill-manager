import type { RpcResult } from '../types';

/**
 * Minimal typed view of the `connection` service the DSH client injects into
 * this plugin's browser half.
 */
export interface ClientConnection {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<RpcResult<unknown>>;
  };
}
