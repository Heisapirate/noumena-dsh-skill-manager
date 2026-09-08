import type { RpcResult } from '../types';

/**
 * Minimal typed view of the `connection` service the DSH client injects into
 * this plugin's client half.
 */
export interface ClientConnection {
  rpc: {
    call<T = unknown>(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<RpcResult<T>>;
  };
}
