// Build recipe for the dsh-skill-manager plugin. Two outputs from one tsdown
// run (reproducing the DSH `clientBundle` preset):
//   - host half:  ESM node library at lib/index.js (`@deepseek-ai/*` external)
//   - client half: CJS browser closure at lib/client.js that calls
//     `window.__ModuleLoader__.load({ id, factory })` and resolves the platform
//     modules from the loader module table.
//
// `fixedExtension: false` is required so the host emits `lib/index.js` rather
// than `.mjs` (the package `main`/`exports` pointer would otherwise break).
//
// The client `external` list is the EXACT rc.1 browser runtime static-module
// seed set, derived from the installed @deepseek-ai/dsh@0.1.2-rc.1
// `dsh-web-frontend` `staticModules` map (see scripts/seed-modules.md for the
// derivation). The list lives in scripts/seed-modules.json so the build config
// and the purity gate share one source of truth. A bundle may only `require()`
// those words; everything else is inlined via `deps.neverBundle`.
//
// Note: these seed *modules* are distinct from the package's `dsh.client.inject`
// *services* — the inject list declares cordis services, the seed list declares
// require-able modules (see scripts/seed-modules.md).

import { readFileSync } from 'node:fs';

const { seedModules: SEED_MODULES } = JSON.parse(
  readFileSync(new URL('./scripts/seed-modules.json', import.meta.url), 'utf8'),
);

const id = 'dsh-skill-manager';

export default [
  {
    name: id,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      // `@deepseek-ai/*` packages stay external (resolved by the DSH host
      // runtime) except `@deepseek-ai/dsh-atomic-write`, a runtime dependency of
      // this plugin that is force-bundled so the prebuilt host bundle has no
      // dependency on node_modules. The two options act at different stages: the
      // negative-lookahead `neverBundle` stops the top-level `external` list
      // from matching it, and `alwaysBundle` overrides tsdown's automatic
      // externalization of production dependencies.
      neverBundle: [/@deepseek-ai\/(?!dsh-atomic-write(?:$|\/))/],
      alwaysBundle: ['@deepseek-ai/dsh-atomic-write'],
    },
  },
  {
    name: `${id}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: { neverBundle: [...SEED_MODULES] },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
];
