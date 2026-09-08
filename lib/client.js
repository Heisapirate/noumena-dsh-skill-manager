window.__ModuleLoader__.load({
	id: "dsh-skill-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		const inject = ["connection", "slots"];
		function Panel({ connection }) {
			const [text, setText] = (0, react.useState)("pinging…");
			(0, react.useEffect)(() => {
				let alive = true;
				connection.rpc.call("/skill-manager", "ping", {}).then((r) => {
					if (!alive) return;
					setText(r.ok ? `ping ok: ${JSON.stringify(r.value)}` : `ping error: ${r.error?.message ?? "unknown"}`);
				}).catch((e) => {
					if (alive) setText(`ping failed: ${String(e)}`);
				});
				return () => {
					alive = false;
				};
			}, [connection]);
			return (0, react.createElement)("div", { style: {
				padding: "16px",
				fontFamily: "sans-serif"
			} }, "DSH Skill Manager Prototype — ", text);
		}
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skill-manager",
				order: 15,
				label: () => "DSH Skill Manager Prototype",
				locale: void 0,
				inject: () => ({ connection })
			}, Panel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
