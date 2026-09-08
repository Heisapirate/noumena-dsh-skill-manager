import { describe, expect, it } from 'vitest';
import { localContentHash } from '../../src/manifest/hash';

describe('localContentHash', () => {
  it('is deterministic regardless of input order', () => {
    const a = [
      { path: 'b.txt', contents: '2' },
      { path: 'a.txt', contents: '1' },
    ];
    const b = [
      { path: 'a.txt', contents: '1' },
      { path: 'b.txt', contents: '2' },
    ];
    expect(localContentHash(a)).toBe(localContentHash(b));
  });

  it('matches a golden digest for a single file (path then contents, no separator)', () => {
    expect(localContentHash([{ path: 'a.txt', contents: 'hello' }])).toBe(
      '59cf4ed07faff74096d2be40c3acbdea62c357484b265c8a6d922e2b0ca48602',
    );
  });

  it('matches a golden digest for two files sorted by path', () => {
    expect(
      localContentHash([
        { path: 'b.txt', contents: '2' },
        { path: 'a.txt', contents: '1' },
      ]),
    ).toBe('bfa5737dfaac95f3883fe7393a6309027f6a11201d97b7f6ca1582aec7817ee2');
  });

  it('sorts by UTF-8 byte order, not UTF-16 code-unit order', () => {
    // '\uE000' encodes to three UTF-8 bytes (0xEE…); '😀' to four (0xF0…). Byte
    // order therefore puts '\uE000' first, whereas UTF-16 code-unit order would
    // put '😀' first (0xD83D < 0xE000).
    expect(
      localContentHash([
        { path: '😀', contents: 'x' },
        { path: '\uE000', contents: 'x' },
      ]),
    ).toBe('4f7e72faf1bd06ed6fc0b8705dd56ab884f074160871906ec5bacf626097e996');
  });

  it('changes when a file path changes', () => {
    const before = localContentHash([{ path: 'a.txt', contents: 'same' }]);
    const after = localContentHash([{ path: 'b.txt', contents: 'same' }]);
    expect(after).not.toBe(before);
  });

  it('changes on a one-byte content edit', () => {
    const before = localContentHash([{ path: 'a.txt', contents: 'hello' }]);
    const after = localContentHash([{ path: 'a.txt', contents: 'hellp' }]);
    expect(after).not.toBe(before);
  });

  it('returns the empty SHA-256 digest for no files', () => {
    expect(localContentHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns a 64-character lowercase hex digest', () => {
    const digest = localContentHash([{ path: 'a.txt', contents: 'hello' }]);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
