# rc.1 client static-module seed set — derivation record

Issue #9 requires the client build to externalize the **exact** browser runtime
static-module seed set from the installed `@deepseek-ai/dsh@0.1.2-rc.1`, not the
rc.6 reference list the Phase 2 spike copied.

## Where the seed set lives in rc.1

The web shell (`@deepseek-ai/dsh-web-frontend@0.1.2-rc.1`) boots the client
module system with:

```js
this.modules = i.create({
  boot: n.__DSH_BOOT__,
  staticModules: zp(),      // ← the seed map
  ...
})
```

`zp()` is defined in the same shell bundle
(`dist/assets/index-*.js`, minified) and returns exactly eight entries:

```js
function zp() {
  return {
    react: q5,
    "react/jsx-runtime": Y5,
    "react-dom": n6,
    "react-dom/client": o6,
    "@deepseek-ai/cordis": M5,
    "@deepseek-ai/dsh-client-store": M6,
    "@deepseek-ai/dsh-client-ui-slots": T6,
    "@deepseek-ai/dsh-client-ui-primitives": Fp
  };
}
```

Those eight words are `scripts/seed-modules.json`.

## Difference from the Phase 2 spike

The spike's `PLATFORM_MODULES` (taken from the rc.6 reference) listed seven
modules — the same react family + `@deepseek-ai/cordis` +
`@deepseek-ai/dsh-client-ui-slots` + `@deepseek-ai/dsh-client-ui-primitives` —
**without** `@deepseek-ai/dsh-client-store`. rc.1 adds
`@deepseek-ai/dsh-client-store`, so the production list has eight entries. This
resolves open question #1 in `docs/planning/open-questions.md`.

## Seeds (modules) are not services (injects)

`scripts/seed-modules.json` and the package's `dsh.client.inject` list are two
different contracts and are expected to differ:

- **`dsh.client.inject`** names the cordis *services* the client half declares
  (`@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-ui-settings`,
  `@deepseek-ai/dsh-client-ui-slots`). Those are injected into `apply(ctx)` as
  services — they are never `require()`d.
- **`scripts/seed-modules.json`** names the *modules* a bundle may `require()`.
  The client half accesses `connection`/`slots` as injected services, so today
  its bundle only `require()`s `react` and `react/jsx-runtime`.

The purity gate (`scripts/verify-client-purity.mjs`) fails the build if the
emitted client bundle ever `require()`s a non-seed module. It is trivially green
now (only the react family is required); it becomes meaningful as the client
grows and is the backstop against a future accidental non-seed `@deepseek-ai/*`
value import.
