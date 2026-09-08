// Probe skills.sh snapshot hash convention against a real fixture.
import { createHash } from 'node:crypto';

function sha(...parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(p, 'utf8');
  return h.digest('hex');
}

async function getDownload(id) {
  const r = await fetch(`https://skills.sh/api/download/${id}`);
  if (!r.ok) return { status: r.status };
  const d = await r.json();
  const files = (d.files ?? []).map((f) => ({ path: f.path, contents: f.contents ?? '' }));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { status: r.status, remoteHash: d.hash, files };
}

function candidates(files) {
  const contents = files.map((f) => f.contents);
  const paths = files.map((f) => f.path);
  return {
    'contents-concat': sha(...contents),
    'path+contents': sha(...files.flatMap((f) => [f.path, f.contents])),
    'path+nl+contents': sha(...files.flatMap((f) => [f.path, '\n', f.contents])),
    'path+nul+contents': sha(...files.flatMap((f) => [f.path, '\0', f.contents])),
    'contents+nl': sha(...files.flatMap((f) => [f.contents, '\n'])),
    'path+tab+contents': sha(...files.flatMap((f) => [f.path, '\t', f.contents])),
    'json-files-array': sha(JSON.stringify(files)),
    'json-files-array-pretty': sha(JSON.stringify(files, null, 2)),
    'json-object-files': sha(JSON.stringify({ files })),
    'content-hash-concat': sha(...files.map((f) => sha(f.contents))),
    'path+nl+contenthash': sha(...files.flatMap((f) => [f.path, '\n', sha(f.contents)])),
    'path+space+contenthash': sha(...files.flatMap((f) => [f.path, ' ', sha(f.contents)])),
  };
}

for (const id of ['vercel-labs/skills/find-skills', 'mattpocock/skills/grill-me']) {
  const d = await getDownload(id);
  console.log('=== ' + id + ' ===');
  if (d.status !== 200) { console.log('status', d.status); continue; }
  console.log('remoteHash', d.remoteHash, 'files', d.files.map((f) => f.path).join(', '));
  const c = candidates(d.files);
  for (const [name, h] of Object.entries(c)) {
    if (h === d.remoteHash) console.log('MATCH -> ' + name);
  }
  // also print a couple for eyeballing
  console.log('  contents-concat', c['contents-concat']);
  console.log('  path+contents  ', c['path+contents']);
}
