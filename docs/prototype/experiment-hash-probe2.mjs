import { createHash } from 'node:crypto';

function sha1(...parts) { const h = createHash('sha1'); for (const p of parts) h.update(p); return h.digest('hex'); }
function sha256(...parts) { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest('hex'); }

const r = await fetch('https://skills.sh/api/download/vercel-labs/skills/find-skills');
const d = await r.json();
const remote = d.hash;
const f = d.files[0];
const contents = f.contents;
const bytes = Buffer.from(contents, 'utf8');

console.log('remote   ', remote);
console.log('file path', f.path);
console.log('char len ', contents.length, 'byte len', bytes.length);
console.log('ends LF  ', contents.endsWith('\n'), 'ends CRLF', contents.endsWith('\r\n'));
console.log('has CRLF ', contents.includes('\r\n'));
console.log('has CR   ', /[^\n]\r[^\n]/.test(contents) || contents.endsWith('\r'));

const tests = {
  'sha256(contents)': sha256(contents),
  'git-blob-sha1(byte)': sha1('blob ' + bytes.length + '\0', contents),
  'git-blob-sha1(char)': sha1('blob ' + contents.length + '\0', contents),
  'git-blob-sha256(byte)': sha256('blob ' + bytes.length + '\0', contents),
  'git-blob-sha256(char)': sha256('blob ' + contents.length + '\0', contents),
  'sha256(trimEnd)': sha256(contents.replace(/\s+$/, '')),
  'sha256(strip trailing nl)': sha256(contents.replace(/\n$/, '').replace(/\r$/, '')),
  'sha256(normalize CRLF->LF)': sha256(contents.replace(/\r\n/g, '\n')),
  'sha256(normalize LF->CRLF)': sha256(contents.replace(/\r?\n/g, '\r\n')),
  'sha256(path+NL+contents)': sha256(f.path + '\n', contents),
  'sha256(contents+NL)': sha256(contents, '\n'),
  'sha256(contents+NL+path)': sha256(contents, '\n', f.path),
  'sha256(JSON files)': sha256(JSON.stringify(d.files)),
  'sha256(JSON {files})': sha256(JSON.stringify({ files: d.files })),
  'sha256(path+space+contents)': sha256(f.path + ' ', contents),
};

for (const [k, v] of Object.entries(tests)) {
  console.log((v === remote ? 'MATCH ' : '      ') + k + ' = ' + v);
}
