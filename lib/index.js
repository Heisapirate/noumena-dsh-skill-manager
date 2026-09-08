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
	/**
	* Write a set of snapshot files into a validated directory (a staging or skill
	* dir). Every file path is re-validated and resolved strictly inside `dir`,
	* its parent directory is created one component at a time (never through an
	* unverified symlink), and the file is written only to the validated target.
	*/
	async materializeFiles(dir, files) {
		this.assertInside(dir);
		for (const file of files) {
			const target = this.relativeFile(dir, file.path);
			await this.mkdirContained(dirname(target));
			await wrapFs(writeFile(target, file.contents, "utf8"), target);
		}
	}
	/** Atomically rename a staged directory into place as the skill directory. */
	async publishStaged(name) {
		const from = this.stagingDir(name);
		const to = this.skillDir(name);
		await this.assertContainedReal(from);
		await this.assertContainedReal(to);
		await wrapFs(rename(from, to), to);
	}
	/**
	* Move an existing skill directory to its backup slot (under the staging area)
	* so a staged replacement can be renamed into place. Returns whether there was
	* a skill directory to move. A stale backup is dropped first only when the
	* current skill dir still exists (the current content is authoritative).
	*/
	async moveSkillToBackup(name) {
		const to = this.skillDir(name);
		const backup = this.backupDir(name);
		await this.assertContainedReal(to);
		if (!await tryLstat(to)) return false;
		await this.removeContained(backup);
		await wrapFs(rename(to, backup), backup);
		return true;
	}
	/** Restore a backed-up skill directory back to the skill dir (rollback). */
	async restoreBackup(name) {
		const to = this.skillDir(name);
		const backup = this.backupDir(name);
		await this.assertContainedReal(backup);
		if (!await tryLstat(backup)) return;
		await wrapFs(rename(backup, to), to);
	}
	/** Delete a skill's backup directory (idempotent). */
	async removeBackup(name) {
		await this.removeContained(this.backupDir(name));
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
	/** Backup slot for a skill's prior directory, kept inside the staging area. */
	backupDir(name) {
		assertSkillName(name);
		const target = resolve(this.path, ...STAGING_SEGMENTS, `.backup-${name}`);
		this.assertInside(target);
		return target;
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
//#region src/install.ts
var InstallError = class extends Error {
	code;
	path;
	constructor(code, message, options = {}) {
		super(message, { cause: options.cause });
		this.name = "InstallError";
		this.code = code;
		if (options.path !== void 0) this.path = options.path;
	}
	/** Normalize to the RPC error shape; the UI maps `code` to localized copy. */
	toRpcError() {
		return {
			code: this.code,
			message: this.message,
			details: this.path !== void 0 ? { path: this.path } : {}
		};
	}
};
/**
* Run the install transaction. On success the skill directory is complete at
* `$DSH_HOME/skills/<slug>` and the manifest entry is recorded; on any failure
* the prior state is left untouched and no partial directory/entry survives.
*/
async function installSkill(deps, request, signal) {
	const now = deps.now ?? Date.now;
	const parts = typeof request.id === "string" && request.id.trim() !== "" ? splitDownloadId(request.id) : null;
	if (!parts) throw new InstallError("source-unavailable", `cannot install ${JSON.stringify(request.id)}: expected a skills.sh id "owner/repo/slug"`);
	const { owner, repo, slug } = parts;
	const source = `${owner}/${repo}`;
	if (classifySource(source) !== "github") throw new InstallError("source-unavailable", `cannot install ${JSON.stringify(request.id)}: source ${JSON.stringify(source)} is not a GitHub owner/repo`);
	if (!isValidSkillName(slug)) throw new InstallError("invalid-skill-name", `invalid skill name ${JSON.stringify(slug)}: expected kebab-case [a-z0-9]+(?:-[a-z0-9]+)*`);
	const snapshot = await deps.client.getSnapshot(request.id, signal ? { signal } : {});
	validateSnapshotForInstall(deps.root, slug, snapshot);
	let loaded;
	try {
		loaded = await deps.store.load();
	} catch (err) {
		throw toInstallError(err);
	}
	const skillDir = deps.root.skillDir(slug);
	const targetExists = await pathExists$1(skillDir);
	const managedEntry = loaded.manifest.skills[slug];
	if (targetExists && !managedEntry) throw new InstallError("foreign-target", `refusing to overwrite a foreign skill at ${JSON.stringify(skillDir)}`, { path: skillDir });
	if (targetExists && request.overwrite !== true) throw new InstallError("duplicate-install", `skill ${JSON.stringify(slug)} is already plugin-managed; confirm overwrite to replace it`, { path: skillDir });
	let staged;
	try {
		await deps.root.removeStagingDir(slug);
		staged = await deps.root.createStagingDir(slug);
		await deps.root.materializeFiles(staged, snapshot.files);
	} catch (err) {
		await safeRemoveStaging(deps.root, slug);
		throw toInstallError(err);
	}
	const contentHash = await computeInstalledContentHash(deps.root, staged, snapshot.files);
	try {
		if (targetExists) await deps.root.moveSkillToBackup(slug);
		await deps.root.publishStaged(slug);
	} catch (err) {
		if (targetExists) await safeRestoreBackup(deps.root, slug);
		await safeRemoveStaging(deps.root, slug);
		throw toInstallError(err);
	}
	const timestamp = new Date(now()).toISOString();
	const entry = {
		source,
		slug,
		remoteSourceHash: snapshot.remoteSourceHash,
		localContentHash: contentHash,
		installedAt: targetExists && managedEntry ? managedEntry.installedAt : timestamp,
		updatedAt: timestamp
	};
	const nextManifest = {
		version: 1,
		skills: {
			...loaded.manifest.skills,
			[slug]: entry
		}
	};
	try {
		await deps.store.save(nextManifest);
	} catch (err) {
		await safeRemoveSkillDir(deps.root, slug);
		if (targetExists) await safeRestoreBackup(deps.root, slug);
		await safeRemoveStaging(deps.root, slug);
		throw toInstallError(err);
	}
	if (targetExists) await safeRemoveBackup(deps.root, slug);
	await safeRemoveStaging(deps.root, slug);
	return {
		slug,
		source,
		remoteSourceHash: entry.remoteSourceHash,
		localContentHash: entry.localContentHash,
		installedAt: entry.installedAt,
		updatedAt: entry.updatedAt
	};
}
function validateSnapshotForInstall(root, slug, snapshot) {
	const files = snapshot.files;
	if (!Array.isArray(files) || files.length === 0) throw new InstallError("malformed-snapshot", "snapshot contains no files");
	const skillDir = root.skillDir(slug);
	const seen = /* @__PURE__ */ new Set();
	let hasSkillMd = false;
	for (const file of files) {
		try {
			root.relativeFile(skillDir, file.path);
		} catch (err) {
			if (err instanceof PathSafetyError) throw toInstallError(err);
			throw err;
		}
		const key = root.caseInsensitive ? file.path.toLowerCase() : file.path;
		if (seen.has(key)) throw new InstallError("malformed-snapshot", `snapshot contains a duplicate file path ${JSON.stringify(file.path)}`);
		seen.add(key);
		if (file.path === "SKILL.md") {
			hasSkillMd = true;
			validateSkillMd$1(slug, file.contents);
		}
	}
	if (!hasSkillMd) throw new InstallError("malformed-snapshot", "snapshot is missing SKILL.md");
}
/** `SKILL.md` must declare a valid `name` (matching the slug) and a `description`. */
function validateSkillMd$1(slug, contents) {
	const metadata = extractFrontmatterMetadata(contents);
	if (!metadata.name || !isValidSkillName(metadata.name)) throw new InstallError("malformed-snapshot", "SKILL.md frontmatter must declare a valid kebab-case name");
	if (metadata.name !== slug) throw new InstallError("malformed-snapshot", `SKILL.md name ${JSON.stringify(metadata.name)} does not match the requested slug ${JSON.stringify(slug)}`);
	if (typeof metadata.description !== "string" || metadata.description.trim() === "") throw new InstallError("malformed-snapshot", "SKILL.md frontmatter must declare a non-empty description");
}
/** Map boundary/FS failures to the install error surface; pass typed errors through. */
function toInstallError(err) {
	if (err instanceof InstallError || isSkillsShError(err)) return err;
	if (err instanceof PathSafetyError) {
		if (err.code === "invalid-skill-name") return new InstallError("invalid-skill-name", err.message, { path: err.path });
		if (err.code === "filesystem-permission") return new InstallError("filesystem-permission", err.message, { path: err.path });
		if (err.code === "unsafe-path" || err.code === "traversal" || err.code === "absolute-path" || err.code === "drive-letter-path" || err.code === "invalid-relative-path" || err.code === "symlink-escape") return new InstallError("unsafe-path", err.message, { path: err.path });
		return new InstallError("install-partial-failure", err.message, {
			path: err.path,
			cause: err
		});
	}
	const code = err?.code;
	const message = err instanceof Error ? err.message : String(err);
	if (code === "EACCES" || code === "EPERM" || code === "EROFS") return new InstallError("filesystem-permission", message, { cause: err });
	return new InstallError("install-partial-failure", message, { cause: err });
}
/**
* Recompute the deterministic local-content hash from the bytes on disk (the
* staged directory that is about to be published), not from the in-memory
* snapshot. This keeps the recorded hash truthful to the installed content
* even if materialization ever normalizes or transforms bytes.
*/
async function computeInstalledContentHash(root, staged, files) {
	const installed = [];
	for (const file of files) installed.push({
		path: file.path,
		contents: await readFile(root.relativeFile(staged, file.path), "utf8")
	});
	return localContentHash(installed);
}
async function pathExists$1(p) {
	try {
		await lstat(p);
		return true;
	} catch (err) {
		if (err.code === "ENOENT") return false;
		throw err;
	}
}
async function safeRemoveStaging(root, slug) {
	try {
		await root.removeStagingDir(slug);
	} catch {}
}
async function safeRestoreBackup(root, slug) {
	try {
		await root.restoreBackup(slug);
	} catch {}
}
async function safeRemoveSkillDir(root, slug) {
	try {
		await root.removeSkillDir(slug);
	} catch {}
}
async function safeRemoveBackup(root, slug) {
	try {
		await root.removeBackup(slug);
	} catch {}
}
//#endregion
//#region src/update/errors.ts
/** A normalized, RPC-serializable failure raised by the update transaction. */
var UpdateError = class extends Error {
	code;
	details;
	constructor(code, message, details = {}) {
		super(message);
		this.name = "UpdateError";
		this.code = code;
		this.details = details;
	}
	/** The RPC-serializable `{code,message,details}` form of this error. */
	toRpcError() {
		return {
			code: this.code,
			message: this.message,
			details: this.details
		};
	}
};
/** Type guard narrowing an unknown thrown value to {@link UpdateError}. */
function isUpdateError(err) {
	return err instanceof UpdateError;
}
//#endregion
//#region src/rpc-error.ts
/** Normalize any thrown value to the RPC `{code,message,details}` error shape. */
function toRpcError(err) {
	if (err instanceof InstallError) return err.toRpcError();
	if (isUpdateError(err)) return err.toRpcError();
	if (err instanceof SkillManagerError) return err.toRpcError();
	if (isSkillsShError(err)) {
		const object = err.toObject();
		return {
			code: object.code,
			message: object.message,
			details: object.details
		};
	}
	if (err instanceof PathSafetyError) return err.toRpcError();
	if (err instanceof Error) return {
		code: "internal",
		message: err.message,
		details: {}
	};
	return {
		code: "internal",
		message: "Unknown error",
		details: {}
	};
}
//#endregion
//#region src/update/snapshot.ts
/**
* Validate a fetched snapshot before any filesystem mutation. Refuses (1) an
* empty snapshot, (2) any file path that fails safe resolution (mapped to
* `unsafe-path`), (3) duplicate paths, and (4) a `SKILL.md` that is missing or
* whose frontmatter name/description are invalid.
*/
function assertSnapshotSafe(root, slug, snapshot) {
	const files = snapshot.files;
	if (!Array.isArray(files) || files.length === 0) throw new UpdateError("malformed-snapshot", "snapshot contains no files");
	const skillDir = root.skillDir(slug);
	const seen = /* @__PURE__ */ new Set();
	let hasSkillMd = false;
	for (const file of files) {
		try {
			root.relativeFile(skillDir, file.path);
		} catch (err) {
			if (err instanceof PathSafetyError) throw new UpdateError("unsafe-path", err.message, { path: err.path });
			throw err;
		}
		const key = root.caseInsensitive ? file.path.toLowerCase() : file.path;
		if (seen.has(key)) throw new UpdateError("malformed-snapshot", `snapshot contains a duplicate file path ${JSON.stringify(file.path)}`);
		seen.add(key);
		if (file.path === "SKILL.md") {
			hasSkillMd = true;
			validateSkillMd(slug, file.contents);
		}
	}
	if (!hasSkillMd) throw new UpdateError("malformed-snapshot", "snapshot is missing SKILL.md");
}
/** `SKILL.md` must declare a kebab-case `name` (equal to the slug) and a description. */
function validateSkillMd(slug, contents) {
	const metadata = extractFrontmatterMetadata(contents);
	if (!metadata.name || !isValidSkillName(metadata.name)) throw new UpdateError("malformed-snapshot", "SKILL.md frontmatter must declare a valid kebab-case name");
	if (metadata.name !== slug) throw new UpdateError("malformed-snapshot", `SKILL.md name ${JSON.stringify(metadata.name)} does not match the requested slug ${JSON.stringify(slug)}`);
	if (typeof metadata.description !== "string" || metadata.description.trim() === "") throw new UpdateError("malformed-snapshot", "SKILL.md frontmatter must declare a non-empty description");
}
//#endregion
//#region src/update/status.ts
/**
* Resolve a skill's update status and change flags in one pass. Remote-check
* failures take precedence over drift so an unavailable or unreachable source
* is never misreported as "up to date" or "update available"; `source-unavailable`
* (404/snapshot missing) is distinguished from other remote failures (§10).
*/
function resolveStatus(input) {
	const updateAvailable = input.latestRemoteSourceHash !== null && input.latestRemoteSourceHash !== input.recordedRemoteSourceHash;
	const localModified = input.currentLocalContentHash !== null && input.currentLocalContentHash !== input.recordedLocalContentHash;
	let status;
	if (input.remoteError) status = input.remoteError.code === "source-unavailable" ? "source-unavailable" : "remote-check-failure";
	else if (updateAvailable && localModified) status = "update-available-and-locally-modified";
	else if (updateAvailable) status = "update-available";
	else if (localModified) status = "locally-modified";
	else status = "up-to-date";
	return {
		status,
		updateAvailable,
		localModified
	};
}
/** Build the full {@link UpdateInfo} DTO for one skill. */
function buildUpdateInfo(input) {
	const { status, updateAvailable, localModified } = resolveStatus({
		recordedRemoteSourceHash: input.entry.remoteSourceHash,
		latestRemoteSourceHash: input.latestRemoteSourceHash,
		recordedLocalContentHash: input.entry.localContentHash,
		currentLocalContentHash: input.currentLocalContentHash,
		remoteError: input.remoteError
	});
	const info = {
		slug: input.slug,
		status,
		updateAvailable,
		upstreamChanged: updateAvailable,
		localModified,
		recordedRemoteSourceHash: input.entry.remoteSourceHash,
		recordedLocalContentHash: input.entry.localContentHash
	};
	if (input.latestRemoteSourceHash !== null) info.latestRemoteSourceHash = input.latestRemoteSourceHash;
	if (input.currentLocalContentHash !== null) info.currentLocalContentHash = input.currentLocalContentHash;
	if (input.remoteError) info.error = input.remoteError;
	return info;
}
//#endregion
//#region src/update/swap.ts
async function pathExists(p) {
	try {
		await lstat(p);
		return true;
	} catch (err) {
		if (err.code === "ENOENT") return false;
		throw err;
	}
}
/**
* Repair an interrupted replacement. For each `.backup-<slug>` directory under
* `.staging/`: restore it when the skill directory is missing, and remove it
* when the skill directory is already present (stale backup). Best-effort —
* recovery never masks the operation that triggered it.
*/
async function recoverInterruptedSwap(root) {
	const stagingParent = join(root.path, ".system", "skill-manager", ".staging");
	let entries;
	try {
		entries = await readdir(stagingParent, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith(".backup-")) continue;
		const slug = entry.name.slice(8);
		if (!isValidSkillName(slug)) continue;
		if (await pathExists(root.skillDir(slug))) await root.removeBackup(slug).catch(() => {});
		else await root.restoreBackup(slug).catch(() => {});
	}
}
//#endregion
//#region src/update/manager.ts
/**
* Host-side orchestrator for update detection and the update transaction. It
* composes the merged foundations and is constructed per skills root; the RPC
* layer delegates `checkUpdates`/`update` to it.
*/
var UpdateManager = class {
	client;
	now;
	root;
	store;
	constructor(options) {
		this.client = options.client;
		this.now = options.now ?? Date.now;
		this.root = options.root ?? new SkillRoot(options.skillsRoot);
		this.store = options.store ?? new ManifestStore(options.skillsRoot);
	}
	/**
	* Report the update state of every plugin-managed skill that is present on
	* disk. Per-skill remote failures never abort the whole check — they are
	* recorded as `source-unavailable` or `remote-check-failure` on that skill.
	*/
	async checkUpdates() {
		await recoverInterruptedSwap(this.root);
		const { manifest } = await this.store.load();
		const updates = [];
		for (const [slug, entry] of Object.entries(manifest.skills)) {
			const id = `${entry.source}/${slug}`;
			let currentLocalContentHash = null;
			try {
				currentLocalContentHash = await computeLocalContentHash(this.root.skillDir(slug));
			} catch {}
			let latestRemoteSourceHash = null;
			let remoteError;
			try {
				latestRemoteSourceHash = (await this.client.getSnapshot(id)).remoteSourceHash;
			} catch (err) {
				remoteError = toRpcError(err);
			}
			updates.push(buildUpdateInfo({
				slug,
				entry,
				latestRemoteSourceHash,
				currentLocalContentHash,
				remoteError
			}));
		}
		return { updates: updates.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) };
	}
	/**
	* Apply the latest upstream snapshot to one skill, in the spec's accepted
	* transaction order. Throws a typed error for every refusal/failure path;
	* the RPC layer normalizes it to `{ok:false,error}`.
	*/
	async update(input) {
		const id = input.id;
		const parts = splitDownloadId(id);
		const source = parts ? `${parts.owner}/${parts.repo}` : "";
		if (!parts || classifySource(source) !== "github") throw new UpdateError("source-unavailable", `cannot update ${JSON.stringify(id)}: only GitHub owner/repo/slug sources are updatable`);
		assertSkillName(parts.slug);
		const { slug } = parts;
		await recoverInterruptedSwap(this.root);
		const load = await this.store.load();
		if (load.status === "corrupt") throw new UpdateError("manifest-corruption", load.corruption?.detail ?? "manifest is corrupt");
		const entry = load.manifest.skills[slug];
		if (!entry) throw new UpdateError("skill-not-found", `${JSON.stringify(slug)} is not a plugin-managed skill`);
		if (entry.source !== source) throw new UpdateError("skill-not-found", `${JSON.stringify(slug)} was installed from ${JSON.stringify(entry.source)}, not ${JSON.stringify(source)}`);
		const snapshot = await this.client.getSnapshot(id);
		assertSnapshotSafe(this.root, slug, snapshot);
		const drifted = await computeLocalContentHash(this.root.skillDir(slug)) !== entry.localContentHash;
		if (drifted && input.discardLocalChanges !== true) throw new UpdateError("local-modification-conflict", `${JSON.stringify(slug)} has local modifications; pass discardLocalChanges to overwrite`, { slug });
		if (!(snapshot.remoteSourceHash !== entry.remoteSourceHash) && !drifted) return {
			slug,
			source: entry.source,
			remoteSourceHash: snapshot.remoteSourceHash,
			localContentHash: entry.localContentHash,
			updatedAt: entry.updatedAt,
			discardedLocalChanges: false,
			applied: false
		};
		let staged;
		try {
			await this.root.removeStagingDir(slug);
			staged = await this.root.createStagingDir(slug);
			await this.root.materializeFiles(staged, snapshot.files);
		} catch (err) {
			await this.root.removeStagingDir(slug).catch(() => {});
			throw err;
		}
		const newLocalContentHash = await computeLocalContentHash(staged);
		try {
			await this.root.moveSkillToBackup(slug);
			await this.root.publishStaged(slug);
		} catch (err) {
			await this.root.restoreBackup(slug).catch(() => {});
			await this.root.removeStagingDir(slug).catch(() => {});
			throw err;
		}
		const updated = {
			...entry,
			remoteSourceHash: snapshot.remoteSourceHash,
			localContentHash: newLocalContentHash,
			updatedAt: new Date(this.now()).toISOString()
		};
		const next = {
			version: load.manifest.version,
			skills: {
				...load.manifest.skills,
				[slug]: updated
			}
		};
		try {
			await this.store.save(next);
		} catch (err) {
			await this.root.removeSkillDir(slug).catch(() => {});
			await this.root.restoreBackup(slug).catch(() => {});
			await this.root.removeStagingDir(slug).catch(() => {});
			throw new UpdateError("update-partial-failure", `skill update failed to record: ${err instanceof Error ? err.message : String(err)}`);
		}
		await this.root.removeBackup(slug).catch(() => {});
		return {
			slug,
			source: entry.source,
			remoteSourceHash: snapshot.remoteSourceHash,
			localContentHash: newLocalContentHash,
			updatedAt: updated.updatedAt,
			discardedLocalChanges: drifted,
			applied: true
		};
	}
};
//#endregion
//#region src/rpc.ts
/** Endpoints that answer the health probe; `ping` is a liveness alias of `health`. */
const HEALTH_ENDPOINTS = /* @__PURE__ */ new Set([ENDPOINT_HEALTH, ENDPOINT_PING]);
/**
* Build the host-side handler for the `/skill-manager` channel. It dispatches a
* channel-relative endpoint to a service method and normalizes every outcome to
* the typed `{ok,value}|{ok:false,error}` result — never a raw throw.
*/
function createRpcHandler(service) {
	return async (endpoint, payload, signal) => {
		try {
			if (HEALTH_ENDPOINTS.has(endpoint)) return {
				ok: true,
				value: service.health()
			};
			if (endpoint === "install") {
				const request = coerceInstallRequest(payload);
				return {
					ok: true,
					value: await service.install(request, signal)
				};
			}
			if (endpoint === "checkUpdates") return {
				ok: true,
				value: await service.checkUpdates()
			};
			if (endpoint === "update") return {
				ok: true,
				value: await service.update(parseUpdateInput(payload))
			};
			if (endpoint === "uninstall") return {
				ok: true,
				value: await service.uninstall(parseUninstallInput(payload))
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
				error: toRpcError(err)
			};
		}
	};
}
/** Coerce the `install` payload; an absent/invalid id is surfaced by the transaction as typed. */
function coerceInstallRequest(payload) {
	const body = typeof payload === "object" && payload !== null ? payload : {};
	return {
		id: typeof body.id === "string" ? body.id : "",
		overwrite: body.overwrite === true
	};
}
/** Validate the `update` payload shape; throws an `invalid-request` error. */
function parseUpdateInput(payload) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new UpdateError("invalid-request", "update payload must be an object");
	const record = payload;
	if (typeof record.id !== "string" || record.id.length === 0) throw new UpdateError("invalid-request", "update payload requires a non-empty string \"id\"");
	const input = { id: record.id };
	if (record.discardLocalChanges !== void 0) {
		if (typeof record.discardLocalChanges !== "boolean") throw new UpdateError("invalid-request", "\"discardLocalChanges\" must be a boolean");
		input.discardLocalChanges = record.discardLocalChanges;
	}
	return input;
}
/** Validate the `uninstall` payload shape; throws an `invalid-request` error. */
function parseUninstallInput(payload) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new SkillManagerError("invalid-request", "uninstall payload must be an object");
	const record = payload;
	if (typeof record.id !== "string" || record.id.length === 0) throw new SkillManagerError("invalid-request", "uninstall payload requires a non-empty string \"id\"");
	const input = { id: record.id };
	if (record.confirm !== void 0) {
		if (typeof record.confirm !== "boolean") throw new SkillManagerError("invalid-request", "\"confirm\" must be a boolean");
		input.confirm = record.confirm;
	}
	if (record.discardLocalChanges !== void 0) {
		if (typeof record.discardLocalChanges !== "boolean") throw new SkillManagerError("invalid-request", "\"discardLocalChanges\" must be a boolean");
		input.discardLocalChanges = record.discardLocalChanges;
	}
	return input;
}
//#endregion
//#region src/service.ts
var SkillManagerService = class {
	version;
	now;
	deps;
	updateManager;
	constructor(options) {
		this.version = options.version;
		this.now = options.now ?? Date.now;
		const root = options.root ?? new SkillRoot(options.skillsRoot);
		const store = options.store ?? new ManifestStore(options.skillsRoot);
		this.deps = {
			client: options.client,
			root,
			store,
			now: this.now
		};
		this.updateManager = new UpdateManager({
			skillsRoot: options.skillsRoot,
			client: options.client,
			now: this.now,
			root,
			store
		});
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
	/** Install one GitHub-backed skill as an atomic transaction (Issue #14). */
	install(request, signal) {
		return installSkill(this.deps, request, signal);
	}
	/** Update detection for every plugin-managed skill (Issue #16). */
	checkUpdates() {
		return this.updateManager.checkUpdates();
	}
	/** Apply the latest upstream snapshot to one skill (Issue #16). */
	update(input) {
		return this.updateManager.update(input);
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
		const root = this.deps.root;
		this.deps.store;
		const skillDir = root.skillDir(id);
		const load = await this.loadManifest();
		if (load.status === "corrupt") throw new SkillManagerError("manifest-corruption", `cannot uninstall: the manifest is corrupt (${load.corruption?.reason ?? "unknown"})`, { reason: load.corruption?.reason });
		const entry = load.manifest.skills[id];
		if (!entry) {
			if (load.dropped.includes(id)) {
				const kind = await root.classifySkill(id);
				if (kind === "symlink") throw new PathSafetyError("symlink-escape", `skill "${id}" is a symlink/junction, not a managed directory`, skillDir);
				if (kind !== "missing") throw new SkillManagerError("foreign-skill", `"${id}" is not a managed skill directory`, { id });
				await this.persistManifest(load.manifest, `skill "${id}" is already uninstalled but its manifest entry could not be removed`);
				return { ok: true };
			}
			if (await root.classifySkill(id) !== "missing") throw new SkillManagerError("foreign-skill", `skill "${id}" is not managed by this plugin and will not be removed`, { id });
			throw new SkillManagerError("skill-not-found", `skill "${id}" is not installed`, { id });
		}
		if (await this.hasLocalDrift(id, entry.localContentHash) && input.discardLocalChanges !== true) throw new SkillManagerError("local-modification-conflict", `skill "${id}" has local changes that will be discarded`, { id });
		if (input.confirm !== true) throw new SkillManagerError("confirmation-required", `confirm removal of skill "${id}"`, { id });
		await root.removeSkillDir(id);
		await this.persistManifest(this.withoutEntry(load.manifest, id), "removed the skill directory but failed to update the manifest");
		return { ok: true };
	}
	/** Recompute the local-content hash and compare to the recorded value. */
	async hasLocalDrift(id, recorded) {
		const kind = await this.deps.root.classifySkill(id);
		if (kind === "missing") return false;
		if (kind !== "directory") return true;
		return await computeLocalContentHash(this.deps.root.skillDir(id)) !== recorded;
	}
	async loadManifest() {
		try {
			return await this.deps.store.load();
		} catch (err) {
			throw toFilesystemError(err, this.deps.root.path);
		}
	}
	async persistManifest(manifest, failureMessage) {
		try {
			await this.deps.store.save(manifest);
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
/**
* Resolve the skills root from the environment. `DSH_HOME` (the same variable
* DSH's own runtime uses) overrides the `~/.dsh` default.
*/
function resolveSkillsRoot(env = process.env) {
	const home = env.DSH_HOME?.trim() || join(homedir(), ".dsh");
	return join(home, "skills");
}
//#endregion
//#region src/index.ts
/** Declared cordis service dependencies for the host half. */
const inject = ["connection"];
/** Entry point invoked by the DSH host runner at boot. */
function apply(ctx) {
	const service = new SkillManagerService({
		version: PLUGIN_VERSION,
		skillsRoot: resolveSkillsRoot(),
		client: createSkillsShClient()
	});
	const disposer = ctx.get("connection").rpc.handle(RPC_CHANNEL, createRpcHandler(service));
	ctx.effect(() => disposer, `${PLUGIN_NAME}: ${RPC_CHANNEL} channel`);
	console.log(`[${PLUGIN_NAME}] registered ${RPC_CHANNEL} RPC channel`);
}
//#endregion
export { apply, inject };
