// Simplified reproduction of the DSH `clientBundle` preset (see the reference
// example AKS1st/dsh-skill-manager's tsdown.client.ts). Two outputs:
//   - host half:  ESM node library at lib/index.js (@deepseek-ai/* external)
//   - client half: CJS browser closure at lib/client.js that calls
//     window.__ModuleLoader__.load({ id, factory }) and resolves the platform
//     modules from the loader module table.
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
];
const CLIENT_EXTERNALS = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client'];
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
    external: [/@deepseek-ai\//],
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
    external: [...CLIENT_EXTERNALS],
    noExternal: (spec) => (CLIENT_EXTERNALS.includes(spec) ? undefined : true),
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
