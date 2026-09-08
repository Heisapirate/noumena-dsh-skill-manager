import {
  ENDPOINT_CHECK_UPDATES,
  ENDPOINT_HEALTH,
  ENDPOINT_INSTALL,
  ENDPOINT_PING,
  ENDPOINT_UNINSTALL,
  ENDPOINT_UPDATE,
} from './contract';
import { SkillManagerError } from './errors';
import { toRpcError } from './rpc-error';
import { SkillManagerService } from './service';
import { UpdateError } from './update';
import type { InstallRequest, RpcHandler, RpcResult, UninstallRequest, UpdateInput } from './types';

/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);

/**
 * Build the host-side handler for the `/skill-manager` channel. It dispatches a
 * channel-relative endpoint to a service method and normalizes every outcome to
 * the typed `{ok,value}|{ok:false,error}` result — never a raw throw.
 */
export function createRpcHandler(service: SkillManagerService): RpcHandler {
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      if (HEALTH_ENDPOINTS.has(endpoint)) {
        return { ok: true, value: service.health() };
      }
      if (endpoint === ENDPOINT_INSTALL) {
        const request = coerceInstallRequest(payload);
        return { ok: true, value: await service.install(request, signal) };
      }
      if (endpoint === ENDPOINT_CHECK_UPDATES) {
        return { ok: true, value: await service.checkUpdates() };
      }
      if (endpoint === ENDPOINT_UPDATE) {
        return { ok: true, value: await service.update(parseUpdateInput(payload)) };
      }
      if (endpoint === ENDPOINT_UNINSTALL) {
        return { ok: true, value: await service.uninstall(parseUninstallInput(payload)) };
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

/** Coerce the `install` payload; an absent/invalid id is surfaced by the transaction as typed. */
function coerceInstallRequest(payload: unknown): InstallRequest {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  return {
    id: typeof body.id === 'string' ? body.id : '',
    overwrite: body.overwrite === true,
  };
}

/** Validate the `update` payload shape; throws an `invalid-request` error. */
function parseUpdateInput(payload: unknown): UpdateInput {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new UpdateError('invalid-request', 'update payload must be an object');
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new UpdateError('invalid-request', 'update payload requires a non-empty string "id"');
  }
  const input: UpdateInput = { id: record.id };
  if (record.discardLocalChanges !== undefined) {
    if (typeof record.discardLocalChanges !== 'boolean') {
      throw new UpdateError('invalid-request', '"discardLocalChanges" must be a boolean');
    }
    input.discardLocalChanges = record.discardLocalChanges;
  }
  return input;
}

/** Validate the `uninstall` payload shape; throws an `invalid-request` error. */
function parseUninstallInput(payload: unknown): UninstallRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new SkillManagerError('invalid-request', 'uninstall payload must be an object');
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new SkillManagerError('invalid-request', 'uninstall payload requires a non-empty string "id"');
  }
  const input: UninstallRequest = { id: record.id };
  if (record.confirm !== undefined) {
    if (typeof record.confirm !== 'boolean') {
      throw new SkillManagerError('invalid-request', '"confirm" must be a boolean');
    }
    input.confirm = record.confirm;
  }
  if (record.discardLocalChanges !== undefined) {
    if (typeof record.discardLocalChanges !== 'boolean') {
      throw new SkillManagerError('invalid-request', '"discardLocalChanges" must be a boolean');
    }
    input.discardLocalChanges = record.discardLocalChanges;
  }
  return input;
}
