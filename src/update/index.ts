// Public surface of the update detection + transaction module (Issue #16).

export { UpdateError, isUpdateError } from './errors';
export type { UpdateErrorCode } from './errors';
export { readDirFiles, readSkillFiles } from './files';
export { UpdateManager } from './manager';
export type { ManifestStoreLike, UpdateManagerOptions } from './manager';
export { assertSnapshotSafe } from './snapshot';
export { buildUpdateInfo, deriveUpdateStatus, resolveStatus } from './status';
export type { StatusInput, StatusResolution, UpdateInfoInput } from './status';
export { recoverInterruptedSwap } from './swap';
