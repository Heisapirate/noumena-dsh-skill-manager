import { createHash } from 'node:crypto';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const remote = 'b146008599c31057cef1c145774cea5d5afb30e8f43fa802e47a4b461419aaaf';
const candidates = [
  'https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md',
  'https://raw.githubusercontent.com/vercel-labs/skills/main/find-skills/SKILL.md',
  'https://raw.githubusercontent.com/vercel-labs/skills/main/SKILL.md',
];
for (const u of candidates) {
  const r = await fetch(u);
  if (!r.ok) { console.log(r.status, u); continue; }
  const t = await r.text();
  console.log('OK', u, 'bytes', Buffer.byteLength(t), 'sha256', sha256(t), sha256(t) === remote ? 'MATCH' : '');
}
