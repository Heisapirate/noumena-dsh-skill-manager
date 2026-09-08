import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillRoot } from '../../src/path-safety';
import { createRpcHandler } from '../../src/rpc';
import { SkillManagerService } from '../../src/service';
import { cleanupRoots, FakeSkillsShClient, installSkill, snapshot, tempSkillsRoot } from './helpers';

const SLUG = 'find-skills';
const ID = `owner/repo/${SLUG}`;
const signal = () => new AbortController().signal;

const NEW_FILES = [
  { path: 'SKILL.md', contents: '---\nname: find-skills\ndescription: "Updated skill"\n---\n# Updated\n' },
  { path: 'README.md', contents: '# New readme\n' },
];

afterEach(async () => {
  await cleanupRoots();
});

function handler(root: string, client: FakeSkillsShClient) {
  const service = new SkillManagerService({
    version: '1.0.0',
    skillsRoot: root,
    client,
    now: () => 0,
  });
  return createRpcHandler(service);
}

describe('createRpcHandler checkUpdates', () => {
  it('returns the typed checkUpdates result', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));

    const result = await handler(root, client)('checkUpdates', {}, signal());

    expect(result).toEqual({
      ok: true,
      value: {
        updates: [
          expect.objectContaining({
            slug: SLUG,
            status: 'update-available',
            updateAvailable: true,
            localModified: false,
          }),
        ],
      },
    });
  });
});

describe('createRpcHandler update', () => {
  it('returns the typed update result on success', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    const result = await handler(root, client)('update', { id: ID }, signal());

    expect(result).toMatchObject({
      ok: true,
      value: {
        slug: SLUG,
        source: 'owner/repo',
        remoteSourceHash: 'opaque-v2',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    });
  });

  it('returns a typed local-modification-conflict when drift is not discarded', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# my edit\n', 'utf8');
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    const result = await handler(root, client)('update', { id: ID }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'local-modification-conflict' } });
  });

  it('returns a typed source-unavailable error when the snapshot is gone', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setError(ID, 'source-unavailable', 'not found');

    const result = await handler(root, client)('update', { id: ID }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'source-unavailable' } });
  });

  it('returns a typed invalid-request for a malformed payload', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();

    const result = await handler(root, client)('update', { nope: true }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  });

  it('never returns a raw throw for an internal failure', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    class FailingPublishRoot extends SkillRoot {
      override async publishStaged(): Promise<void> {
        throw new Error('boom');
      }
    }

    const service = new SkillManagerService({
      version: '1.0.0',
      skillsRoot: root,
      client,
      now: () => 0,
      root: new FailingPublishRoot(root),
    });

    const result = await createRpcHandler(service)('update', { id: ID }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});
