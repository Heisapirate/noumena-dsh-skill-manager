// Phase 2 prototype benchmark: description hydration strategies + rate-limit observation.
import { performance } from 'node:perf_hooks';

const out = { connectivity: {}, benchmark: {}, rateLimits: [] };

function noteHeaders(tag, res) {
  const grab = (n) => res.headers.get(n);
  const h = {
    tag,
    status: res.status,
    'retry-after': grab('retry-after'),
    'x-ratelimit-limit': grab('x-ratelimit-limit'),
    'x-ratelimit-remaining': grab('x-ratelimit-remaining'),
    'x-ratelimit-reset': grab('x-ratelimit-reset'),
    'cache-control': grab('cache-control'),
    etag: grab('etag'),
  };
  out.rateLimits.push(h);
}

async function timedFetch(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const ms = Math.round(performance.now() - t0);
  return { res, ms };
}

// 1. connectivity probe
for (const host of ['https://skills.sh/api/search?q=a&limit=1', 'https://api.github.com/rate_limit', 'https://raw.githubusercontent.com/vercel-labs/skills/main/package.json', 'https://registry.npmjs.org/-/ping']) {
  try {
    const { res, ms } = await timedFetch(host);
    out.connectivity[host] = { status: res.status, ms };
  } catch (e) {
    out.connectivity[host] = { error: e.cause?.code ?? String(e) };
  }
}

// 2. search (representative query)
const q = 'react';
const limit = 5;
{
  const url = `https://skills.sh/api/search?q=${q}&limit=${limit}`;
  const { res, ms } = await timedFetch(url);
  noteHeaders('search', res);
  const body = await res.json();
  const skills = body.skills ?? [];
  out.benchmark.search = { query: q, limit, status: res.status, ms, count: skills.length, payloadBytes: JSON.stringify(body).length };
  out.benchmark.strategyA = { results: [] };
  // 3. Strategy A: bounded /api/download hydration for each visible result
  let totalBytes = 0, totalMs = 0, ok = 0;
  for (const s of skills) {
    const u = `https://skills.sh/api/download/${s.id}`;
    const { res: r2, ms: ms2 } = await timedFetch(u);
    noteHeaders('download:' + s.skillId, r2);
    const txt = await r2.text();
    totalBytes += txt.length; totalMs += ms2;
    if (r2.ok) ok++;
    out.benchmark.strategyA.results.push({ id: s.id, status: r2.status, ms: ms2, payloadBytes: txt.length });
  }
  out.benchmark.strategyA.summary = {
    requests: skills.length + 1,
    searchMs: ms,
    totalDownloadMs: totalMs,
    totalPayloadBytes: JSON.stringify(body).length + totalBytes,
    avgDownloadMs: skills.length ? Math.round(totalMs / skills.length) : 0,
    ok,
  };
  out.benchmark.strategyA.note = 'strategy B (GitHub tree + raw SKILL.md) depends on api.github.com + raw.githubusercontent.com — see connectivity probe above.';
}

console.log(JSON.stringify(out, null, 2));
