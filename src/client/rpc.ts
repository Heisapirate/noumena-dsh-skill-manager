// Typed client → host RPC layer. This is the only client code that knows the
// `/skill-manager` endpoint names; the search engine and UI depend on the
// narrow `SkillManagerApi`, never on the connection or on skills.sh details.

import { ENDPOINT_DESCRIBE, ENDPOINT_LIST, ENDPOINT_SEARCH, RPC_CHANNEL } from '../contract';
import type {
  DescribeResponse,
  ManagedSkill,
  ManagedSkillsResult,
  RpcResult,
  SearchResponse,
  SkillSearchResult,
} from '../types';
import type { ClientConnection } from './connection';

/** The search + managed-skills surface the client orchestration and UI consume. */
export interface SkillManagerApi {
  search(query: string, signal?: AbortSignal): Promise<SkillSearchResult[]>;
  describe(id: string, signal?: AbortSignal): Promise<string | null>;
  list(): Promise<ManagedSkill[]>;
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
  };
}

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new SkillManagerRpcError(result.error.code, result.error.message);
}
