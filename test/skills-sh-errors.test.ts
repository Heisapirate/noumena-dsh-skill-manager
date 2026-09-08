import { describe, expect, it } from 'vitest';
import { isSkillsShError, parseRetryAfter, SkillsShError } from '../src/skills-sh/errors';

describe('SkillsShError', () => {
  it('carries its code, message, and optional normalized fields', () => {
    const err = new SkillsShError('rate-limited', 'rate limit exceeded', {
      statusCode: 429,
      retryAfterSeconds: 30,
      details: { endpoint: '/api/search' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SkillsShError');
    expect(err.code).toBe('rate-limited');
    expect(err.message).toBe('rate limit exceeded');
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.details).toEqual({ endpoint: '/api/search' });
  });

  it('serializes to a plain object without Error internals', () => {
    const err = new SkillsShError('http-error', 'HTTP 401', { statusCode: 401 });
    expect(err.toObject()).toEqual({
      code: 'http-error',
      message: 'HTTP 401',
      details: { statusCode: 401 },
    });
  });

  it('serializes retryAfterSeconds into details when present', () => {
    const err = new SkillsShError('rate-limited', 'slow down', { retryAfterSeconds: 5 });
    expect(err.toObject().details).toEqual({ retryAfterSeconds: 5 });
  });

  it('is recognized by the type guard and distinguishes unrelated errors', () => {
    expect(isSkillsShError(new SkillsShError('timeout', 'timed out'))).toBe(true);
    expect(isSkillsShError(new Error('nope'))).toBe(false);
    expect(isSkillsShError(null)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('  120  ')).toBe(120);
  });

  it('returns undefined for absent or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
    expect(parseRetryAfter('later')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
  });

  it('parses an HTTP-date into whole seconds, clamped to >= 0', () => {
    const nowMs = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01T00:00:00Z
    // Exactly 65s in the future -> ceil to 65.
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:01:05 GMT', nowMs)).toBe(65);
    // Sub-second in the future -> ceil to 1.
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:00 GMT', nowMs + 400)).toBe(0);
    // Already in the past -> clamp to 0.
    expect(parseRetryAfter('Tue, 31 Dec 2024 23:59:59 GMT', nowMs)).toBe(0);
  });
});
