import { ENDPOINT_HEALTH, ENDPOINT_PING, ENDPOINT_UNINSTALL } from './contract';
import { SkillManagerService } from './service';
import type { RpcHandler, RpcResult, UninstallRequest } from './types';

/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);

/** Errors that can normalize themselves to the `{code,message,details}` shape. */
interface RpcNormalizable {
  toRpcError(): { code: string; message: string; details: object };
}

function isRpcNormalizable(err: unknown): err is RpcNormalizable {
  return typeof err === 'object' && err !== null && typeof (err as RpcNormalizable).toRpcError === 'function';
}

/**
 * Build the host-side handler for the `/skill-manager` channel. It dispatches a
 * channel-relative endpoint to a service method and normalizes every outcome to
 * the typed `{ok,value}|{ok:false,error}` result — never a raw throw.
 */
export function createRpcHandler(service: SkillManagerService): RpcHandler {
  return async (endpoint: string, payload: unknown, _signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      if (HEALTH_ENDPOINTS.has(endpoint)) {
        return { ok: true, value: service.health() };
      }
      if (endpoint === ENDPOINT_UNINSTALL) {
        return { ok: true, value: await service.uninstall(payload as UninstallRequest) };
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
      if (isRpcNormalizable(err)) {
        return { ok: false, error: err.toRpcError() };
      }
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
