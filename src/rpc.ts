import { SkillManagerService } from './service';
import type { RpcHandler, RpcResult } from './types';

/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = new Set(['health', 'ping']);

/**
 * Build the host-side handler for the `/skill-manager` channel. It dispatches a
 * channel-relative endpoint to a service method and normalizes every outcome to
 * the typed `{ok,value}|{ok,false,error}` result — never a raw throw.
 */
export function createRpcHandler(service: SkillManagerService): RpcHandler {
  return async (endpoint: string, _payload: unknown, _signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      if (HEALTH_ENDPOINTS.has(endpoint)) {
        return { ok: true, value: service.health() };
      }
      return {
        ok: false,
        error: {
          code: 'not-found',
          message: `unknown skill-manager endpoint "${endpoint}"`,
          details: {},
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: err instanceof Error ? err.message : 'Unknown error',
          details: {},
        },
      };
    }
  };
}
