import { describe, expect, it } from 'vitest';
import { validateSearchResponse, validateSnapshotResponse } from '../src/skills-sh/validation';

const githubEntry = {
  id: 'microsoft/azure-skills/python-appservice-deploy',
  skillId: 'python-appservice-deploy',
  name: 'python-appservice-deploy',
  installs: 170535,
  source: 'microsoft/azure-skills',
};

const wellKnownEntry = {
  id: 'example.com/some-skill',
  skillId: 'some-skill',
  name: 'some-skill',
  installs: 42,
  source: 'example.com',
};

describe('validateSearchResponse', () => {
  it('normalizes a valid GitHub entry', () => {
    const result = validateSearchResponse({ skills: [githubEntry] });
    expect(result).toEqual([
      {
        id: 'microsoft/azure-skills/python-appservice-deploy',
        skillId: 'python-appservice-deploy',
        name: 'python-appservice-deploy',
        source: 'microsoft/azure-skills',
        installs: 170535,
        pageUrl: 'https://skills.sh/microsoft/azure-skills/python-appservice-deploy',
        installable: true,
        sourceKind: 'github',
      },
    ]);
  });

  it('classifies a well-known (domain) source as unavailable to install', () => {
    const result = validateSearchResponse({ skills: [wellKnownEntry] });
    expect(result[0]).toMatchObject({ installable: false, sourceKind: 'well-known' });
  });

  it('derives skillId from id when it is absent', () => {
    const { skillId: _omit, ...entry } = githubEntry;
    const result = validateSearchResponse({ skills: [entry] });
    expect(result[0].skillId).toBe('python-appservice-deploy');
  });

  it('preserves an empty skills array as empty results', () => {
    expect(validateSearchResponse({ skills: [] })).toEqual([]);
  });

  it.each([
    ['skills is not an array', { skills: 'nope' }],
    ['body is not an object', null],
    ['body is an array', []],
    ['missing id', { skills: [{ ...githubEntry, id: undefined }] }],
    ['non-string id', { skills: [{ ...githubEntry, id: 42 }] }],
    ['missing source', { skills: [{ ...githubEntry, source: undefined }] }],
    ['non-string name', { skills: [{ ...githubEntry, name: 42 }] }],
    ['non-number installs', { skills: [{ ...githubEntry, installs: '170535' }] }],
    ['non-object entry', { skills: ['x'] }],
  ])('rejects a malformed payload (%s) with malformed-response', (_label, body) => {
    expect(() => validateSearchResponse(body)).toThrowError(
      expect.objectContaining({ code: 'malformed-response' }),
    );
  });
});

const snapshotBody = {
  files: [
    { path: 'SKILL.md', contents: '---\nname: foo\ndescription: "the description"\n---\n# Body' },
    { path: 'references/a.md', contents: '# A' },
  ],
  hash: '551771d631c3ab218c0389fd696e10a8cd6bfaa06cf3182fdac252cd4909f07a',
};

describe('validateSnapshotResponse', () => {
  it('normalizes a valid snapshot and preserves the opaque hash verbatim', () => {
    const result = validateSnapshotResponse('owner/repo/foo', snapshotBody);
    expect(result).toEqual({
      id: 'owner/repo/foo',
      remoteSourceHash: '551771d631c3ab218c0389fd696e10a8cd6bfaa06cf3182fdac252cd4909f07a',
      files: [
        { path: 'SKILL.md', contents: '---\nname: foo\ndescription: "the description"\n---\n# Body' },
        { path: 'references/a.md', contents: '# A' },
      ],
      metadata: { name: 'foo', description: 'the description' },
    });
  });

  it('returns empty metadata when the snapshot has no SKILL.md', () => {
    const body = { files: [{ path: 'a.md', contents: '# A' }], hash: 'abc' };
    expect(validateSnapshotResponse('owner/repo/foo', body).metadata).toEqual({});
  });

  it('allows an empty file contents but requires a non-empty path', () => {
    const body = { files: [{ path: 'empty.md', contents: '' }], hash: 'abc' };
    expect(validateSnapshotResponse('owner/repo/foo', body).files[0]).toEqual({
      path: 'empty.md',
      contents: '',
    });
  });

  it.each([
    ['files not an array', { files: {}, hash: 'abc' }],
    ['missing hash', { files: [] }],
    ['empty hash', { files: [], hash: '' }],
    ['non-object file', { files: ['x'], hash: 'abc' }],
    ['file missing path', { files: [{ contents: '# A' }], hash: 'abc' }],
    ['file non-string contents', { files: [{ path: 'a.md', contents: 42 }], hash: 'abc' }],
    ['body is not an object', null],
  ])('rejects an invalid snapshot payload (%s) with malformed-response', (_label, body) => {
    expect(() => validateSnapshotResponse('owner/repo/foo', body)).toThrowError(
      expect.objectContaining({ code: 'malformed-response' }),
    );
  });
});
