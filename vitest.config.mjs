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
  },
};