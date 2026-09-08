//#region src/index.ts
const inject = ["connection"];
async function handler(endpoint, _payload) {
	if (endpoint === "ping") return {
		ok: true,
		value: {
			ok: true,
			version: "prototype",
			now: Date.now()
		}
	};
	return {
		ok: false,
		error: {
			code: "internal",
			message: `unknown skill-manager endpoint "${endpoint}"`,
			details: {}
		}
	};
}
function apply(ctx) {
	console.log("[dsh-skill-manager] host apply: registering /skill-manager RPC");
	const disposer = ctx.get("connection").rpc.handle("/skill-manager", handler);
	ctx.effect(() => disposer, "dsh-skill-manager: /skill-manager channel");
}
//#endregion
export { apply, handler, inject };
