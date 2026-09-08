// RPC contract constants shared by the host and client halves. Kept in one
// place so the channel name and endpoint names cannot drift apart.

export const RPC_CHANNEL = '/skill-manager';

export const ENDPOINT_HEALTH = 'health';
/** Liveness alias of {@link ENDPOINT_HEALTH} (Issue #9 acceptance surface). */
export const ENDPOINT_PING = 'ping';
/** Search skills.sh and return normalized basic results (Issue #13). */
export const ENDPOINT_SEARCH = 'search';
/** Lazily hydrate one result's description from its snapshot (Issue #13). */
export const ENDPOINT_DESCRIBE = 'describe';
