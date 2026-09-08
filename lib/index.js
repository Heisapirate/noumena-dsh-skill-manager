import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
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
//#region src/rpc.ts
/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = /* @__PURE__ */ new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);
function isRpcNormalizable(err) {
	return typeof err === "object" && err !== null && typeof err.toRpcError === "function";
}
/**
* Build the host-side handler for the `/skill-manager` channel. It dispatches a
* channel-relative endpoint to a service method and normalizes every outcome to
* the typed `{ok,value}|{ok:false,error}` result — never a raw throw.
*/
function createRpcHandler(service) {
	return async (endpoint, payload, _signal) => {
		try {
			if (HEALTH_ENDPOINTS.has(endpoint)) return {
				ok: true,
				value: service.health()
			};
			if (endpoint === "uninstall") return {
				ok: true,
				value: await service.uninstall(payload)
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
			if (isRpcNormalizable(err)) return {
				ok: false,
				error: err.toRpcError()
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
//#region src/errors.ts
var SkillManagerError = class extends Error {
	code;
	details;
	constructor(code, message, details = {}) {
		super(message);
		this.name = "SkillManagerError";
		this.code = code;
		this.details = details;
	}
	/** Normalize to the RPC error shape; later layers map `code` to user-facing copy. */
	toRpcError() {
		return {
			code: this.code,
			message: this.message,
			details: this.details
		};
	}
};
/**
* Map a raw Node filesystem error to a typed `SkillManagerError`, so filesystem
* failures outside the safe-path boundary (manifest reads, hash recomputation)
* surface as `filesystem-permission` / `filesystem-error` rather than a raw
* internal error.
*/
function toFilesystemError(err, path) {
	const code = err?.code;
	if (code === "EACCES" || code === "EPERM" || code === "EROFS") return new SkillManagerError("filesystem-permission", `permission denied on ${path}`, { path });
	return new SkillManagerError("filesystem-error", `filesystem error on ${path}: ${err instanceof Error ? err.message : String(err)}`, { path });
}
//#endregion
//#region src/manifest/hash.ts
/**
* Compare two relative paths by their UTF-8 byte order. The spec requires files
* to be sorted "by relative path (byte order)"; JavaScript's default string
* sort is UTF-16 code-unit order, which differs from byte order for non-BMP
* characters, so the comparison is explicit rather than relying on `.sort()`.
*/
function compareByteOrder(a, b) {
	const ab = Buffer.from(a, "utf8");
	const bb = Buffer.from(b, "utf8");
	return Buffer.compare(ab, bb);
}
/**
* The plugin's deterministic local-content hash: SHA-256 over files sorted by
* relative path (byte order), the digest updated with each file's path followed
* by its contents. Used only to detect local modification/drift. It is never
* compared to `remoteSourceHash`, which is an opaque upstream fingerprint.
*/
function localContentHash(files) {
	const sorted = [...files].sort((a, b) => compareByteOrder(a.path, b.path));
	const digest = createHash("sha256");
	for (const file of sorted) {
		digest.update(file.path, "utf8");
		digest.update(file.contents, "utf8");
	}
	return digest.digest("hex");
}
//#endregion
//#region src/manifest/read.ts
/** Prefix for synthetic entries that can never collide with a real snapshot path. */
const NON_REGULAR_MARKER = "\0";
/** Read a skill directory into the same `{path, contents}` list a snapshot would have. */
async function readSkillFiles(skillDir) {
	const files = [];
	await walk(skillDir, "");
	files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return files;
	async function walk(dir, prefix) {
		const names = await readdir(dir).catch((err) => {
			throw toFilesystemError(err, dir);
		});
		for (const name of names) {
			const rel = prefix === "" ? name : `${prefix}/${name}`;
			const abs = join(dir, name);
			const st = await lstat(abs).catch((err) => {
				throw toFilesystemError(err, abs);
			});
			if (st.isDirectory()) await walk(abs, rel);
			else if (st.isFile()) {
				const contents = await readFile(abs, "utf8").catch((err) => {
					throw toFilesystemError(err, abs);
				});
				files.push({
					path: rel,
					contents
				});
			} else if (st.isSymbolicLink()) {
				const target = await readlink(abs).catch((err) => {
					throw toFilesystemError(err, abs);
				});
				files.push({
					path: `${rel}${NON_REGULAR_MARKER}symlink`,
					contents: target
				});
			} else files.push({
				path: `${rel}${NON_REGULAR_MARKER}special`,
				contents: ""
			});
		}
	}
}
/** Recompute the local-content hash from the files on disk under a skill directory. */
async function computeLocalContentHash(skillDir) {
	return localContentHash(await readSkillFiles(skillDir));
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-atomic-wri_53052c6388f62b3ecf960de813f6672d/node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js
/**
* Zero-dependency atomic file replacement and writer coordination.
* `writeFileAtomic` writes a random-suffix sibling with exclusive create and
* the caller's permission bits, then renames it over the target, so readers
* observe either the old or the new complete content and a replaced file ends
* up with exactly the stated mode. `withFileLock` serializes cross-process
* writers of one file through a `wx`-created `<file>.lock` sibling, so a
* read-modify-write cycle can never resurrect a state another writer just
* replaced; readers stay lock-free because the rename commit is atomic.
* @module @deepseek-ai/dsh-atomic-write
*/
const WINDOWS_TRANSIENT_RENAME_ERRORS = /* @__PURE__ */ new Set([
	"EACCES",
	"EBUSY",
	"EPERM"
]);
const WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
const WINDOWS_RENAME_RETRY_MAX_MS = 200;
const WINDOWS_RENAME_RETRY_LIMIT = 8;
/** Whether Windows reported temporary interference with an atomic replacement. */
function isTransientWindowsRenameError(error) {
	if (process.platform !== "win32") return false;
	return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
/** Replace the target after bounded retries for transient Windows interference. */
async function renameAtomicTemp(temp, filename) {
	let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
	for (let retries = 0;; retries += 1) {
		try {
			await rename(temp, filename);
			return;
		} catch (error) {
			if (!isTransientWindowsRenameError(error)) throw error;
			if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
	}
}
/**
* Replace `filename` with `content` in one atomic step, creating parent
* directories. The content is first written to a random-suffix sibling opened
* with exclusive create (`wx`): the open refuses to follow a symlink planted
* at the temp path, and the fresh inode carries `options.mode` through the
* rename, so replacing a wider-permission file narrows it without a chmod
* race. The rename also replaces a symlinked target itself instead of writing
* through to its referent, and the same-directory sibling keeps the rename on
* one filesystem. Windows replacement retries transient `EACCES`, `EBUSY`,
* and `EPERM` failures for a bounded interval while the complete temp file
* remains the rename source. On any remaining failure the temp file is
* removed and the failure rethrown. Crash durability (fsync) is out of scope.
* @param filename - final path receiving the content.
* @param content - complete next file content.
* @param options - permission bits for the replacement inode.
*/
async function writeFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await renameAtomicTemp(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
/** Whether an exclusive create found an existing lock. */
async function isLockContention(error, lockPath) {
	const code = error?.code;
	if (code === "EEXIST") return true;
	if (code !== "EPERM") return false;
	try {
		await lstat(lockPath);
		return true;
	} catch {
		return false;
	}
}
/**
* Retry cadence for a contended lock. These stay robustness invariants of the
* cross-process write protocol rather than deployment tunables: they govern how
* often a contender asks, which no caller has a reason to vary.
*/
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
/**
* How long a contender waits when the caller states no limit — sized for the
* render-and-rename cycle every call site had when this package was written.
* Expiry fails the contender rather than guessing whether the existing lock
* still has an owner. How long is *worth* waiting is a property of the
* operation the lock holder runs, which is why {@link FileLockOptions.waitMs}
* exists; the value here is the floor for an operation that does file work
* alone.
*/
const DEFAULT_LOCK_WAIT_MS = 2e3;
/**
* Hold the cross-process writer lock for `filename` around one operation. The
* lock is a `wx`-created sibling (`<filename>.lock`); paired with the
* rename-based commit of {@link writeFileAtomic}, readers stay lock-free and
* only writers contend. `EEXIST` is contention directly; an `EPERM` is
* contention only when a fresh `lstat` confirms the lock path exists, covering
* Windows exclusive-create behavior without hiding an unrelated permission
* failure. Contention backs off exponentially and fails with a timed-out error
* after the deadline. The contender never removes an existing lock because
* file age cannot prove that its owner stopped; orphan recovery is an operator
* action. The parent directory must exist.
* @param filename - the file whose writers this lock serializes.
* @param operation - the read-render-commit cycle to run while holding the lock.
* @param options - acquisition options; omitted waits {@link DEFAULT_LOCK_WAIT_MS}.
* @returns the operation's result; the lock releases on both outcomes.
*/
async function withFileLock(filename, operation, options) {
	const lockPath = `${filename}.lock`;
	const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS);
	let delay = LOCK_RETRY_INITIAL_MS;
	for (;;) {
		try {
			await writeFile(lockPath, `${process.pid}\n`, {
				mode: 384,
				flag: "wx"
			});
			break;
		} catch (error) {
			if (!await isLockContention(error, lockPath)) throw error;
		}
		if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
	}
	try {
		return await operation();
	} finally {
		await rm(lockPath, { force: true });
	}
}
/** Reserved metadata directory under the skills root (skipped by DSH discovery). */
const SYSTEM_DIRECTORY_NAME = ".system";
/** Directory holding the plugin's own metadata under `.system`. */
const MANIFEST_DIRECTORY_NAME = "skill-manager";
const MANIFEST_FILE_NAME = "manifest.json";
/** Absolute path of the manifest file for a given skills root (`$DSH_HOME/skills`). */
function manifestPath(skillsRoot) {
	return join(skillsRoot, SYSTEM_DIRECTORY_NAME, MANIFEST_DIRECTORY_NAME, MANIFEST_FILE_NAME);
}
/** A fresh, empty manifest at the current schema version. */
function emptyManifest() {
	return {
		version: 1,
		skills: {}
	};
}
//#endregion
//#region src/manifest/store.ts
function corrupt(reason, detail) {
	return {
		reason,
		detail
	};
}
/**
* Reconcile a parsed manifest against the skill directories present on disk.
* A manifest entry whose directory is missing is dropped as already-uninstalled;
* a directory with no manifest entry is foreign and is left alone. The caller
* supplies `onDiskSlugs` already excluding the reserved `.system` directory.
*/
function reconcile(manifest, onDiskSlugs) {
	const onDisk = new Set(onDiskSlugs);
	const surviving = Object.entries(manifest.skills).filter(([slug]) => onDisk.has(slug)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
	const dropped = Object.keys(manifest.skills).filter((slug) => !onDisk.has(slug)).sort();
	const foreign = [...onDisk].filter((slug) => !Object.hasOwn(manifest.skills, slug)).sort();
	return {
		manifest: {
			version: manifest.version,
			skills: Object.fromEntries(surviving)
		},
		dropped,
		foreign
	};
}
/** Directories directly under the skills root, excluding the reserved `.system`. */
async function listSkillDirectories(skillsRoot) {
	let entries;
	try {
		entries = await readdir(skillsRoot, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return [];
		throw err;
	}
	return entries.filter((entry) => entry.isDirectory() && entry.name !== ".system").map((entry) => entry.name).sort();
}
function parseEntry(slug, value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const e = value;
	if (typeof e.source !== "string" || typeof e.slug !== "string" || typeof e.remoteSourceHash !== "string" || typeof e.localContentHash !== "string" || typeof e.installedAt !== "string" || typeof e.updatedAt !== "string") return null;
	if (e.slug !== slug) return null;
	return {
		source: e.source,
		slug: e.slug,
		remoteSourceHash: e.remoteSourceHash,
		localContentHash: e.localContentHash,
		installedAt: e.installedAt,
		updatedAt: e.updatedAt
	};
}
function parseManifest(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return {
			status: "corrupt",
			corruption: corrupt("malformed-json", err instanceof Error ? err.message : "unparseable JSON")
		};
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {
		status: "corrupt",
		corruption: corrupt("invalid-structure", "manifest root must be an object")
	};
	const obj = raw;
	if (obj.version !== 1) return {
		status: "corrupt",
		corruption: corrupt("unsupported-version", `unsupported manifest version: ${String(obj.version)}`)
	};
	const skills = obj.skills;
	if (typeof skills !== "object" || skills === null || Array.isArray(skills)) return {
		status: "corrupt",
		corruption: corrupt("invalid-structure", "manifest \"skills\" must be an object keyed by slug")
	};
	const parsed = {};
	for (const [slug, value] of Object.entries(skills)) {
		const entry = parseEntry(slug, value);
		if (entry === null) return {
			status: "corrupt",
			corruption: corrupt("invalid-structure", `invalid manifest entry for slug "${slug}"`)
		};
		parsed[slug] = entry;
	}
	return {
		status: "ok",
		manifest: {
			version: 1,
			skills: parsed
		}
	};
}
/** Serialize a manifest to a canonical, deterministic JSON document. */
function serializeManifest(manifest) {
	const skills = {};
	for (const slug of Object.keys(manifest.skills).sort()) {
		const entry = manifest.skills[slug];
		skills[slug] = {
			source: entry.source,
			slug: entry.slug,
			remoteSourceHash: entry.remoteSourceHash,
			localContentHash: entry.localContentHash,
			installedAt: entry.installedAt,
			updatedAt: entry.updatedAt
		};
	}
	return `${JSON.stringify({
		version: manifest.version,
		skills
	}, null, 2)}\n`;
}
/**
* Load, parse, and reconcile the plugin-owned manifest under a skills root
* (`$DSH_HOME/skills`). A missing manifest yields an empty one; a corrupt or
* unsupported manifest yields an empty one plus a corruption signal — never a
* throw. Manifest/filesystem drift is reconciled here: missing local dirs drop
* their entries, and on-disk dirs without an entry are reported as foreign.
*/
var ManifestStore = class {
	skillsRoot;
	/** Absolute path of the manifest file this store reads and writes. */
	path;
	constructor(skillsRoot) {
		this.skillsRoot = skillsRoot;
		this.path = manifestPath(skillsRoot);
	}
	async load() {
		const onDisk = await listSkillDirectories(this.skillsRoot);
		let text;
		try {
			text = await readFile(this.path, "utf8");
		} catch (err) {
			if (err.code === "ENOENT") return {
				status: "missing",
				...reconcile(emptyManifest(), onDisk)
			};
			throw err;
		}
		const parsed = parseManifest(text);
		if (parsed.status === "corrupt") return {
			status: "corrupt",
			...reconcile(emptyManifest(), onDisk),
			corruption: parsed.corruption
		};
		return {
			status: "ok",
			...reconcile(parsed.manifest, onDisk)
		};
	}
	/**
	* Atomically persist the manifest: serialize to a sibling temp file and rename
	* it over the target, serialized across processes with a writer lock. The
	* caller supplies a complete, well-formed manifest (the store does not perform
	* read-modify-write; the transactions in later tickets compose load + save).
	*/
	async save(manifest) {
		for (const [key, entry] of Object.entries(manifest.skills)) if (entry.slug !== key) throw new Error(`refusing to persist manifest: entry slug "${entry.slug}" does not match its key "${key}"`);
		const json = serializeManifest(manifest);
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: 448
		});
		await withFileLock(this.path, () => writeFileAtomic(this.path, json, {
			mode: 384,
			dirMode: 448
		}));
	}
};
//#endregion
//#region src/path-safety.ts
var PathSafetyError = class extends Error {
	code;
	path;
	constructor(code, message, path) {
		super(message);
		this.name = "PathSafetyError";
		this.code = code;
		if (path !== void 0) this.path = path;
	}
	/** Normalize to the RPC error shape; later layers map `code` to user-facing copy. */
	toRpcError() {
		return {
			code: this.code,
			message: this.message,
			details: this.path !== void 0 ? { path: this.path } : {}
		};
	}
};
/** DSH's skill-name grammar: lowercase ASCII letters/digits, hyphen-separated. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function isValidSkillName(name) {
	return SKILL_NAME_RE.test(name);
}
function assertSkillName(name) {
	if (!isValidSkillName(name)) throw new PathSafetyError("invalid-skill-name", `invalid skill name ${JSON.stringify(name)}: expected kebab-case [a-z0-9]+(?:-[a-z0-9]+)*`);
}
/**
* Validate one `files[].path` from a skills.sh snapshot. Such a path must be a
* non-empty, forward-slash relative path. This refuses `..`, `.`/empty segments,
* absolute/rooted forms (POSIX and UNC), Windows drive-letter paths, backslash
* separators, and NUL bytes — failing closed against every escape form.
*/
function assertRelativePath(relPath) {
	if (typeof relPath !== "string" || relPath.length === 0) throw new PathSafetyError("invalid-relative-path", "relative path must be a non-empty string");
	if (relPath.includes("\0")) throw new PathSafetyError("invalid-relative-path", "relative path must not contain NUL bytes");
	if (relPath.startsWith("/") || relPath.startsWith("\\")) throw new PathSafetyError("absolute-path", `relative path must not be absolute: ${JSON.stringify(relPath)}`);
	if (/^[A-Za-z]:/.test(relPath)) throw new PathSafetyError("drive-letter-path", `relative path must not contain a drive letter: ${JSON.stringify(relPath)}`);
	for (const segment of relPath.replace(/\\/g, "/").split("/")) {
		if (segment === "..") throw new PathSafetyError("traversal", `relative path must not contain "..": ${JSON.stringify(relPath)}`);
		if (segment === ".") throw new PathSafetyError("invalid-relative-path", `relative path must not contain ".": ${JSON.stringify(relPath)}`);
		if (segment === "") throw new PathSafetyError("invalid-relative-path", `relative path must not contain empty segments: ${JSON.stringify(relPath)}`);
	}
	if (relPath.includes("\\")) throw new PathSafetyError("invalid-relative-path", `relative path must use forward slashes: ${JSON.stringify(relPath)}`);
}
/**
* Normalize an absolute path to a POSIX-separated comparison form, optionally
* folding case. Comparison uses `path.posix.relative` so case sensitivity is
* decided solely by `caseInsensitive` (not by the host platform's `path`
* module), which keeps the rule explicit and unit-testable everywhere.
*
* The case-insensitive form uses JS `toLowerCase()`, which is exact for this
* module's ASCII domain (skill names are kebab-case; snapshot paths are ASCII)
* but only an approximation of Windows/NTFS case folding in general (it omits
* short-name and trailing-dot aliasing). That approximation can only fail
* closed, and the authoritative case canonicalization for real mutations is
* `realpath` in `assertContainedReal`, not this string comparison.
*/
function toComparable(p, caseInsensitive) {
	const s = resolve(p).replace(/\\/g, "/");
	return caseInsensitive ? s.toLowerCase() : s;
}
function isStrictlyInside(root, candidate, caseInsensitive) {
	const r = toComparable(root, caseInsensitive);
	const c = toComparable(candidate, caseInsensitive);
	const rel = posix.relative(r, c);
	if (rel === "") return false;
	if (posix.isAbsolute(rel)) return false;
	if (rel === ".." || rel.startsWith("../")) return false;
	return true;
}
function isSameOrInside(root, candidate, caseInsensitive) {
	return toComparable(root, caseInsensitive) === toComparable(candidate, caseInsensitive) || isStrictlyInside(root, candidate, caseInsensitive);
}
/** Throw `symlink-escape` unless `candidate` (a realpath result) stays inside `realRoot`. */
function assertRealInside(realRoot, candidate, caseInsensitive, subject) {
	if (!isSameOrInside(realRoot, candidate, caseInsensitive)) throw new PathSafetyError("symlink-escape", `${subject} escapes the skills root: ${JSON.stringify(candidate)}`, candidate);
}
async function tryLstat(p) {
	try {
		return await lstat(p);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw toPathSafetyError(err, p);
	}
}
async function wrapFs(op, path) {
	try {
		return await op;
	} catch (err) {
		throw toPathSafetyError(err, path);
	}
}
function toPathSafetyError(err, path) {
	const code = err?.code;
	const message = err instanceof Error ? err.message : String(err);
	if (code === "ENOENT") return new PathSafetyError("not-found", `not found: ${path} (${message})`, path);
	if (code === "EACCES" || code === "EPERM" || code === "EROFS") return new PathSafetyError("filesystem-permission", `permission denied: ${path} (${message})`, path);
	return new PathSafetyError("filesystem-error", `filesystem error on ${path}: ${message}`, path);
}
/** Relative segments, under the skills root, reserved for the plugin's own metadata. */
const STAGING_SEGMENTS = [
	".system",
	"skill-manager",
	".staging"
];
var SkillRoot = class {
	/** Absolute, normalized skills root. */
	path;
	caseInsensitive;
	constructor(skillsRoot, options = {}) {
		if (typeof skillsRoot !== "string" || skillsRoot.length === 0) throw new PathSafetyError("unsafe-path", "skills root must be a non-empty path");
		this.path = resolve(skillsRoot);
		this.caseInsensitive = options.caseInsensitive ?? process.platform === "win32";
	}
	/** Pure check that `candidate` is strictly inside the root (the root itself is not "inside"). No filesystem access. */
	isInside(candidate) {
		return isStrictlyInside(this.path, candidate, this.caseInsensitive);
	}
	/** Throw `unsafe-path` unless `candidate` is strictly inside the root. */
	assertInside(candidate) {
		if (!this.isInside(candidate)) throw new PathSafetyError("unsafe-path", `path is not strictly inside the skills root: ${JSON.stringify(candidate)}`, candidate);
	}
	/** Validate a skill name and resolve it to a directory strictly inside the root. */
	skillDir(name) {
		assertSkillName(name);
		const target = resolve(this.path, name);
		this.assertInside(target);
		return target;
	}
	/** Resolve the plugin's staging directory for a skill (`.system/skill-manager/.staging/<name>`). */
	stagingDir(name) {
		assertSkillName(name);
		const target = resolve(this.path, ...STAGING_SEGMENTS, name);
		this.assertInside(target);
		return target;
	}
	/**
	* Validate a snapshot `files[].path` and resolve it strictly inside its skill
	* directory. Re-validates `skillDirPath` even though it is branded, so a
	* forged or stale value cannot be used to escape.
	*/
	relativeFile(skillDirPath, relPath) {
		this.assertInside(skillDirPath);
		assertRelativePath(relPath);
		const target = resolve(skillDirPath, ...relPath.split("/"));
		if (!isStrictlyInside(skillDirPath, target, this.caseInsensitive)) throw new PathSafetyError("unsafe-path", `file path escapes its skill directory: ${JSON.stringify(relPath)}`, target);
		return target;
	}
	/**
	* Resolve-and-contain: verify `target` is strictly inside the root at the
	* string level, then `lstat` the target and every ancestor component and
	* refuse any symlink/junction whose `realpath` resolution leaves the real
	* root (spec §8(4)). A component that does not exist yet stops the walk —
	* nothing deeper can exist either, so a not-yet-created target is permitted.
	*/
	async assertContainedReal(target) {
		this.assertInside(target);
		const realRoot = await this.realRoot();
		const segments = relative(this.path, target).split(sep).filter(Boolean);
		let current = this.path;
		for (const segment of segments) {
			current = join(current, segment);
			const st = await tryLstat(current);
			if (!st) break;
			if (st.isSymbolicLink()) assertRealInside(realRoot, await wrapFs(realpath(current), current), this.caseInsensitive, "symlink/junction");
		}
	}
	/** Create (idempotently) the staging directory for a skill. */
	async createStagingDir(name) {
		const target = this.stagingDir(name);
		await this.mkdirContained(target);
		return target;
	}
	/** Remove a skill's staging directory (idempotent). */
	async removeStagingDir(name) {
		await this.removeContained(this.stagingDir(name));
	}
	/** Atomically rename a staged directory into place as the skill directory. */
	async publishStaged(name) {
		const from = this.stagingDir(name);
		const to = this.skillDir(name);
		await this.assertContainedReal(from);
		await this.assertContainedReal(to);
		await wrapFs(rename(from, to), to);
	}
	/** Recursively delete a validated skill directory (idempotent; never follows links). */
	async removeSkillDir(name) {
		await this.removeContained(this.skillDir(name));
	}
	/**
	* Classify the on-disk entry at a validated skill directory path using
	* `lstat` (never follows links). This is the single seam transactions use to
	* decide ownership/missing-state/drift without reaching into `node:fs` or
	* duplicating errno mapping. Missing only means the path is absent; a
	* symlink/junction is reported as `symlink`, not followed.
	*/
	async classifySkill(name) {
		const st = await tryLstat(this.skillDir(name));
		if (!st) return "missing";
		if (st.isSymbolicLink()) return "symlink";
		if (st.isDirectory()) return "directory";
		return "file";
	}
	async realRoot() {
		return wrapFs(realpath(this.path), this.path);
	}
	/**
	* Create `target` one path component at a time, lstat-checking each existing
	* component is a real directory (not a symlink/junction) before descending.
	* This avoids `mkdir -p`'s habit of following a symlink that appears mid-path
	* between the containment check and the create.
	*/
	async mkdirContained(target) {
		this.assertInside(target);
		const realRoot = await this.realRoot();
		const rel = relative(this.path, target);
		if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) throw new PathSafetyError("unsafe-path", "target is not below the skills root", target);
		let current = this.path;
		for (const segment of rel.split(sep)) {
			if (segment === "") continue;
			current = join(current, segment);
			const st = await tryLstat(current);
			if (st) {
				if (st.isSymbolicLink()) throw new PathSafetyError("symlink-escape", `refusing symlink/junction in staging path: ${JSON.stringify(current)}`, current);
				if (!st.isDirectory()) throw new PathSafetyError("not-a-directory", `staging path component is not a directory: ${JSON.stringify(current)}`, current);
			} else await wrapFs(mkdir(current), current);
		}
		assertRealInside(realRoot, await wrapFs(realpath(target), target), this.caseInsensitive, "staging path");
	}
	async removeContained(target) {
		this.assertInside(target);
		await this.assertContainedReal(target);
		const st = await tryLstat(target);
		if (!st) return;
		if (st.isSymbolicLink()) {
			await wrapFs(rm(target), target);
			return;
		}
		if (st.isDirectory()) {
			await wrapFs(rm(target, {
				recursive: true,
				force: true
			}), target);
			return;
		}
		await wrapFs(rm(target), target);
	}
};
//#endregion
//#region src/service.ts
var SkillManagerService = class {
	version;
	now;
	skillRoot;
	manifestStore;
	constructor(options) {
		this.version = options.version;
		this.now = options.now ?? Date.now;
		this.skillRoot = options.skillRoot ?? new SkillRoot(options.skillsRoot);
		this.manifestStore = options.manifestStore ?? new ManifestStore(options.skillsRoot);
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
	* Uninstall a plugin-managed skill (spec §11). Only a manifest-recorded skill
	* is removable (foreign → refuse); local drift and the removal itself are each
	* confirmation-gated; the directory is deleted first and the manifest entry is
	* removed second, so any interruption is recovered by reconcile-on-load.
	*/
	async uninstall(input) {
		if (typeof input?.id !== "string") throw new SkillManagerError("invalid-request", "uninstall requires a string \"id\"", {});
		const { id } = input;
		const skillDir = this.skillRoot.skillDir(id);
		const load = await this.loadManifest();
		if (load.status === "corrupt") throw new SkillManagerError("manifest-corruption", `cannot uninstall: the manifest is corrupt (${load.corruption?.reason ?? "unknown"})`, { reason: load.corruption?.reason });
		const entry = load.manifest.skills[id];
		if (!entry) {
			if (load.dropped.includes(id)) {
				const kind = await this.skillRoot.classifySkill(id);
				if (kind === "symlink") throw new PathSafetyError("symlink-escape", `skill "${id}" is a symlink/junction, not a managed directory`, skillDir);
				if (kind !== "missing") throw new SkillManagerError("foreign-skill", `"${id}" is not a managed skill directory`, { id });
				await this.persistManifest(load.manifest, `skill "${id}" is already uninstalled but its manifest entry could not be removed`);
				return { ok: true };
			}
			if (await this.skillRoot.classifySkill(id) !== "missing") throw new SkillManagerError("foreign-skill", `skill "${id}" is not managed by this plugin and will not be removed`, { id });
			throw new SkillManagerError("skill-not-found", `skill "${id}" is not installed`, { id });
		}
		if (await this.hasLocalDrift(id, entry.localContentHash) && input.discardLocalChanges !== true) throw new SkillManagerError("local-modification-conflict", `skill "${id}" has local changes that will be discarded`, { id });
		if (input.confirm !== true) throw new SkillManagerError("confirmation-required", `confirm removal of skill "${id}"`, { id });
		await this.skillRoot.removeSkillDir(id);
		await this.persistManifest(this.withoutEntry(load.manifest, id), "removed the skill directory but failed to update the manifest");
		return { ok: true };
	}
	/** Recompute the local-content hash and compare to the recorded value. */
	async hasLocalDrift(id, recorded) {
		const kind = await this.skillRoot.classifySkill(id);
		if (kind === "missing") return false;
		if (kind !== "directory") return true;
		return await computeLocalContentHash(this.skillRoot.skillDir(id)) !== recorded;
	}
	async loadManifest() {
		try {
			return await this.manifestStore.load();
		} catch (err) {
			throw toFilesystemError(err, this.skillRoot.path);
		}
	}
	async persistManifest(manifest, failureMessage) {
		try {
			await this.manifestStore.save(manifest);
		} catch (err) {
			throw new SkillManagerError("uninstall-partial-failure", failureMessage, { cause: err instanceof Error ? err.message : String(err) });
		}
	}
	withoutEntry(manifest, id) {
		const skills = { ...manifest.skills };
		delete skills[id];
		return {
			version: manifest.version,
			skills
		};
	}
};
//#endregion
//#region src/skills-root.ts
/** Resolve `$DSH_HOME/skills` (default `~/.dsh/skills`). Injectable for tests. */
function resolveSkillsRoot(env = process.env, home = homedir()) {
	const dshHome = env.DSH_HOME && env.DSH_HOME.trim() !== "" ? env.DSH_HOME.trim() : join(home, ".dsh");
	return join(dshHome, "skills");
}
//#endregion
//#region src/index.ts
/** Declared cordis service dependencies for the host half. */
const inject = ["connection"];
/** Entry point invoked by the DSH host runner at boot. */
function apply(ctx) {
	const service = new SkillManagerService({
		version: PLUGIN_VERSION,
		skillsRoot: resolveSkillsRoot()
	});
	const disposer = ctx.get("connection").rpc.handle(RPC_CHANNEL, createRpcHandler(service));
	ctx.effect(() => disposer, `${PLUGIN_NAME}: ${RPC_CHANNEL} channel`);
	console.log(`[${PLUGIN_NAME}] registered ${RPC_CHANNEL} RPC channel`);
}
//#endregion
export { apply, inject };
