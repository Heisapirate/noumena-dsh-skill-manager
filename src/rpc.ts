import { ENDPOINT_HEALTH, ENDPOINT_INSTALL, ENDPOINT_PING } from './contract';
import { InstallError } from './install';
import { PathSafetyError } from './path-safety';
import { SkillManagerService } from './service';
import { isSkillsShError } from './skills-sh';
import type { InstallRequest, RpcHandler, RpcResult } from './types';

/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);

/** Normalize any thrown value to the RPC `{code,message,details}` error shape. */
function toRpcError(err: unknown): { code: string; message: string; details: object } {
  if (err instanceof InstallError) return err.toRpcError();
  if (isSkillsShError(err)) {
    const object = err.toObject();
    return { code: object.code, message: object.message, details: object.details };
  }
  if (err instanceof PathSafetyError) return err.toRpcError();
  if (err instanceof Error) {
    return { code: 'internal', message: err.message, details: {} };
  }
  return { code: 'internal', message: 'Unknown error', details: {} };
}

/**
 * Build the host-side handler for the `/skill-manager` channel. It dispatches a
 * channel-relative endpoint to a service method and normalizes every outcome to
 * the typed `{ok,value}|{ok,false,error}` result — never a raw throw.
 */
export function createRpcHandler(service: SkillManagerService): RpcHandler {
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      if (HEALTH_ENDPOINTS.has(endpoint)) {
        return { ok: true, value: service.health() };
      }
      if (endpoint === ENDPOINT_INSTALL) {
        const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
        const request: InstallRequest = {
          id: typeof body.id === 'string' ? body.id : '',
          overwrite: body.overwrite === true,
        };
        const value = await service.install(request, signal);
        return { ok: true, value };
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
      return { ok: false, error: toRpcError(err) };
    }
  };
}
