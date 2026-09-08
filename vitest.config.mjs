import { configDefaults } from 'vitest/config';

// `threads` pool runs tests on in-process worker threads rather than child
// processes, which keeps the runner deterministic and compatible with
// constrained environments. `singleThread` is fine for this small suite.
export default {
  test: {
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Exclude nested git worktrees (independent checkouts) from discovery so
    // the coordinator/main worktree only runs its own suite. Extend — do not
    // replace — Vitest's default excludes.
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
  },
};