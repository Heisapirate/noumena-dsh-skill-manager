// RPC contract constants shared by the host and client halves. Kept in one
// place so the channel name and endpoint names cannot drift apart.

export const RPC_CHANNEL = '/skill-manager';

export const ENDPOINT_HEALTH = 'health';
/** Liveness alias of {@link ENDPOINT_HEALTH} (Issue #9 acceptance surface). */
export const ENDPOINT_PING = 'ping';
/** List the plugin-managed skills on disk with provenance + status (Issue #15). */
export const ENDPOINT_LIST = 'list';
/** Search skills.sh and return normalized basic results (Issue #13). */
export const ENDPOINT_SEARCH = 'search';
/** Lazily hydrate one result's description from its snapshot (Issue #13). */
export const ENDPOINT_DESCRIBE = 'describe';
/** Installs one GitHub-backed skill (Issue #14 install transaction). */
export const ENDPOINT_INSTALL = 'install';
/** Update detection endpoint (Issue #16). */
export const ENDPOINT_CHECK_UPDATES = 'checkUpdates';
/** Update transaction endpoint (Issue #16). */
export const ENDPOINT_UPDATE = 'update';
/** Remove a plugin-managed skill (Issue #17; destructive, confirmation-gated). */
export const ENDPOINT_UNINSTALL = 'uninstall';
