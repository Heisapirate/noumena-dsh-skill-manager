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
		/** List the plugin-managed skills on disk with provenance + status (Issue #15). */
		const ENDPOINT_LIST = "list";
		/** Search skills.sh and return normalized basic results (Issue #13). */
		const ENDPOINT_SEARCH = "search";
		/** Lazily hydrate one result's description from its snapshot (Issue #13). */
		const ENDPOINT_DESCRIBE = "describe";
		/** Installs one GitHub-backed skill (Issue #14 install transaction). */
		const ENDPOINT_INSTALL = "install";
		/** Update transaction endpoint (Issue #16). */
		const ENDPOINT_UPDATE = "update";
		/** Remove a plugin-managed skill (Issue #17; destructive, confirmation-gated). */
		const ENDPOINT_UNINSTALL = "uninstall";
		//#endregion
		//#region src/client/actions/controls.tsx
		const actionStyles = {
			button: { cursor: "pointer" },
			disabledButton: {
				cursor: "default",
				opacity: .6
			},
			confirm: {
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: "6px",
				fontSize: "12px",
				maxWidth: "240px"
			},
			confirmText: {
				margin: 0,
				fontSize: "12px",
				opacity: .85,
				textAlign: "right"
			},
			confirmButtons: {
				display: "flex",
				gap: "6px"
			},
			success: {
				fontSize: "12px",
				color: "#1e7e34",
				fontWeight: 600
			},
			error: {
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: "6px"
			},
			errorText: {
				margin: 0,
				fontSize: "12px",
				color: "#b02a37",
				textAlign: "right"
			}
		};
		/** A disabled, in-progress button for a mutation in flight. */
		function BusyButton({ label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: actionStyles.disabledButton,
				disabled: true,
				"aria-busy": true,
				children: label
			});
		}
		/** The scoped success note shown after a mutation settles. */
		function SuccessLabel({ message }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				role: "status",
				style: actionStyles.success,
				children: ["✓ ", message]
			});
		}
		/** The scoped, non-leaking error note shown after a mutation fails. */
		function ErrorNote({ error }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: actionStyles.errorText,
				children: error.message
			});
		}
		/** An inline destructive-action confirmation (never a modal). */
		function ConfirmPanel({ ariaLabel, message, confirmLabel, onConfirm, onCancel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: actionStyles.confirm,
				role: "group",
				"aria-label": ariaLabel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: actionStyles.confirmText,
					children: message
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: actionStyles.confirmButtons,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: actionStyles.button,
						onClick: onConfirm,
						children: confirmLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: actionStyles.button,
						onClick: onCancel,
						children: "Cancel"
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/managed/view.ts
		/** Map a host `ManagedSkill` to its user-facing view model. */
		function toManagedSkillViewModel(skill) {
			const presentation = statusPresentation(skill.status);
			return {
				slug: skill.slug,
				source: skill.source,
				id: skill.id,
				installedAt: skill.installedAt,
				statusLabel: presentation.label,
				badges: presentation.badges,
				localModified: skill.localModified,
				canUpdate: skill.updateAvailable
			};
		}
		/** The confirmation shown before an update replaces a managed skill's files. */
		function updateConfirmation(vm) {
			return {
				message: vm.localModified ? "Updating will replace this skill and discard your local changes." : "Updating will replace this skill with the latest version.",
				confirmLabel: vm.localModified ? "Update & discard changes" : "Update",
				discardsLocalChanges: vm.localModified
			};
		}
		/** The confirmation shown before an uninstall removes a managed skill. */
		function uninstallConfirmation(vm) {
			return {
				message: vm.localModified ? "Uninstalling will remove this skill and discard your local changes." : "Uninstalling will remove this skill from this machine.",
				confirmLabel: vm.localModified ? "Uninstall & discard changes" : "Uninstall",
				discardsLocalChanges: vm.localModified
			};
		}
		function statusPresentation(status) {
			switch (status) {
				case "up-to-date": return {
					label: "Up to date",
					badges: [{
						label: "Managed",
						tone: "ok"
					}]
				};
				case "update-available": return {
					label: "Update available",
					badges: [{
						label: "Update available",
						tone: "warning"
					}]
				};
				case "locally-modified": return {
					label: "Locally modified",
					badges: [{
						label: "Locally modified",
						tone: "warning"
					}]
				};
				case "update-available-and-locally-modified": return {
					label: "Update available · locally modified",
					badges: [{
						label: "Update available",
						tone: "warning"
					}, {
						label: "Locally modified",
						tone: "warning"
					}]
				};
				case "source-unavailable": return {
					label: "Source unavailable",
					badges: [{
						label: "Source unavailable",
						tone: "danger"
					}]
				};
				case "remote-check-failure": return {
					label: "Status unavailable",
					badges: [{
						label: "Status unavailable",
						tone: "muted"
					}]
				};
				default: return {
					label: "Status unknown",
					badges: [{
						label: "Status unknown",
						tone: "muted"
					}]
				};
			}
		}
		//#endregion
		//#region src/client/Skeleton.tsx
		const SHIMMER_CSS = `
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
		/** Mounts the shimmer keyframes. Safe to mount more than once. */
		function SkeletonStyle() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SHIMMER_CSS });
		}
		/** One shimmer bar; `minWidth` overrides the class default, `label` adds an accessible name. */
		function SkeletonBar({ minWidth, label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-sm-skeleton",
				style: minWidth ? { minWidth } : void 0,
				...label ? {
					"aria-label": label,
					role: "status"
				} : {}
			});
		}
		//#endregion
		//#region src/client/ManagedSkillsSection.tsx
		const styles$2 = {
			headerRow: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "8px"
			},
			refresh: { cursor: "pointer" },
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
			status: { fontSize: "13px" },
			badges: {
				display: "flex",
				flexWrap: "wrap",
				gap: "4px"
			},
			actions: {
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				flexShrink: 0,
				alignItems: "flex-end"
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
			retry: { cursor: "pointer" },
			empty: {
				margin: 0,
				opacity: .75,
				fontSize: "13px"
			}
		};
		const BADGE_BACKGROUND = {
			ok: "rgba(40, 167, 69, 0.15)",
			warning: "rgba(255, 170, 0, 0.15)",
			danger: "rgba(220, 53, 69, 0.15)",
			muted: "rgba(127, 127, 127, 0.15)"
		};
		const BADGE_COLOR = {
			ok: "#1e7e34",
			warning: "#b06a00",
			danger: "#b02a37",
			muted: "#5a5a5a"
		};
		function ManagedSkillsSection({ state, onRefresh, actionState, onUpdate, onUninstall }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonStyle, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles$2.headerRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles$2.status,
						children: "Skills this plugin has installed and manages."
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: styles$2.refresh,
						onClick: onRefresh,
						children: "Refresh"
					})]
				}),
				state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonRows, { rows: 2 }),
				state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles$2.errorBox,
					role: "alert",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: styles$2.message,
						children: ["Could not load managed skills: ", state.error.message]
					}), state.error.action === "retry" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: styles$2.retry,
						onClick: onRefresh,
						children: "Retry"
					})]
				}),
				state.status === "ready" && state.skills.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: styles$2.empty,
					children: "This plugin hasn’t installed any skills yet. Skills you install from skills.sh will appear here."
				}),
				state.status === "ready" && state.skills.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					style: styles$2.list,
					role: "list",
					children: state.skills.map((skill) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagedSkillRow, {
						skill,
						updateAction: actionState("update", skill.id),
						uninstallAction: actionState("uninstall", skill.slug),
						onUpdate,
						onUninstall
					}, skill.slug))
				})
			] });
		}
		function ManagedSkillRow({ skill, updateAction, uninstallAction, onUpdate, onUninstall }) {
			const [confirming, setConfirming] = (0, react.useState)(null);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: styles$2.row,
				role: "listitem",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles$2.rowMain,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles$2.name,
							children: skill.slug
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: styles$2.meta,
							children: [
								skill.source,
								" · installed ",
								formatTimestamp(skill.installedAt)
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles$2.status,
							children: skill.statusLabel
						}),
						skill.badges.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles$2.badges,
							role: "list",
							"aria-label": "Status",
							children: skill.badges.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { badge }, badge.label))
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles$2.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagedAction, {
						kind: "update",
						skill,
						action: updateAction,
						confirming: confirming === "update",
						onStart: () => setConfirming("update"),
						onCancel: () => setConfirming(null),
						onConfirm: () => {
							setConfirming(null);
							onUpdate(skill.id, updateConfirmation(skill).discardsLocalChanges);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagedAction, {
						kind: "uninstall",
						skill,
						action: uninstallAction,
						confirming: confirming === "uninstall",
						onStart: () => setConfirming("uninstall"),
						onCancel: () => setConfirming(null),
						onConfirm: () => {
							setConfirming(null);
							onUninstall(skill.slug, {
								confirm: true,
								discardLocalChanges: uninstallConfirmation(skill).discardsLocalChanges
							});
						}
					})]
				})]
			});
		}
		/** One mutation button (update or uninstall) with its shared state cascade. */
		function ManagedAction({ kind, skill, action, confirming, onStart, onCancel, onConfirm }) {
			const isUpdate = kind === "update";
			const confirmation = isUpdate ? updateConfirmation(skill) : uninstallConfirmation(skill);
			const busyLabel = isUpdate ? "Updating…" : "Uninstalling…";
			const primaryLabel = isUpdate ? "Update" : "Uninstall";
			const ariaLabel = isUpdate ? `Update ${skill.slug}` : `Uninstall ${skill.slug}`;
			const confirmAria = isUpdate ? `Confirm update ${skill.slug}` : `Confirm uninstall ${skill.slug}`;
			const disabled = isUpdate && !skill.canUpdate;
			if (action.status === "pending") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BusyButton, { label: busyLabel });
			if (confirming) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmPanel, {
				ariaLabel: confirmAria,
				message: confirmation.message,
				confirmLabel: confirmation.confirmLabel,
				onConfirm,
				onCancel
			});
			if (action.status === "success") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SuccessLabel, { message: action.message });
			if (action.status === "error" && action.error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: actionStyles.error,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, { error: action.error }), action.error.action === "retry" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: actionStyles.button,
					onClick: onStart,
					"aria-label": `Retry ${ariaLabel}`,
					children: "Retry"
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: disabled ? actionStyles.disabledButton : actionStyles.button,
				disabled,
				onClick: onStart,
				"aria-label": ariaLabel,
				children: primaryLabel
			});
		}
		function StatusBadge({ badge }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				role: "listitem",
				style: {
					display: "inline-block",
					fontSize: "11px",
					fontWeight: 600,
					padding: "1px 6px",
					borderRadius: "999px",
					background: BADGE_BACKGROUND[badge.tone],
					color: BADGE_COLOR[badge.tone],
					whiteSpace: "nowrap"
				},
				children: badge.label
			});
		}
		function SkeletonRows({ rows }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				style: styles$2.list,
				role: "list",
				"aria-label": "Loading managed skills",
				children: Array.from({ length: rows }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					style: styles$2.row,
					"aria-hidden": true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles$2.rowMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "40%" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "60%" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "30%" })
						]
					})
				}, index))
			});
		}
		function formatTimestamp(iso) {
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			try {
				return date.toLocaleString("en-US", {
					year: "numeric",
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit"
				});
			} catch {
				return iso;
			}
		}
		//#endregion
		//#region src/client/copy.ts
		/** The generic fallback; also the only message that suggests retrying blind. */
		const GENERIC = "Something went wrong. Please retry.";
		/**
		* Map a normalized host error code to user copy + action. Unknown and future
		* codes fold to the generic message so the UI never shows raw internals.
		*/
		function presentError(code) {
			switch (code) {
				case "network-unavailable": return {
					message: "Could not reach skills.sh. Check your connection and retry.",
					action: "retry"
				};
				case "timeout": return {
					message: "The request timed out. Please retry.",
					action: "retry"
				};
				case "rate-limited": return {
					message: "skills.sh rate-limited this request. Please wait a moment and retry.",
					action: "retry"
				};
				case "registry-unavailable":
				case "http-error":
				case "malformed-response": return {
					message: "skills.sh is temporarily unavailable. Please retry.",
					action: "retry"
				};
				case "duplicate-install": return {
					message: "This skill is already installed. Confirm to replace it.",
					action: "confirm"
				};
				case "local-modification-conflict": return {
					message: "This skill has local changes. Confirm to replace them.",
					action: "confirm"
				};
				case "confirmation-required": return {
					message: "Confirm this action to continue.",
					action: "confirm"
				};
				case "source-unavailable": return {
					message: "This skill's source can't be installed or updated from here.",
					action: "none"
				};
				case "foreign-target":
				case "foreign-skill": return {
					message: "This skill isn't managed by this plugin, so it was left untouched.",
					action: "none"
				};
				case "skill-not-found": return {
					message: "This skill isn't installed anymore.",
					action: "none"
				};
				case "invalid-request":
				case "invalid-skill-name": return {
					message: "That request couldn't be understood.",
					action: "none"
				};
				case "malformed-snapshot": return {
					message: "The skill's contents couldn't be validated.",
					action: "none"
				};
				case "unsafe-path":
				case "traversal":
				case "absolute-path":
				case "drive-letter-path":
				case "invalid-relative-path":
				case "symlink-escape": return {
					message: "This skill couldn't be written safely.",
					action: "none"
				};
				case "filesystem-permission":
				case "filesystem-error": return {
					message: "The skill manager couldn't write to disk.",
					action: "none"
				};
				case "manifest-corruption": return {
					message: "The skill manager's records are unreadable.",
					action: "none"
				};
				case "not-found": return {
					message: "The host didn't understand this request.",
					action: "none"
				};
				case "cancelled": return {
					message: "The request was cancelled.",
					action: "none"
				};
				case "install-partial-failure":
				case "update-partial-failure":
				case "uninstall-partial-failure": return {
					message: "The operation didn't complete. Nothing was left in a broken state.",
					action: "retry"
				};
				default: return {
					message: GENERIC,
					action: "retry"
				};
			}
		}
		/** Extract the normalized code from a thrown value, defaulting to `unknown`. */
		function errorCodeOf(err) {
			if (err && typeof err === "object" && typeof err.code === "string") return err.code;
			return "unknown";
		}
		/** Map a thrown value (RPC error or otherwise) to user copy + action. */
		function presentThrown(err) {
			return presentError(errorCodeOf(err));
		}
		//#endregion
		//#region src/client/search/view.ts
		/**
		* Decide what install action a row offers:
		* - a non-GitHub (well-known) source is unavailable (ADR-0004);
		* - a skill whose slug is already plugin-managed offers an overwrite (duplicate);
		* - everything else offers a plain install.
		*/
		function searchRowAction(row, managedSlugs) {
			if (!row.installable) return { kind: "unavailable" };
			if (managedSlugs.has(row.skillId)) return { kind: "overwrite" };
			return { kind: "install" };
		}
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
			installedBadge: {
				display: "inline-block",
				fontSize: "11px",
				fontWeight: 600,
				padding: "1px 6px",
				borderRadius: "999px",
				background: "rgba(40, 167, 69, 0.15)",
				color: "#1e7e34",
				whiteSpace: "nowrap"
			},
			actions: {
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: "6px",
				flexShrink: 0
			},
			actionRow: {
				display: "flex",
				alignItems: "center",
				gap: "6px"
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
		function SearchSection({ state, onQueryChange, onRetry, managedSlugs, actionState, onInstall }) {
			const [input, setInput] = (0, react.useState)("");
			const handleChange = (event) => {
				const value = event.target.value;
				setInput(value);
				onQueryChange(value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "search",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonStyle, {}),
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
								children: state.results.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultRow, {
									row,
									managedSlugs,
									action: actionState("install", row.id),
									onInstall
								}, row.id))
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
									children: presentError(state.error?.code).message
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
		function ResultRow({ row, managedSlugs, action, onInstall }) {
			const [confirming, setConfirming] = (0, react.useState)(false);
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
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallAction, {
					row,
					managedSlugs,
					action,
					confirming,
					onStartConfirm: () => setConfirming(true),
					onCancelConfirm: () => setConfirming(false),
					onConfirmOverwrite: () => {
						setConfirming(false);
						onInstall(row.id, true);
					},
					onInstall: () => onInstall(row.id, false)
				})]
			});
		}
		function InstallAction({ row, managedSlugs, action, confirming, onStartConfirm, onCancelConfirm, onConfirmOverwrite, onInstall }) {
			const decision = searchRowAction(row, managedSlugs);
			if (decision.kind === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: styles$1.badge,
				children: "Unavailable source"
			});
			if (action.status === "pending") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BusyButton, { label: "Installing…" });
			if (action.status === "success") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SuccessLabel, { message: action.message });
			if (action.status === "error" && action.error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallError, {
				error: action.error,
				onReplace: onStartConfirm,
				onRetryInstall: onInstall
			});
			if (confirming) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmPanel, {
				ariaLabel: `Confirm replace ${row.name}`,
				message: "Reinstalling replaces the installed version of this skill.",
				confirmLabel: "Replace",
				onConfirm: onConfirmOverwrite,
				onCancel: onCancelConfirm
			});
			if (decision.kind === "overwrite") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles$1.actionRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles$1.installedBadge,
					children: "Installed"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: actionStyles.button,
					onClick: onStartConfirm,
					"aria-label": `Replace ${row.name}`,
					children: "Replace"
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: actionStyles.button,
				onClick: onInstall,
				"aria-label": `Install ${row.name}`,
				children: "Install"
			});
		}
		/**
		* The scoped install-error rendering. `confirm` re-opens the overwrite
		* confirmation (defensive duplicate from a stale managed list); `retry` safely
		* re-runs the plain install; `none` renders copy only — a refusal is never
		* presented as retryable (spec §12 "retry / confirm / nothing").
		*/
		function InstallError({ error, onReplace, onRetryInstall }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: actionStyles.error,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, { error }),
					error.action === "confirm" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: actionStyles.button,
						onClick: onReplace,
						children: "Replace"
					}),
					error.action === "retry" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: actionStyles.button,
						onClick: onRetryInstall,
						children: "Retry"
					})
				]
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { label: "Loading description" });
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "50%" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "30%" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkeletonBar, { minWidth: "60%" })
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
				},
				async list() {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_LIST, {})).skills;
				},
				async install(id, overwrite) {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_INSTALL, {
						id,
						...overwrite !== void 0 ? { overwrite } : {}
					}));
				},
				async update(id, discardLocalChanges) {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_UPDATE, {
						id,
						...discardLocalChanges !== void 0 ? { discardLocalChanges } : {}
					}));
				},
				async uninstall(slug, options) {
					return unwrap(await connection.rpc.call(RPC_CHANNEL, ENDPOINT_UNINSTALL, {
						id: slug,
						...options?.confirm !== void 0 ? { confirm: options.confirm } : {},
						...options?.discardLocalChanges !== void 0 ? { discardLocalChanges: options.discardLocalChanges } : {}
					}));
				}
			};
		}
		function unwrap(result) {
			if (result.ok) return result.value;
			throw new SkillManagerRpcError(result.error.code, result.error.message);
		}
		//#endregion
		//#region src/client/useManagedSkills.ts
		function useManagedSkills(connection) {
			const api = (0, react.useMemo)(() => createSkillManagerApi(connection), [connection]);
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [state, setState] = (0, react.useState)({
				status: "loading",
				skills: [],
				error: null
			});
			(0, react.useEffect)(() => {
				let alive = true;
				setState((prev) => ({
					status: "loading",
					skills: prev.skills,
					error: null
				}));
				api.list().then((skills) => {
					if (!alive) return;
					setState({
						status: "ready",
						skills: skills.map(toManagedSkillViewModel),
						error: null
					});
				}).catch((err) => {
					if (!alive) return;
					setState({
						status: "error",
						skills: [],
						error: presentThrown(err)
					});
				});
				return () => {
					alive = false;
				};
			}, [api, attempt]);
			return {
				state,
				refresh: () => setAttempt((a) => a + 1)
			};
		}
		//#endregion
		//#region src/client/actions/types.ts
		/** The initial state for any action that has never run. */
		const idleActionState = {
			status: "idle",
			message: null,
			error: null
		};
		//#endregion
		//#region src/client/actions/store.ts
		const SUCCESS_MESSAGE = {
			install: "Installed",
			update: "Updated",
			uninstall: "Uninstalled"
		};
		function keyFor(kind, target) {
			return `${kind}:${target}`;
		}
		function createActionStore(options) {
			let states = /* @__PURE__ */ new Map();
			const listeners = /* @__PURE__ */ new Set();
			let disposed = false;
			function set(key, state) {
				const next = new Map(states);
				next.set(key, state);
				states = next;
				for (const listener of listeners) listener();
			}
			function run(kind, target, invoke) {
				if (disposed) return;
				const key = keyFor(kind, target);
				if ((states.get(key) ?? idleActionState).status === "pending") return;
				set(key, {
					status: "pending",
					message: null,
					error: null
				});
				invoke().then(() => {
					if (disposed) return;
					set(key, {
						status: "success",
						message: SUCCESS_MESSAGE[kind],
						error: null
					});
					options.onSuccess?.(kind);
				}, (err) => {
					if (disposed) return;
					set(key, {
						status: "error",
						message: null,
						error: presentThrown(err)
					});
				});
			}
			return {
				runInstall(id, overwrite = false) {
					run("install", id, () => options.install(id, overwrite));
				},
				runUpdate(id, discardLocalChanges = false) {
					run("update", id, () => options.update(id, discardLocalChanges));
				},
				runUninstall(slug, optionsArg) {
					run("uninstall", slug, () => options.uninstall(slug, {
						confirm: optionsArg?.confirm ?? false,
						discardLocalChanges: optionsArg?.discardLocalChanges ?? false
					}));
				},
				stateFor(kind, target) {
					return states.get(keyFor(kind, target)) ?? idleActionState;
				},
				getSnapshot: () => states,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				dispose() {
					disposed = true;
					listeners.clear();
				}
			};
		}
		//#endregion
		//#region src/client/useSkillActions.ts
		function useSkillActions(connection, onSuccess) {
			const onSuccessRef = (0, react.useRef)(onSuccess);
			onSuccessRef.current = onSuccess;
			const store = (0, react.useMemo)(() => {
				const api = createSkillManagerApi(connection);
				return createActionStore({
					install: (id, overwrite) => api.install(id, overwrite),
					update: (id, discardLocalChanges) => api.update(id, discardLocalChanges),
					uninstall: (id, options) => api.uninstall(id, options),
					onSuccess: () => onSuccessRef.current?.()
				});
			}, [connection]);
			(0, react.useEffect)(() => () => store.dispose(), [store]);
			(0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
			return {
				install: (id, overwrite) => store.runInstall(id, overwrite),
				update: (id, discardLocalChanges) => store.runUpdate(id, discardLocalChanges),
				uninstall: (slug, options) => store.runUninstall(slug, options),
				stateFor: (kind, target) => store.stateFor(kind, target)
			};
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
			const managed = useManagedSkills(connection);
			const actions = useSkillActions(connection, () => managed.refresh());
			const managedSlugs = (0, react.useMemo)(() => new Set(managed.state.skills.map((skill) => skill.slug)), [managed.state.skills]);
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
						message: presentError(result.error.code).message
					});
				}).catch((err) => {
					if (!alive) return;
					setStatus({
						state: "unavailable",
						health: null,
						message: presentThrown(err).message
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
							onRetry: search.retry,
							managedSlugs,
							actionState: actions.stateFor,
							onInstall: actions.install
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: styles.section,
						"aria-label": "Managed skills",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							style: styles.heading,
							children: "Managed skills"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagedSkillsSection, {
							state: managed.state,
							onRefresh: managed.refresh,
							actionState: actions.stateFor,
							onUpdate: actions.update,
							onUninstall: actions.uninstall
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
