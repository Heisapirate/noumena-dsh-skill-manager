// The single host-side error→RPC normalizer. Every endpoint's thrown value is
// folded to the `{code,message,details}` shape here so no raw throw ever
// crosses the `/skill-manager` boundary. It recognizes the typed error
// surfaces — InstallError (#14), UpdateError (#16), SkillsShError (#12),
// PathSafetyError (#11), and SkillManagerError (#17 uninstall) — and folds
// everything else into `internal`.

import { SkillManagerError } from './errors';
import { InstallError } from './install';
import { PathSafetyError } from './path-safety';
import { isSkillsShError } from './skills-sh';
import { isUpdateError } from './update/errors';

/** Normalize any thrown value to the RPC `{code,message,details}` error shape. */
export function toRpcError(err: unknown): { code: string; message: string; details: object } {
  if (err instanceof InstallError) return err.toRpcError();
  if (isUpdateError(err)) return err.toRpcError();
  if (err instanceof SkillManagerError) return err.toRpcError();
  if (isSkillsShError(err)) {
    const object = err.toObject();
    return { code: object.code, message: object.message, details: object.details };
  }
  if (err instanceof PathSafetyError) return err.toRpcError();
  if (err instanceof Error) {
    return { code: 'internal', message: err.message, details: {} };
  }
  return { code: 'internal', message: 'Unknown error', details: {} };
}
