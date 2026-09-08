//#region src/contract.ts
const RPC_CHANNEL = "/skill-manager";
const ENDPOINT_HEALTH = "health";
/** Liveness alias of {@link ENDPOINT_HEALTH} (Issue #9 acceptance surface). */
const ENDPOINT_PING = "ping";
//#endregion
//#region src/meta.ts
const PLUGIN_NAME = "dsh-skill-manager";
const PLUGIN_VERSION = "1.0.0";
//#endregion
//#region src/skills-sh/domain.ts
/** The skills.sh base URL used for page links. */
const SKILLS_SH_BASE_URL = "https://skills.sh";
/**
* Classify a skills.sh `source`. GitHub sources are exactly `owner/repo` (two
* non-empty `/`-separated segments with no scheme and no dot in the owner,
* which disambiguates a well-known domain-with-path like `example.com/foo`).
* Anything else is a well-known (domain) source. (ADR-0004)
*/
function classifySource(source) {
	if (typeof source !== "string") return "well-known";
	const value = source.trim();
	if (value === "" || value.includes("://")) return "well-known";
	const segments = value.split("/");
	if (segments.length !== 2) return "well-known";
	const [owner, repo] = segments;
	if (owner === "" || repo === "" || owner.includes(".")) return "well-known";
	return "github";
}
/** The kebab-case slug: the final `/`-separated segment of a skills.sh id. */
function slugFromId(id) {
	const segments = id.split("/");
	return segments[segments.length - 1] ?? id;
}
/** Link to a skill's skills.sh page. */
function toPageUrl(id) {
	return `${SKILLS_SH_BASE_URL}/${id}`;
}
/** Split a download id `owner/repo/slug`; `null` when the shape is wrong. */
function splitDownloadId(id) {
	const segments = id.split("/");
	if (segments.length !== 3) return null;
	const [owner, repo, slug] = segments;
	if (!owner || !repo || !slug) return null;
	return {
		owner,
		repo,
		slug
	};
}
//#endregion
//#region src/skills-sh/errors.ts
/** A single normalized failure. `toObject()` is the RPC-serializable form. */
var SkillsShError = class extends Error {
	code;
	statusCode;
	retryAfterSeconds;
	details;
	constructor(code, message, options = {}) {
		super(message, { cause: options.cause });
		this.name = "SkillsShError";
		this.code = code;
		this.statusCode = options.statusCode;
		this.retryAfterSeconds = options.retryAfterSeconds;
		this.details = options.details ?? {};
	}
	/** Serializable form for the RPC boundary (no Error internals). */
	toObject() {
		const details = { ...this.details };
		if (this.statusCode != null) details.statusCode = this.statusCode;
		if (this.retryAfterSeconds != null) details.retryAfterSeconds = this.retryAfterSeconds;
		return {
			code: this.code,
			message: this.message,
			details
		};
	}
};
/** Type guard narrowing an unknown thrown value to {@link SkillsShError}. */
function isSkillsShError(err) {
	return err instanceof SkillsShError;
}
/** Build a `cancelled` error (e.g. from an AbortSignal). */
function cancelledError(cause) {
	return new SkillsShError("cancelled", "request cancelled", { cause });
}
/**
* Parse a `Retry-After` header into whole seconds. Accepts a delta-seconds
* integer or an HTTP-date; returns `undefined` when absent or unparseable.
* `nowMs` is injectable for deterministic tests.
*/
function parseRetryAfter(value, nowMs = Date.now()) {
	if (value == null) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (/^[+-]?\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isFinite(seconds) && seconds >= 0 ? seconds : void 0;
	}
	const time = Date.parse(trimmed);
	if (!Number.isFinite(time)) return void 0;
	return Math.max(0, Math.ceil((time - nowMs) / 1e3));
}
//#endregion
//#region src/skills-sh/frontmatter.ts
/**
* Extract top-level `name` and `description` scalars from a `SKILL.md`
* frontmatter block (`---\n…\n---`). Never throws; returns `{}` when the
* frontmatter is absent or malformed. Only top-level (unindented) keys are
* read, so nested `metadata:` entries are ignored.
*/
function extractFrontmatterMetadata(skillMd) {
	const lines = skillMd.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return {};
	const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (closeIndex === -1) return {};
	const metadata = {};
	for (let index = 1; index < closeIndex; index++) {
		const match = /^(name|description)\s*:\s*(.*)$/.exec(lines[index]);
		if (!match) continue;
		const [, key, raw] = match;
		const value = unquoteScalar(raw.trim());
		if (key === "name") metadata.name = value;
		else metadata.description = value;
	}
	return metadata;
}
/** Strip YAML double/single quotes and unescape the most common escapes. */
function unquoteScalar(raw) {
	if (raw.length >= 2 && raw[0] === "\"" && raw[raw.length - 1] === "\"") return raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") return raw.slice(1, -1).replace(/''/g, "'");
	return raw;
}
//#endregion
//#region src/skills-sh/validation.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function malformed(message) {
	return new SkillsShError("malformed-response", message);
}
function requireNonEmptyString(value, what) {
	if (typeof value !== "string" || value.trim() === "") throw malformed(`expected ${what} to be a non-empty string`);
	return value;
}
function requireFiniteNumber(value, what) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw malformed(`expected ${what} to be a finite number`);
	return value;
}
/** Validate the `/api/search` compatibility payload into typed results. */
function validateSearchResponse(body) {
	if (!isRecord(body) || !Array.isArray(body.skills)) throw malformed("search response is missing a `skills` array");
	return body.skills.map((entry, index) => {
		const where = `skills[${index}]`;
		if (!isRecord(entry)) throw malformed(`expected ${where} to be an object`);
		const id = requireNonEmptyString(entry.id, `${where}.id`);
		const source = requireNonEmptyString(entry.source, `${where}.source`);
		const name = requireNonEmptyString(entry.name, `${where}.name`);
		const installs = requireFiniteNumber(entry.installs, `${where}.installs`);
		const skillId = entry.skillId != null ? requireNonEmptyString(entry.skillId, `${where}.skillId`) : slugFromId(id);
		const sourceKind = classifySource(source);
		return {
			id,
			skillId,
			name,
			source,
			installs,
			pageUrl: toPageUrl(id),
			installable: sourceKind === "github",
			sourceKind
		};
	});
}
/** Validate the `/api/download` compatibility payload into a typed snapshot. */
function validateSnapshotResponse(id, body) {
	if (!isRecord(body) || !Array.isArray(body.files)) throw malformed("snapshot response is missing a `files` array");
	const files = body.files.map((entry, index) => {
		const where = `files[${index}]`;
		if (!isRecord(entry)) throw malformed(`expected ${where} to be an object`);
		const path = requireNonEmptyString(entry.path, `${where}.path`);
		if (typeof entry.contents !== "string") throw malformed(`expected ${where}.contents to be a string`);
		return {
			path,
			contents: entry.contents
		};
	});
	return {
		id,
		remoteSourceHash: requireNonEmptyString(body.hash, "snapshot `hash`"),
		files,
		metadata: extractMetadata(files)
	};
}
/** Find the `SKILL.md` file and parse its frontmatter (empty when absent). */
function extractMetadata(files) {
	const skillMd = files.find((file) => file.path === "SKILL.md");
	return skillMd ? extractFrontmatterMetadata(skillMd.contents) : {};
}
//#endregion
//#region src/skills-sh/client.ts
/** Defaults aligned with the production spec §4/§16. */
const DEFAULT_BASE_URL = "https://skills.sh";
const DEFAULT_TIMEOUT_MS = 1e4;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5e3;
const DEFAULT_MIN_QUERY_LENGTH = 2;
/** Transient upstream statuses worth retrying; 429 and other 4xx/5xx are not. */
const RETRYABLE_STATUSES = /* @__PURE__ */ new Set([
	502,
	503,
	504
]);
/** The production adapter implementation. */
var SkillsShHttpClient = class {
	baseUrl;
	fetchFn;
	timeoutMs;
	maxRetries;
	baseDelayMs;
	maxDelayMs;
	minQueryLength;
	sleepFn;
	randomFn;
	nowFn;
	constructor(options = {}) {
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
	async search(query, options = {}) {
		const q = (query ?? "").trim();
		if (q.length < this.minQueryLength) return [];
		const url = buildSearchUrl(this.baseUrl, q, options);
		const response = await this.request(url, options);
		this.assertSuccess(response, "search");
		return validateSearchResponse(await this.readJson(response));
	}
	async getSnapshot(id, options = {}) {
		if (options.signal?.aborted) throw cancelledError();
		const parts = splitDownloadId(id);
		if (!parts) throw new SkillsShError("source-unavailable", `cannot download "${id}": expected owner/repo/slug`);
		const url = buildDownloadUrl(this.baseUrl, parts);
		const response = await this.request(url, options);
		this.assertSuccess(response, "snapshot");
		return validateSnapshotResponse(id, await this.readJson(response));
	}
	async getDescription(id, options = {}) {
		return (await this.getSnapshot(id, options)).metadata.description ?? null;
	}
	/**
	* Fetch a URL, retrying transient 502/503/504 with bounded backoff. Returns
	* the final Response; the caller maps non-2xx statuses via {@link assertSuccess}.
	*/
	async request(url, options) {
		for (let attempt = 0;; attempt++) {
			if (options.signal?.aborted) throw cancelledError();
			const response = await this.fetchWithTimeout(url, options);
			if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.maxRetries) return response;
			await this.sleepFn(this.backoffDelayMs(attempt), options.signal);
		}
	}
	/** Fetch with a per-attempt timeout that composes with the caller's signal. */
	async fetchWithTimeout(url, options) {
		const parent = options.signal;
		if (parent?.aborted) throw cancelledError();
		const controller = new AbortController();
		let timedOut = false;
		const onParentAbort = () => controller.abort();
		parent?.addEventListener("abort", onParentAbort, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.timeoutMs);
		try {
			return await this.fetchFn(url, {
				signal: controller.signal,
				headers: { accept: "application/json" }
			});
		} catch (err) {
			if (parent?.aborted) throw cancelledError(err);
			if (timedOut) throw new SkillsShError("timeout", `request timed out after ${this.timeoutMs}ms`, { cause: err });
			throw new SkillsShError("network-unavailable", "network request failed", { cause: err });
		} finally {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParentAbort);
		}
	}
	/** Map a non-2xx response to a typed error. */
	assertSuccess(response, context) {
		if (response.ok) return;
		const status = response.status;
		if (status === 429) throw new SkillsShError("rate-limited", "skills.sh rate limit exceeded", {
			statusCode: status,
			retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"), this.nowFn())
		});
		if (RETRYABLE_STATUSES.has(status)) throw new SkillsShError("registry-unavailable", `skills.sh is temporarily unavailable (HTTP ${status})`, {
			statusCode: status,
			retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"), this.nowFn())
		});
		if (status === 404 && context === "snapshot") throw new SkillsShError("source-unavailable", `skill source not found (HTTP ${status})`, { statusCode: status });
		throw new SkillsShError("http-error", `skills.sh request failed (HTTP ${status})`, { statusCode: status });
	}
	/** Read and parse a JSON body, mapping failures to malformed-response. */
	async readJson(response) {
		let text;
		try {
			text = await response.text();
		} catch (err) {
			throw new SkillsShError("malformed-response", "could not read response body", { cause: err });
		}
		try {
			return JSON.parse(text);
		} catch (err) {
			throw new SkillsShError("malformed-response", "response was not valid JSON", { cause: err });
		}
	}
	/** Exponential backoff with equal jitter in [capped/2, capped]. */
	backoffDelayMs(attempt) {
		const capped = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
		return Math.round(capped / 2 + this.randomFn() * (capped / 2));
	}
};
/** Build a {@link SkillsShClient}; the single constructor seam for the adapter. */
function createSkillsShClient(options) {
	return new SkillsShHttpClient(options);
}
function buildSearchUrl(baseUrl, query, options) {
	const params = new URLSearchParams();
	params.set("q", query);
	if (options.limit != null) params.set("limit", String(options.limit));
	if (options.owner) params.set("owner", options.owner);
	return `${baseUrl}/api/search?${params.toString()}`;
}
function buildDownloadUrl(baseUrl, parts) {
	const { owner, repo, slug } = parts;
	return `${baseUrl}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
}
/** Default sleep that rejects with `cancelled` when the signal aborts. */
function defaultSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(cancelledError());
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(cancelledError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
//#region src/rpc.ts
/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = /* @__PURE__ */ new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);
/** A client sent a malformed payload; surfaced as a typed `invalid-request`. */
var InvalidRequestError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "InvalidRequestError";
	}
};
function readSearchQuery(payload) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new InvalidRequestError("search requires a payload object");
	const query = payload.query;
	if (typeof query !== "string") throw new InvalidRequestError("search requires a `query` string");
	return query;
}
function readDescribeId(payload) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new InvalidRequestError("describe requires a payload object");
	const id = payload.id;
	if (typeof id !== "string" || id.trim() === "") throw new InvalidRequestError("describe requires a non-empty `id` string");
	return id;
}
/**
* Build the host-side handler for the `/skill-manager` channel. It dispatches a
* channel-relative endpoint to a service method and normalizes every outcome to
* the typed `{ok,value}|{ok,false,error}` result — never a raw throw. Typed
* skills.sh failures keep their normalized `code` so the client can map them to
* UI states without seeing raw endpoint errors.
*/
function createRpcHandler(service) {
	return async (endpoint, payload, signal) => {
		try {
			if (HEALTH_ENDPOINTS.has(endpoint)) return {
				ok: true,
				value: service.health()
			};
			if (endpoint === "search") return {
				ok: true,
				value: await service.search(readSearchQuery(payload), signal)
			};
			if (endpoint === "describe") return {
				ok: true,
				value: await service.describe(readDescribeId(payload), signal)
			};
			return {
				ok: false,
				error: {
					code: "not-found",
					message: `unknown skill-manager endpoint "${endpoint}"`,
					details: {}
				}
			};
		} catch (err) {
			if (isSkillsShError(err)) {
				const { code, message, details } = err.toObject();
				return {
					ok: false,
					error: {
						code,
						message,
						details
					}
				};
			}
			if (err instanceof InvalidRequestError) return {
				ok: false,
				error: {
					code: "invalid-request",
					message: err.message,
					details: {}
				}
			};
			return {
				ok: false,
				error: {
					code: "internal",
					message: err instanceof Error ? err.message : "Unknown error",
					details: {}
				}
			};
		}
	};
}
//#endregion
//#region src/service.ts
/**
* The host half of the skill manager — the security boundary that owns all
* skills.sh networking. The browser never talks to skills.sh directly; it
* reaches this service through typed `/skill-manager` RPC endpoints. Issue #13
* adds read-only `search` and `describe`; install/update/uninstall mutations
* land in later tickets and must never be implemented here.
*/
var SkillManagerService = class {
	version;
	now;
	client;
	constructor(options) {
		this.version = options.version;
		this.now = options.now ?? Date.now;
		this.client = options.client ?? createSkillsShClient();
	}
	/** Typed health/status probe proving the host is alive behind the RPC boundary. */
	health() {
		return {
			ok: true,
			plugin: PLUGIN_NAME,
			version: this.version,
			now: this.now()
		};
	}
	/**
	* Search skills.sh for normalized basic results. Never downloads snapshots:
	* descriptions are hydrated separately via {@link describe}. Queries shorter
	* than the adapter minimum resolve to an empty result set without a network
	* call. Errors propagate as typed `SkillsShError`s for the RPC layer to map.
	*/
	async search(query, signal) {
		return {
			results: await this.client.search(query, { signal }),
			complete: true
		};
	}
	/**
	* Lazily hydrate one result's description from its snapshot. Returns `null`
	* when the skill has no description; throws a typed error on failure so a
	* single bad row never fails the surrounding search (the client isolates it).
	*/
	async describe(id, signal) {
		return { description: await this.client.getDescription(id, { signal }) };
	}
};
//#endregion
//#region src/index.ts
/** Declared cordis service dependencies for the host half. */
const inject = ["connection"];
/** Entry point invoked by the DSH host runner at boot. */
function apply(ctx) {
	const service = new SkillManagerService({ version: PLUGIN_VERSION });
	const disposer = ctx.get("connection").rpc.handle(RPC_CHANNEL, createRpcHandler(service));
	ctx.effect(() => disposer, `${PLUGIN_NAME}: ${RPC_CHANNEL} channel`);
	console.log(`[${PLUGIN_NAME}] registered ${RPC_CHANNEL} RPC channel`);
}
//#endregion
export { apply, inject };
