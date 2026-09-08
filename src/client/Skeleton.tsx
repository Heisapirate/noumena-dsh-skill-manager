// Shared shimmer skeleton (spec §13 "Loading uses skeleton rows"). Both the
// search and managed-skills sections render these bars, so the loading look is
// defined once rather than duplicated per section.

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
export function SkeletonStyle() {
  return <style>{SHIMMER_CSS}</style>;
}

/** One shimmer bar; `minWidth` overrides the class default, `label` adds an accessible name. */
export function SkeletonBar({ minWidth, label }: { minWidth?: string; label?: string }) {
  const a11y = label ? { 'aria-label': label, role: 'status' as const } : {};
  return <span className="dsh-sm-skeleton" style={minWidth ? { minWidth } : undefined} {...a11y} />;
}
