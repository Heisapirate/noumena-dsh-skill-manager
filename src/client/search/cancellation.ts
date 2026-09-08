// Shared cancellation predicate: classifies an Error as an abort (an
// `AbortError` DOMException, or the SkillsShClient `cancelled` code) so stale or
// aborted work is never surfaced as a user-facing failure. Shared by the search
// engine and the description hydrator, which both orchestrate abortable work.

export function isCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: unknown }).code === 'cancelled')
  );
}
