// Single source of truth for mapping every host error code to concise,
// non-leaking user copy plus a safe action hint (Issue #18). The React renderers
// depend on this mapping rather than re-implementing it, so the whole UI shares
// one error-code → copy/action universe.

import { describe, expect, it } from 'vitest';
import { presentError, presentThrown } from '../src/client/copy';
import { SkillManagerRpcError } from '../src/client/rpc';

describe('presentError — retryable network/search failures', () => {
  it.each(['network-unavailable', 'timeout', 'rate-limited', 'registry-unavailable', 'http-error', 'malformed-response'])(
    'maps %s to a retryable message',
    (code) => {
      const presentation = presentError(code);
      expect(presentation.action).toBe('retry');
      expect(presentation.message).not.toContain('{');
      expect(presentation.message.length).toBeGreaterThan(0);
    },
  );

  it('distinguishes a rate limit from a plain registry failure', () => {
    expect(presentError('rate-limited').message).toMatch(/rate/i);
    expect(presentError('registry-unavailable').message).not.toMatch(/rate/i);
  });
});

describe('presentError — scoped action failures', () => {
  it('treats duplicate-install and local-modification-conflict as confirm gating', () => {
    expect(presentError('duplicate-install').action).toBe('confirm');
    expect(presentError('local-modification-conflict').action).toBe('confirm');
    expect(presentError('confirmation-required').action).toBe('confirm');
  });

  it('never requires confirmation for non-destructive failures', () => {
    expect(presentError('network-unavailable').action).not.toBe('confirm');
    expect(presentError('skill-not-found').action).not.toBe('confirm');
    expect(presentError('source-unavailable').action).not.toBe('confirm');
  });

  it('maps a partial failure to a retryable, non-alarming message', () => {
    for (const code of ['install-partial-failure', 'update-partial-failure', 'uninstall-partial-failure']) {
      const presentation = presentError(code);
      expect(presentation.action).toBe('retry');
      expect(presentation.message.toLowerCase()).not.toMatch(/stack|trace|exception|errno/);
    }
  });
});

describe('presentError — security / non-leaking copy', () => {
  it.each([
    'unsafe-path',
    'traversal',
    'absolute-path',
    'drive-letter-path',
    'invalid-relative-path',
    'symlink-escape',
  ])('maps %s without exposing a path', (code) => {
    const presentation = presentError(code);
    expect(presentation.message).not.toMatch(/[a-zA-Z]:\\|\.\.\/|\\\.\.|\/etc\/|C:\\/);
  });

  it('folds unknown/internal codes into a generic retry message', () => {
    expect(presentError('internal')).toEqual({ message: 'Something went wrong. Please retry.', action: 'retry' });
    expect(presentError('some-future-code')).toEqual({ message: 'Something went wrong. Please retry.', action: 'retry' });
    expect(presentError(undefined)).toEqual({ message: 'Something went wrong. Please retry.', action: 'retry' });
  });
});

describe('presentThrown', () => {
  it('extracts the code from a SkillManagerRpcError', () => {
    const presentation = presentThrown(new SkillManagerRpcError('network-unavailable', 'raw host message'));
    expect(presentation.action).toBe('retry');
    expect(presentation.message).not.toContain('raw host message');
  });

  it('falls back to a generic message for a plain Error', () => {
    expect(presentThrown(new Error('boom'))).toEqual({ message: 'Something went wrong. Please retry.', action: 'retry' });
  });

  it('falls back to a generic message for a non-Error thrown value', () => {
    expect(presentThrown('nope')).toEqual({ message: 'Something went wrong. Please retry.', action: 'retry' });
  });
});
