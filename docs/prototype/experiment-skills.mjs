// Phase 2 prototype experiment: skills.sh search + download + snapshot hash + description.
// Deterministic snapshot hash per ADR/architecture doc:
//   SHA-256 over files sorted lexicographically by path,
//   digest updated with each file's path followed by its contents.
import { createHash } from 'node:crypto';

function snapshotHash(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  for (const f of sorted) {
    h.update(f.path, 'utf8');
    h.update(f.contents, 'utf8');
  }
  return h.digest('hex');
}

function extractDescription(skillMd) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skillMd ?? '');
  if (!m) return null;
  const dm = /^description:\s*["']?([^"'\n][^"\n]*)/m.exec(m[1]);
  return dm ? dm[1].trim() : null;
}

const results = {};

async function main() {
  // Search
  try {
    const r = await fetch('https://skills.sh/api/search?q=react&limit=3');
    results.search = { status: r.status, body: await r.json() };
  } catch (e) {
    results.search = { error: String(e) };
  }

  // Download (GitHub-backed skill)
  try {
    const r = await fetch('https://skills.sh/api/download/vercel-labs/skills/find-skills');
    results.download = { status: r.status };
    if (r.ok) {
      const dl = await r.json();
      const files = dl.files ?? [];
      const skillMd = files.find((f) => String(f.path).endsWith('SKILL.md'));
      results.download = {
        status: r.status,
        remoteHash: dl.hash,
        fileCount: files.length,
        files: files.map((f) => ({ path: f.path, bytes: (f.contents ?? '').length })),
        recomputedHash: snapshotHash(files),
        hashMatches: snapshotHash(files) === dl.hash,
        description: skillMd ? extractDescription(skillMd.contents) : null,
      };
    } else {
      results.download.body = await r.text();
    }
  } catch (e) {
    results.download = { error: String(e) };
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
