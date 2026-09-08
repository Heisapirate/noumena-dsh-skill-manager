window.__ModuleLoader__.load({
	id: "dsh-skill-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/contract.ts
		const RPC_CHANNEL = "/skill-manager";
		const ENDPOINT_HEALTH = "health";
		//#endregion
		//#region src/client/Panel.tsx
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				gap: "20px",
				maxWidth: "720px"
			},
			section: {
				display: "flex",
				flexDirection: "column",
				gap: "6px"
			},
			heading: {
				fontSize: "13px",
				fontWeight: 600,
				margin: 0,
				textTransform: "uppercase",
				letterSpacing: "0.02em"
			},
			intro: {
				margin: 0,
				opacity: .85
			},
			placeholder: {
				margin: 0,
				opacity: .6
			},
			statusLine: {
				margin: 0,
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			retry: {
				alignSelf: "flex-start",
				cursor: "pointer"
			}
		};
		function SkillManagerPanel({ connection }) {
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [status, setStatus] = (0, react.useState)({
				state: "checking",
				health: null,
				message: null
			});
			(0, react.useEffect)(() => {
				let alive = true;
				setStatus((prev) => ({
					...prev,
					state: "checking",
					message: null
				}));
				connection.rpc.call(RPC_CHANNEL, ENDPOINT_HEALTH, {}).then((result) => {
					if (!alive) return;
					if (result.ok) setStatus({
						state: "connected",
						health: result.value,
						message: null
					});
					else setStatus({
						state: "unavailable",
						health: null,
						message: result.error.message
					});
				}).catch((err) => {
					if (!alive) return;
					setStatus({
						state: "unavailable",
						health: null,
						message: err instanceof Error ? err.message : String(err)
					});
				});
				return () => {
					alive = false;
				};
			}, [connection, attempt]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				role: "region",
				"aria-label": "DSH Skill Manager",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
						style: { margin: "0 0 4px" },
						children: "DSH Skill Manager"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: "Discover, install, update, and manage skills from skills.sh without leaving DSH."
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: styles.section,
						"aria-label": "Skill search",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							style: styles.heading,
							children: "Search"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: styles.placeholder,
							children: "Search skills.sh will appear here in a later update."
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: styles.section,
						"aria-label": "Managed skills",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							style: styles.heading,
							children: "Managed skills"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: styles.placeholder,
							children: "The skills this plugin manages will appear here."
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: styles.section,
						"aria-label": "Host connection",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								style: styles.heading,
								children: "Host connection"
							}),
							status.state === "checking" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.statusLine,
								children: "Checking host connection…"
							}),
							status.state === "connected" && status.health && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.statusLine,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": true,
										children: "✓"
									}),
									" Connected — ",
									status.health.plugin,
									" v",
									status.health.version
								]
							}),
							status.state === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.section,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									style: styles.statusLine,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": true,
											children: "✕"
										}),
										" Host unavailable",
										status.message ? `: ${status.message}` : ""
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.retry,
									onClick: () => setAttempt((a) => a + 1),
									children: "Retry"
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Declared cordis service dependencies for the browser half. */
		const inject = ["connection", "slots"];
		/** Entry point invoked by the DSH client runner. */
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skill-manager",
				order: 15,
				label: () => "DSH Skill Manager",
				inject: () => ({ connection })
			}, SkillManagerPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
