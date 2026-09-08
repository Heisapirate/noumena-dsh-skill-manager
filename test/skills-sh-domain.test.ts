import { describe, expect, it } from 'vitest';
import { classifySource, slugFromId, splitDownloadId, toPageUrl } from '../src/skills-sh/domain';

describe('classifySource', () => {
  it.each([
    ['microsoft/azure-skills', 'github'],
    ['github/awesome-copilot', 'github'],
    ['vercel-labs/skills', 'github'],
    ['owner/repo.with.dot', 'github'],
  ])('classifies GitHub owner/repo %s as github', (source, kind) => {
    expect(classifySource(source)).toBe(kind);
  });

  it.each([
    ['example.com', 'well-known'],
    ['example.com/path', 'well-known'],
    ['https://example.com/foo', 'well-known'],
    ['owner/repo/sub', 'well-known'],
    ['owner', 'well-known'],
    ['owner/', 'well-known'],
    ['/repo', 'well-known'],
    ['', 'well-known'],
    ['   ', 'well-known'],
  ])('classifies non-GitHub source %j as well-known', (source) => {
    expect(classifySource(source)).toBe('well-known');
  });

  it('treats a non-string source as well-known', () => {
    expect(classifySource(42)).toBe('well-known');
    expect(classifySource(null)).toBe('well-known');
  });
});

describe('slugFromId', () => {
  it('returns the final path segment of an owner/repo/slug id', () => {
    expect(slugFromId('microsoft/azure-skills/python-appservice-deploy')).toBe('python-appservice-deploy');
  });

  it('returns the id unchanged when it has no slash', () => {
    expect(slugFromId('python-appservice-deploy')).toBe('python-appservice-deploy');
  });
});

describe('toPageUrl', () => {
  it('builds the skills.sh page link from an id', () => {
    expect(toPageUrl('microsoft/azure-skills/python-appservice-deploy')).toBe(
      'https://skills.sh/microsoft/azure-skills/python-appservice-deploy',
    );
  });
});

describe('splitDownloadId', () => {
  it('splits a valid owner/repo/slug id', () => {
    expect(splitDownloadId('microsoft/azure-skills/python-appservice-deploy')).toEqual({
      owner: 'microsoft',
      repo: 'azure-skills',
      slug: 'python-appservice-deploy',
    });
  });

  it.each([
    ['single', null],
    ['owner/repo', null],
    ['owner/repo/slug/extra', null],
    ['', null],
    ['owner//slug', null],
    ['/repo/slug', null],
    ['owner/repo/', null],
  ])('rejects malformed id %j', (id, expected) => {
    expect(splitDownloadId(id)).toBe(expected);
  });
});
