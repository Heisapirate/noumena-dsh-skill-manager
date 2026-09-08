//#region src/meta.ts
const PLUGIN_NAME = "dsh-skill-manager";
const PLUGIN_VERSION = "1.0.0";
//#endregion
//#region src/rpc.ts
/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = /* @__PURE__ */ new Set(["health", "ping"]);
/**
* Build the host-side handler for the `/skill-manager` channel. It dispatches a
* channel-relative endpoint to a service method and normalizes every outcome to
* the typed `{ok,value}|{ok,false,error}` result — never a raw throw.
*/
function createRpcHandler(service) {
	return async (endpoint, _payload, _signal) => {
		try {
			if (HEALTH_ENDPOINTS.has(endpoint)) return {
				ok: true,
				value: service.health()
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
* The host half of the skill manager. This is the future security boundary for
* networking, filesystem, manifest, hashing, path validation, and mutations —
* none of which exist yet in the Issue #9 foundation. Those endpoints land in
* later tickets; today the service answers only a typed health/status probe.
*/
var SkillManagerService = class {
	version;
	now;
	constructor(options) {
		this.version = options.version;
		this.now = options.now ?? Date.now;
	}
	/** Typed health/status probe proving the host is alive behind the RPC boundary. */
	health() {
		return {
			ok: true,
			plugin: "dsh-skill-manager",
			version: this.version,
			now: this.now()
		};
	}
};
//#endregion
//#region src/index.ts
/** Declared cordis service dependencies for the host half. */
const inject = ["connection"];
/** Entry point invoked by the DSH host runner at boot. */
function apply(ctx) {
	const service = new SkillManagerService({ version: PLUGIN_VERSION });
	const disposer = ctx.get("connection").rpc.handle("/skill-manager", createRpcHandler(service));
	ctx.effect(() => disposer, `${PLUGIN_NAME}: /skill-manager channel`);
	console.log(`[${PLUGIN_NAME}] registered /skill-manager RPC channel`);
}
//#endregion
export { apply, inject };
