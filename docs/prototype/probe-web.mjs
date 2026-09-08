// Probe the running dsh web server (prototype) for plugin artifacts.
const base = 'http://127.0.0.1:4123';
const token = 'UkX9mXH1tlil9wWlArR6EOKAyVp8Lu6jI3b04TXSHIA';
const urls = [
  base + '/',
  base + '/?token=' + token,
  base + '/plugins/dsh-skill-manager/client.js',
  base + '/plugins/dsh-skill-manager/client.js?token=' + token,
  base + '/plugins/@deepseek-ai/dsh-client-ui-settings/client.js',
];
for (const url of urls) {
  try {
    const r = await fetch(url);
    const t = await r.text();
    console.log(r.status, r.headers.get('content-type'), url, 'bytes=' + t.length, JSON.stringify(t.slice(0, 120).replace(/\s+/g, ' ')));
  } catch (e) {
    console.log('ERR', url, e.cause?.code ?? String(e));
  }
}
