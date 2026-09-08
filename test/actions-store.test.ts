// The mutation action store (Issue #18): pending/success/error lifecycle per
// action, double-submit prevention, per-row isolation, and the refresh-on-success
// hook. Framework-agnostic so it is unit-testable without a DOM.

import { describe, expect, it, vi } from 'vitest';
import { createActionStore } from '../src/client/actions/store';
import type { ActionStoreOptions } from '../src/client/actions/store';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStore(overrides: Partial<ActionStoreOptions> = {}) {
  const install = overrides.install ?? vi.fn(async () => undefined);
  const update = overrides.update ?? vi.fn(async () => undefined);
  const uninstall = overrides.uninstall ?? vi.fn(async () => undefined);
  const onSuccess = overrides.onSuccess ?? vi.fn();
  const store = createActionStore({ install, update, uninstall, onSuccess });
  return { store, install, update, uninstall, onSuccess };
}

describe('action store — lifecycle', () => {
  it('transitions pending → success and reports a scoped message', async () => {
    const gate = deferred<void>();
    const install = vi.fn(() => gate.promise);
    const { store, onSuccess } = makeStore({ install });

    store.runInstall('owner/repo/slug');
    expect(store.stateFor('install', 'owner/repo/slug')).toMatchObject({ status: 'pending' });

    gate.resolve();
    await flush();
    expect(store.stateFor('install', 'owner/repo/slug')).toEqual({
      status: 'success',
      message: 'Installed',
      error: null,
    });
    expect(install).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('install');
  });

  it('transitions pending → error with non-leaking copy', async () => {
    const gate = deferred<void>();
    const { store } = makeStore({
      install: () =>
        gate.promise.then(() => {
          throw Object.assign(new Error('raw host detail'), { code: 'network-unavailable' });
        }),
    });
    store.runInstall('owner/repo/slug');
    gate.resolve();
    await flush();
    const state = store.stateFor('install', 'owner/repo/slug');
    expect(state.status).toBe('error');
    expect(state.error?.action).toBe('retry');
    expect(state.error?.message).not.toContain('raw host detail');
  });

  it('fires onSuccess only after a mutation succeeds', async () => {
    const { store, onSuccess } = makeStore({
      install: () => Promise.reject(Object.assign(new Error('x'), { code: 'source-unavailable' })),
    });
    store.runInstall('owner/repo/slug');
    await flush();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(store.stateFor('install', 'owner/repo/slug').status).toBe('error');
  });
});

describe('action store — double-submit prevention', () => {
  it('ignores a second run while the first is pending', async () => {
    const gate = deferred<void>();
    const install = vi.fn(() => gate.promise);
    const { store } = makeStore({ install });

    store.runInstall('owner/repo/slug');
    store.runInstall('owner/repo/slug'); // ignored while pending
    expect(install).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flush();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh run after the previous one settles', async () => {
    const gate = deferred<void>();
    const install = vi.fn(() => gate.promise);
    const { store } = makeStore({ install });

    store.runInstall('owner/repo/slug');
    gate.resolve();
    await flush();

    store.runInstall('owner/repo/slug');
    expect(install).toHaveBeenCalledTimes(2);
  });
});

describe('action store — per-row isolation', () => {
  it('keeps one row failing from affecting another row', async () => {
    const gateA = deferred<void>();
    const { store } = makeStore({
      install: (id) => (id === 'a' ? gateA.promise : Promise.resolve()),
    });

    store.runInstall('a');
    store.runInstall('b');
    gateA.reject(Object.assign(new Error('boom'), { code: 'malformed-snapshot' }));
    await flush();

    expect(store.stateFor('install', 'a').status).toBe('error');
    expect(store.stateFor('install', 'b')).toEqual({ status: 'success', message: 'Installed', error: null });
  });
});

describe('action store — confirmation flags forwarded', () => {
  it('forwards overwrite/discard/confirm flags to the RPC layer', async () => {
    const { store, install, update, uninstall } = makeStore();

    store.runInstall('owner/repo/slug', true);
    store.runUpdate('owner/repo/slug', true);
    store.runUninstall('slug', { confirm: true, discardLocalChanges: true });
    await flush();

    expect(install).toHaveBeenCalledWith('owner/repo/slug', true);
    expect(update).toHaveBeenCalledWith('owner/repo/slug', true);
    expect(uninstall).toHaveBeenCalledWith('slug', { confirm: true, discardLocalChanges: true });
  });

  it('defaults to non-destructive flags when omitted', async () => {
    const { store, install, update, uninstall } = makeStore();
    store.runInstall('owner/repo/slug');
    store.runUpdate('owner/repo/slug');
    store.runUninstall('slug');
    await flush();

    expect(install).toHaveBeenCalledWith('owner/repo/slug', false);
    expect(update).toHaveBeenCalledWith('owner/repo/slug', false);
    expect(uninstall).toHaveBeenCalledWith('slug', { confirm: false, discardLocalChanges: false });
  });
});

describe('action store — notifications', () => {
  it('notifies subscribers on every state change and can unsubscribe', async () => {
    const gate = deferred<void>();
    const { store } = makeStore({ install: () => gate.promise });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.runInstall('owner/repo/slug');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    gate.resolve();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1); // no further notifications
  });

  it('ignores runs after dispose', () => {
    const { store, install } = makeStore();
    store.dispose();
    store.runInstall('owner/repo/slug');
    expect(install).not.toHaveBeenCalled();
  });
});
