import { ENDPOINT_DESCRIBE, ENDPOINT_HEALTH, ENDPOINT_PING, ENDPOINT_SEARCH } from './contract';
import { SkillManagerService } from './service';
import { isSkillsShError } from './skills-sh';
import type { RpcHandler, RpcResult } from './types';

/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);

/** A client sent a malformed payload; surfaced as a typed `invalid-request`. */
class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

function readSearchQuery(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidRequestError('search requires a payload object');
  }
  const query = (payload as { query?: unknown }).query;
  if (typeof query !== 'string') {
    throw new InvalidRequestError('search requires a `query` string');
  }
  return query;
}

function readDescribeId(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidRequestError('describe requires a payload object');
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidRequestError('describe requires a non-empty `id` string');
  }
  return id;
}

/**
 * Build the host-side handler for the `/skill-manager` channel. It dispatches a
 * channel-relative endpoint to a service method and normalizes every outcome to
 * the typed `{ok,value}|{ok,false,error}` result — never a raw throw. Typed
 * skills.sh failures keep their normalized `code` so the client can map them to
 * UI states without seeing raw endpoint errors.
 */
export function createRpcHandler(service: SkillManagerService): RpcHandler {
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      if (HEALTH_ENDPOINTS.has(endpoint)) {
        return { ok: true, value: service.health() };
      }
      if (endpoint === ENDPOINT_SEARCH) {
        return { ok: true, value: await service.search(readSearchQuery(payload), signal) };
      }
      if (endpoint === ENDPOINT_DESCRIBE) {
        return { ok: true, value: await service.describe(readDescribeId(payload), signal) };
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
      if (isSkillsShError(err)) {
        const { code, message, details } = err.toObject();
        return { ok: false, error: { code, message, details } };
      }
      if (err instanceof InvalidRequestError) {
        return { ok: false, error: { code: 'invalid-request', message: err.message, details: {} } };
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
