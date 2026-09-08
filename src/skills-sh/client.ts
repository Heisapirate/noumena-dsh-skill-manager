// The production SkillsShClient: an HTTP adapter over the credential-free
// skills.sh compatibility endpoints. It is part of the only module that knows
// endpoint shapes (ADR-0003): this client owns the URLs, while validation.ts
// owns the payload field shapes. It performs strict validation, normalizes
// every failure to a typed SkillsShError, and retries only transient server
// errors with bounded backoff. All timing/fetch behavior is injectable for
// deterministic tests.

import { splitDownloadId } from './domain';
import type { DownloadId } from './domain';
import { cancelledError, parseRetryAfter, SkillsShError } from './errors';
import type { RequestOptions, SearchOptions, SkillSearchResult, SkillSnapshot, SkillsShClient } from './types';
import { validateSearchResponse, validateSnapshotResponse } from './validation';

/** Defaults aligned with the production spec §4/§16. */
const DEFAULT_BASE_URL = 'https://skills.sh';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5_000;
const DEFAULT_MIN_QUERY_LENGTH = 2;

/** Transient upstream statuses worth retrying; 429 and other 4xx/5xx are not. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/** Injectable dependencies and tunables for {@link createSkillsShClient}. */
export interface SkillsShClientOptions {
  /** skills.sh origin; defaults to `https://skills.sh`. */
  baseUrl?: string;
  /** Injected fetch; defaults to the global fetch (deterministic tests inject a mock). */
  fetch?: typeof fetch;
  /** Per-attempt request timeout in ms; defaults to 10s. */
  timeoutMs?: number;
  /** Max retries for transient 502/503/504; defaults to 2 (3 attempts total). */
  maxRetries?: number;
  /** Initial backoff delay in ms; defaults to 500. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms; defaults to 5000. */
  maxDelayMs?: number;
  /** Minimum query length before a network call is attempted; defaults to 2. */
  minQueryLength?: number;
  /** Injected sleep for backoff (abort-aware); defaults to a setTimeout-based sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injected jitter source in [0,1]; defaults to Math.random. */
  random?: () => number;
  /** Injected clock for Retry-After HTTP-date parsing; defaults to Date.now. */
  now?: () => number;
}

/** The production adapter implementation. */
export class SkillsShHttpClient implements SkillsShClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly minQueryLength: number;
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly randomFn: () => number;
  private readonly nowFn: () => number;

  constructor(options: SkillsShClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.minQueryLength = options.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH;
    this.sleepFn = options.sleep ?? defaultSleep;
    this.randomFn = options.random ?? Math.random;
    this.nowFn = options.now ?? Date.now;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SkillSearchResult[]> {
    const q = (query ?? '').trim();
    if (q.length < this.minQueryLength) return [];
    const url = buildSearchUrl(this.baseUrl, q, options);
    const response = await this.request(url, options);
    this.assertSuccess(response, 'search');
    return validateSearchResponse(await this.readJson(response));
  }

  async getSnapshot(id: string, options: RequestOptions = {}): Promise<SkillSnapshot> {
    if (options.signal?.aborted) throw cancelledError();
    const parts = splitDownloadId(id);
    if (!parts) {
      throw new SkillsShError('source-unavailable', `cannot download "${id}": expected owner/repo/slug`);
    }
    const url = buildDownloadUrl(this.baseUrl, parts);
    const response = await this.request(url, options);
    this.assertSuccess(response, 'snapshot');
    return validateSnapshotResponse(id, await this.readJson(response));
  }

  async getDescription(id: string, options: RequestOptions = {}): Promise<string | null> {
    const snapshot = await this.getSnapshot(id, options);
    return snapshot.metadata.description ?? null;
  }

  /**
   * Fetch a URL, retrying transient 502/503/504 with bounded backoff. Returns
   * the final Response; the caller maps non-2xx statuses via {@link assertSuccess}.
   */
  private async request(url: string, options: RequestOptions): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw cancelledError();
      const response = await this.fetchWithTimeout(url, options);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.maxRetries) {
        return response;
      }
      await this.sleepFn(this.backoffDelayMs(attempt), options.signal);
    }
  }

  /** Fetch with a per-attempt timeout that composes with the caller's signal. */
  private async fetchWithTimeout(url: string, options: RequestOptions): Promise<Response> {
    const parent = options.signal;
    if (parent?.aborted) throw cancelledError();
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort();
    parent?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetchFn(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    } catch (err) {
      if (parent?.aborted) throw cancelledError(err);
      if (timedOut) {
        throw new SkillsShError('timeout', `request timed out after ${this.timeoutMs}ms`, { cause: err });
      }
      throw new SkillsShError('network-unavailable', 'network request failed', { cause: err });
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    }
  }

  /** Map a non-2xx response to a typed error. */
  private assertSuccess(response: Response, context: 'search' | 'snapshot'): void {
    if (response.ok) return;
    const status = response.status;
    if (status === 429) {
      throw new SkillsShError('rate-limited', 'skills.sh rate limit exceeded', {
        statusCode: status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), this.nowFn()),
      });
    }
    if (RETRYABLE_STATUSES.has(status)) {
      // Reached here only after the retry bound was exhausted.
      throw new SkillsShError('registry-unavailable', `skills.sh is temporarily unavailable (HTTP ${status})`, {
        statusCode: status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), this.nowFn()),
      });
    }
    if (status === 404 && context === 'snapshot') {
      throw new SkillsShError('source-unavailable', `skill source not found (HTTP ${status})`, { statusCode: status });
    }
    throw new SkillsShError('http-error', `skills.sh request failed (HTTP ${status})`, { statusCode: status });
  }

  /** Read and parse a JSON body, mapping failures to malformed-response. */
  private async readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new SkillsShError('malformed-response', 'could not read response body', { cause: err });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new SkillsShError('malformed-response', 'response was not valid JSON', { cause: err });
    }
  }

  /** Exponential backoff with equal jitter in [capped/2, capped]. */
  private backoffDelayMs(attempt: number): number {
    const capped = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
    return Math.round(capped / 2 + this.randomFn() * (capped / 2));
  }
}

/** Build a {@link SkillsShClient}; the single constructor seam for the adapter. */
export function createSkillsShClient(options?: SkillsShClientOptions): SkillsShClient {
  return new SkillsShHttpClient(options);
}

function buildSearchUrl(baseUrl: string, query: string, options: SearchOptions): string {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.owner) params.set('owner', options.owner);
  return `${baseUrl}/api/search?${params.toString()}`;
}

function buildDownloadUrl(baseUrl: string, parts: DownloadId): string {
  const { owner, repo, slug } = parts;
  return `${baseUrl}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
}

/** Default sleep that rejects with `cancelled` when the signal aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
