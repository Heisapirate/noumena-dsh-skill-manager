// RPC contract constants shared by the host and client halves. Kept in one
// place so the channel name and endpoint names cannot drift apart.

export const RPC_CHANNEL = '/skill-manager';

export const ENDPOINT_HEALTH = 'health';
/** Liveness alias of {@link ENDPOINT_HEALTH} (Issue #9 acceptance surface). */
export const ENDPOINT_PING = 'ping';
/** Update detection endpoint (Issue #16). */
export const ENDPOINT_CHECK_UPDATES = 'checkUpdates';
/** Update transaction endpoint (Issue #16). */
export const ENDPOINT_UPDATE = 'update';
