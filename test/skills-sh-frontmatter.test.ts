import { describe, expect, it } from 'vitest';
import { extractFrontmatterMetadata } from '../src/skills-sh/frontmatter';

const valid = [
  '---',
  'name: python-appservice-deploy',
  'description: "Deploy Python to Azure App Service"',
  'license: MIT',
  '---',
  '',
  '# Body',
].join('\n');

describe('extractFrontmatterMetadata', () => {
  it('extracts top-level name and double-quoted description', () => {
    expect(extractFrontmatterMetadata(valid)).toEqual({
      name: 'python-appservice-deploy',
      description: 'Deploy Python to Azure App Service',
    });
  });

  it('extracts a single-quoted description', () => {
    const md = "---\nname: foo\ndescription: 'say ''hi'''\n---\n";
    expect(extractFrontmatterMetadata(md)).toEqual({
      name: 'foo',
      description: "say 'hi'",
    });
  });

  it('extracts a plain unquoted description', () => {
    const md = '---\nname: foo\ndescription: just some text\n---\n';
    expect(extractFrontmatterMetadata(md).description).toBe('just some text');
  });

  it('preserves a colon inside a quoted description', () => {
    const md = '---\ndescription: "Use: only for X"\n---\n';
    expect(extractFrontmatterMetadata(md).description).toBe('Use: only for X');
  });

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: foo\r\ndescription: bar\r\n---\r\n';
    expect(extractFrontmatterMetadata(md)).toEqual({ name: 'foo', description: 'bar' });
  });

  it('ignores nested metadata: block keys (indented)', () => {
    const md = [
      '---',
      'name: foo',
      'description: bar',
      'metadata:',
      '  author: Someone',
      '  version: "1.0.0"',
      '---',
    ].join('\n');
    expect(extractFrontmatterMetadata(md)).toEqual({ name: 'foo', description: 'bar' });
  });

  it('returns only name when description is absent', () => {
    const md = '---\nname: foo\n---\n';
    expect(extractFrontmatterMetadata(md)).toEqual({ name: 'foo' });
  });

  it('returns empty metadata when frontmatter is absent', () => {
    expect(extractFrontmatterMetadata('# no frontmatter\n')).toEqual({});
  });

  it('returns empty metadata when the closing delimiter is missing', () => {
    expect(extractFrontmatterMetadata('---\nname: foo\ndescription: bar\n')).toEqual({});
  });

  it('returns empty metadata when the opening delimiter is not on the first line', () => {
    expect(extractFrontmatterMetadata('\n---\nname: foo\n---\n')).toEqual({});
  });
});
