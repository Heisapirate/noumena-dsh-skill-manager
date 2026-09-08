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
		/** Search skills.sh and return normalized basic results (Issue #13). */
		const ENDPOINT_SEARCH = "search";
		/** Lazily hydrate one result's description from its snapshot (Issue #13). */
		const ENDPOINT_DESCRIBE = "describe";
		//#endregion
		//#region src/client/SearchSection.tsx
		const MIN_QUERY_LENGTH = 2;
		const styles$1 = {
			field: {
				display: "flex",
				flexDirection: "column",
				gap: "4px"
			},
			label: {
				fontSize: "12px",
				fontWeight: 500,
				opacity: .85
			},
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "8px 10px",
				fontSize: "14px"
			},
			hint: {
				margin: 0,
				fontSize: "12px",
				opacity: .6
			},
			list: {
				listStyle: "none",
				margin: 0,
				padding: 0,
				display: "flex",
				flexDirection: "column",
				gap: "8px"
			},
			row: {
				border: "1px solid rgba(127, 127, 127, 0.25)",
				borderRadius: "6px",
				padding: "10px 12px",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				gap: "12px"
			},
			rowMain: {
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				minWidth: 0
			},
			name: {
				fontWeight: 600,
				fontSize: "14px",
				overflowWrap: "anywhere"
			},
			meta: {
				fontSize: "12px",
				opacity: .8
			},
			description: {
				fontSize: "13px",
				opacity: .9
			},
			unavailableText: {
				fontSize: "13px",
				opacity: .55,
				fontStyle: "italic"
			},
			badge: {
				display: "inline-block",
				fontSize: "11px",
				fontWeight: 600,
				padding: "1px 6px",
				borderRadius: "999px",
				background: "rgba(255, 170, 0, 0.15)",
				color: "#b06a00",
				whiteSpace: "nowrap"
			},
			message: {
				margin: 0,
				fontSize: "13px"
			},
			errorBox: {
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				alignItems: "flex-start"
			},
			retry: { cursor: "pointer" }
		};
		/** A subtle shimmer skeleton bar for a description slot still loading. */
		const SKELETON_CSS = `
.dsh-sm-skeleton {
  display: inline-block;
  height: 1em;
  min-width: 40%;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.25);
  animation: dsh-sm-shimmer 1.4s ease-in-out infinite;
}
@keyframes dsh-sm-shimmer {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}
`;
		function SearchSection({ state, onQueryChange, onRetry }) {
			const [input, setInput] = (0, react.useState)("");
			const handleChange = (event) => {
				const value = event.target.value;
				setInput(value);
				onQueryChange(value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "search",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SKELETON_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$1.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "skill-manager-search",
								style: styles$1.label,
								children: "Search skills.sh"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "skill-manager-search",
								type: "search",
								style: styles$1.input,
								value: input,
								onChange: handleChange,
								placeholder: "Search skills by keyword (e.g. python)",
								autoComplete: "off",
								spellCheck: false,
								"aria-describedby": "skill-manager-search-hint",
								"aria-label": "Search skills.sh"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								id: "skill-manager-search-hint",
								style: styles$1.hint,
								children: [
									"Enter at least ",
									MIN_QUERY_LENGTH,
									" characters to search."
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"aria-live": "polite",
						"aria-busy": state.status === "loading",
						children: [
							state.status === "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles$1.hint,
								children: "Type a keyword to find skills to install."
							}),
							state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultListSkeleton, { rows: 4 }),
							state.status === "results" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								style: styles$1.list,
								role: "list",
								children: state.results.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultRow, { row }, row.id))
							}),
							state.status === "empty" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles$1.message,
								children: [
									"No skills found for “",
									state.query,
									"”."
								]
							}),
							state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles$1.errorBox,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: styles$1.message,
									children: errorCopy(state.error?.code)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles$1.retry,
									onClick: onRetry,
									children: "Retry"
								})]
							})
						]
					})
				]
			});
		}
		function ResultRow({ row }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: styles$1.row,
				role: "listitem",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles$1.rowMain,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles$1.name,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: row.pageUrl,
								target: "_blank",
								rel: "noopener noreferrer",
								children: row.name
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: styles$1.meta,
							children: [
								row.source,
								" · ",
								formatInstalls(row.installs),
								" installs"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DescriptionSlot, { row })
					]
				}), !row.installable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.badge,
					children: "Unavailable source"
				})]
			});
		}
		function DescriptionSlot({ row }) {
			const { description } = row;
			if (description.status === "loaded") {
				const text = description.text?.trim();
				if (!text) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.description,
					children: "No description provided."
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.description,
					children: text
				});
			}
			if (description.status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: styles$1.unavailableText,
				children: "Description unavailable."
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-sm-skeleton",
				"aria-label": "Loading description",
				role: "status"
			});
		}
		function ResultListSkeleton({ rows }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				style: styles$1.list,
				role: "list",
				"aria-label": "Loading results",
				children: Array.from({ length: rows }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					style: styles$1.row,
					"aria-hidden": true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$1.rowMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-sm-skeleton",
								style: { minWidth: "50%" }
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-sm-skeleton",
								style: { minWidth: "30%" }
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-sm-skeleton",
								style: { minWidth: "60%" }
							})
						]
					})
				}, index))
			});
		}
		function formatInstalls(value) {
			try {
				return value.toLocaleString("en-US");
			} catch {
				return String(value);
			}
		}
		/** Map a normalized search-failure code to short, non-leaking user copy. */
		function errorCopy(code) {
			switch (code) {
				case "network-unavailable": return "Could not reach skills.sh. Check your network connection and retry.";
				case "timeout": return "The search timed out. Please retry.";
				case "rate-limited": return "skills.sh rate-limited this search. Please wait a moment and retry.";
				case "registry-unavailable":
				case "http-error":
				case "malformed-response": return "skills.sh is temporarily unavailable. Please retry.";
				default: return "Something went wrong while searching. Please retry.";
			}
		}
		//#endregion
		//#region src/client/rpc.ts
		/** A normalized failure crossing the RPC boundary. */
		var SkillManagerRpcError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.name = "SkillManagerRpcError";
				this.code = code;
			}
		};
		function createSkillManagerApi(connection) {
			return {
				async search(query, signal) {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_SEARCH, { query }, signal)).results;
				},
				async describe(id, signal) {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_DESCRIBE, { id }, signal)).description;
				}
			};
		}
		function unwrap(result) {
			if (result.ok) return result.value;
			throw new SkillManagerRpcError(result.error.code, result.error.message);
		}
		//#endregion
		//#region src/client/search/cancellation.ts
		function isCancellation(err) {
			return err instanceof Error && (err.name === "AbortError" || err.code === "cancelled");
		}
		//#endregion
		//#region src/client/search/hydrator.ts
		const DEFAULT_CONCURRENCY$1 = 4;
		function createDescriptionHydrator(options) {
			const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY$1;
			const cache = /* @__PURE__ */ new Map();
			let batch = 0;
			let activeController = null;
			let disposed = false;
			function cancel() {
				batch += 1;
				activeController?.abort();
				activeController = null;
			}
			function hydrate(ids) {
				batch += 1;
				const seq = batch;
				activeController?.abort();
				const controller = new AbortController();
				activeController = controller;
				const pending = [];
				for (const id of ids) {
					const cached = cache.get(id);
					if (cached) {
						options.onUpdate(id, cached);
						continue;
					}
					if (!pending.includes(id)) pending.push(id);
				}
				runQueue(pending, seq, controller);
			}
			function runQueue(ids, seq, controller) {
				let next = 0;
				let inFlight = 0;
				async function run(id) {
					try {
						const text = await options.describe(id, controller.signal);
						if (seq !== batch || disposed) return;
						const resolved = {
							status: "loaded",
							text
						};
						cache.set(id, resolved);
						options.onUpdate(id, resolved);
					} catch (err) {
						if (seq !== batch || disposed) return;
						if (isCancellation(err)) return;
						const resolved = {
							status: "unavailable",
							text: null
						};
						cache.set(id, resolved);
						options.onUpdate(id, resolved);
					} finally {
						inFlight -= 1;
						if (seq === batch && !disposed) pump();
					}
				}
				function pump() {
					while (inFlight < concurrency && next < ids.length) {
						const id = ids[next];
						next += 1;
						inFlight += 1;
						run(id);
					}
				}
				pump();
			}
			function dispose() {
				disposed = true;
				cancel();
			}
			return {
				hydrate,
				cancel,
				dispose
			};
		}
		//#endregion
		//#region src/client/search/types.ts
		const idleDescription = {
			status: "idle",
			text: null
		};
		const unavailableDescription = {
			status: "unavailable",
			text: null
		};
		/** The initial idle snapshot shared by the engine and the React hook. */
		const idleSnapshot = {
			status: "idle",
			query: "",
			results: [],
			error: null
		};
		//#endregion
		//#region src/client/search/engine.ts
		const DEFAULT_MIN_QUERY_LENGTH = 2;
		const DEFAULT_DEBOUNCE_MS = 300;
		const DEFAULT_CONCURRENCY = 4;
		function createSearchEngine(options) {
			const minQueryLength = options.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH;
			const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
			const schedule = options.schedule ?? defaultSchedule;
			let snapshot = { ...idleSnapshot };
			const listeners = /* @__PURE__ */ new Set();
			let debounceCancel = null;
			let searchSeq = 0;
			let searchController = null;
			let disposed = false;
			const hydrator = createDescriptionHydrator({
				describe: options.describe,
				concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
				onUpdate: applyDescription
			});
			function setState(next) {
				snapshot = next;
				for (const listener of listeners) listener(snapshot);
			}
			function applyDescription(id, description) {
				if (snapshot.status !== "results" && snapshot.status !== "empty") return;
				if (!snapshot.results.some((row) => row.id === id)) return;
				setState({
					...snapshot,
					results: snapshot.results.map((row) => row.id === id ? {
						...row,
						description
					} : row)
				});
			}
			function abortSearch() {
				searchSeq += 1;
				searchController?.abort();
				searchController = null;
			}
			function setQuery(raw) {
				if (disposed) return;
				cancelDebounce();
				const query = raw.trim();
				abortSearch();
				hydrator.cancel();
				if (query.length < minQueryLength) {
					setState({
						status: "idle",
						query: "",
						results: [],
						error: null
					});
					return;
				}
				debounceCancel = schedule(() => runSearch(query), debounceMs);
			}
			function retry() {
				if (disposed) return;
				cancelDebounce();
				const query = snapshot.query.trim();
				if (query.length < minQueryLength) return;
				runSearch(query);
			}
			async function runSearch(query) {
				abortSearch();
				const seq = ++searchSeq;
				const controller = new AbortController();
				searchController = controller;
				setState({
					status: "loading",
					query,
					results: [],
					error: null
				});
				try {
					const results = await options.search(query, controller.signal);
					if (seq !== searchSeq || disposed) return;
					const rows = results.map((result) => ({
						...result,
						description: result.installable ? idleDescription : unavailableDescription
					}));
					setState({
						status: rows.length > 0 ? "results" : "empty",
						query,
						results: rows,
						error: null
					});
					hydrator.hydrate(rows.filter((row) => row.installable).map((row) => row.id));
				} catch (err) {
					if (seq !== searchSeq || disposed) return;
					if (isCancellation(err)) return;
					setState({
						status: "error",
						query,
						results: [],
						error: toSearchError(err)
					});
				}
			}
			function cancelDebounce() {
				debounceCancel?.();
				debounceCancel = null;
			}
			function dispose() {
				if (disposed) return;
				disposed = true;
				cancelDebounce();
				abortSearch();
				hydrator.dispose();
				listeners.clear();
			}
			return {
				setQuery,
				retry,
				getState: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				dispose
			};
		}
		function defaultSchedule(fn, ms) {
			const handle = setTimeout(fn, ms);
			return () => clearTimeout(handle);
		}
		function toSearchError(err) {
			if (err instanceof Error) {
				const code = err.code;
				return {
					code: typeof code === "string" ? code : "unknown",
					message: err.message
				};
			}
			return {
				code: "unknown",
				message: String(err)
			};
		}
		//#endregion
		//#region src/client/useSkillSearch.ts
		function useSkillSearch(connection) {
			const api = (0, react.useMemo)(() => createSkillManagerApi(connection), [connection]);
			const [engine, setEngine] = (0, react.useState)(null);
			const [state, setState] = (0, react.useState)(idleSnapshot);
			(0, react.useEffect)(() => {
				const nextEngine = createSearchEngine({
					search: (query, signal) => api.search(query, signal),
					describe: (id, signal) => api.describe(id, signal)
				});
				setEngine(nextEngine);
				setState(nextEngine.getState());
				const unsubscribe = nextEngine.subscribe(setState);
				return () => {
					unsubscribe();
					nextEngine.dispose();
				};
			}, [api]);
			return {
				state,
				setQuery: (query) => engine?.setQuery(query),
				retry: () => engine?.retry()
			};
		}
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
			const search = useSkillSearch(connection);
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchSection, {
							state: search.state,
							onQueryChange: search.setQuery,
							onRetry: search.retry
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
