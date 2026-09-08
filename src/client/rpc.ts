// Typed client → host RPC layer. This is the only client code that knows the
// `/skill-manager` endpoint names; the search engine and UI depend on the
// narrow `SkillManagerApi`, never on the connection or on skills.sh details.

import {
  ENDPOINT_DESCRIBE,
  ENDPOINT_INSTALL,
  ENDPOINT_LIST,
  ENDPOINT_SEARCH,
  ENDPOINT_UNINSTALL,
  ENDPOINT_UPDATE,
  RPC_CHANNEL,
} from '../contract';
import type {
  DescribeResponse,
  InstallResult,
  ManagedSkill,
  ManagedSkillsResult,
  RpcResult,
  SearchResponse,
  SkillSearchResult,
  UninstallResult,
  UpdateResult,
} from '../types';
import type { ClientConnection } from './connection';

/** The search + managed-skills + mutation surface the client consumes. */
export interface SkillManagerApi {
  search(query: string, signal?: AbortSignal): Promise<SkillSearchResult[]>;
  describe(id: string, signal?: AbortSignal): Promise<string | null>;
  list(): Promise<ManagedSkill[]>;
  install(id: string, overwrite?: boolean): Promise<InstallResult>;
  update(id: string, discardLocalChanges?: boolean): Promise<UpdateResult>;
  uninstall(id: string, options?: { confirm?: boolean; discardLocalChanges?: boolean }): Promise<UninstallResult>;
}

/** A normalized failure crossing the RPC boundary. */
export class SkillManagerRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SkillManagerRpcError';
    this.code = code;
  }
}

export function createSkillManagerApi(connection: ClientConnection): SkillManagerApi {
  return {
    async search(query, signal) {
      const result = await connection.rpc.call<SearchResponse>(
        RPC_CHANNEL,
        ENDPOINT_SEARCH,
        { query },
        signal,
      );
      return unwrap(result).results;
    },
    async describe(id, signal) {
      const result = await connection.rpc.call<DescribeResponse>(
        RPC_CHANNEL,
        ENDPOINT_DESCRIBE,
        { id },
        signal,
      );
      return unwrap(result).description;
    },
    async list() {
      const result = await connection.rpc.call<ManagedSkillsResult>(
        RPC_CHANNEL,
        ENDPOINT_LIST,
        {},
      );
      return unwrap(result).skills;
    },
    async install(id, overwrite) {
      const result = await connection.rpc.call<InstallResult>(RPC_CHANNEL, ENDPOINT_INSTALL, {
        id,
        ...(overwrite !== undefined ? { overwrite } : {}),
      });
      return unwrap(result);
    },
    async update(id, discardLocalChanges) {
      const result = await connection.rpc.call<UpdateResult>(RPC_CHANNEL, ENDPOINT_UPDATE, {
        id,
        ...(discardLocalChanges !== undefined ? { discardLocalChanges } : {}),
      });
      return unwrap(result);
    },
    async uninstall(id, options) {
      const result = await connection.rpc.call<UninstallResult>(RPC_CHANNEL, ENDPOINT_UNINSTALL, {
        id,
        ...(options?.confirm !== undefined ? { confirm: options.confirm } : {}),
        ...(options?.discardLocalChanges !== undefined
          ? { discardLocalChanges: options.discardLocalChanges }
          : {}),
      });
      return unwrap(result);
    },
  };
}

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new SkillManagerRpcError(result.error.code, result.error.message);
}
