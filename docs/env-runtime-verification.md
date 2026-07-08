# Environment Variable Runtime Verification

**Date:** 2026-07-08  
**Astro version:** 7.0.6  
**Adapter:** `@astrojs/node` v11.0.2 in `standalone` mode  
**Build command:** `astro build`  
**Runtime command:** `node ./dist/server/entry.mjs`

## Test setup

A temporary endpoint `src/pages/api/env-test.ts` was created. It returned:

```ts
{
  importMetaEnv: import.meta.env.TEST_RUNTIME_VAR ?? null,
  processEnv:    process.env.TEST_RUNTIME_VAR    ?? null,
  mode:          import.meta.env.MODE,
  prod:          import.meta.env.PROD,
}
```

The variable `TEST_RUNTIME_VAR` was **not** present in any `.env` file at build time. It was injected at runtime via the shell:

```bash
TEST_RUNTIME_VAR=hello-from-runtime node ./dist/server/entry.mjs
```

## Result

```json
{
  "importMetaEnv": null,
  "processEnv": "hello-from-runtime",
  "mode": "production",
  "prod": true
}
```

## Conclusion

For server-only secrets in an Astro 7 + `@astrojs/node` standalone production build, **`import.meta.env` does NOT reflect runtime environment variables that were not present at build time**. Only **`process.env`** reads the runtime value.

## Implementation consequence

All server-side env access in this project resolves from `process.env` first and falls back to `import.meta.env`:

```ts
// src/lib/env.ts
function read(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;

  const fromImport = import.meta.env[name];
  if (fromImport !== undefined && fromImport !== '') return fromImport as string;

  return undefined;
}
```

This guarantees that credentials can be swapped by restarting the Node process without rebuilding the application.

## Recommendation

Always verify env behavior on the actual target platform (local dev, production build, standalone Node, deploy host). Do not assume `import.meta.env` is runtime-safe for all Astro versions or adapters.

## Test artifact

The temporary `src/pages/api/env-test.ts` endpoint was removed after verification.
