# Website upload budget

The Website budget runs in `apps/infra/test/website-build.test.ts`:

```sh
VITEST_MAX_WORKERS=4 pnpm --filter @rat-stack/infra exec vitest run test/website-build.test.ts
```

The full gate also runs it:

```sh
VITEST_MAX_WORKERS=4 pnpm turbo run check test build --concurrency=4
```

The test calls Alchemy's `runViteBuildChild`, the same build path used by the Website source provider. It measures `serverBundle.files`, not the intermediate Vite output. The first file is the upload entry. The total counts every `.js` module, including dynamically imported chunks. Source maps and client assets are excluded.

The shrink-only baselines are **1,566,139 entry bytes** and **14,742,838 total JavaScript bytes**. Both come from the production Alchemy build at `2cdcd50`, after generating content with the build outputs present. The unmodified build passes at those exact values. Lower each budget when its measured size falls. Do not raise one to accept growth.

The test writes its measurements to `apps/web/dist/website-upload-metrics.json`. It also checks that the entry is nonempty. The existing workerd proof still runs after the budgets pass.

These are uncompressed upload-size budgets, not Cloudflare limits or a startup CPU measurement. The current total is large: the reader-page source chunk alone measures 10,343,775 bytes. This fence preserves today's ceiling; it does not make that payload small.

A first build from an empty `dist` measured 14,742,646 JavaScript bytes. A repeated clean-base build measured 14,742,838. Content generation links the `apps/web/dist/server/foldkit.build.json` path on the Web system page only when that file exists. That adds 192 bytes to the reader data chunk. The budget uses the measured repeated-build baseline, with no extra allowance.

## Preview proof

From the deployment host, deploy the reviewed commit to a preview with its existing profile. Record the uploaded Website module sizes and startup CPU from Cloudflare. Compare module bytes with the local metrics file. Check both a prerendered page and an unknown path. The page must include its HTML and preview commit; the unknown path must return 404. Check `/rpc` through the private backend binding.

No cloud credentials, Stack import, plan, or deployment are needed for the local test. The local workerd proof establishes that the bundle runs; it does not establish deployed latency, provider startup CPU, or production health.
