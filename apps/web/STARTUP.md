# Website upload size

The Alchemy/workerd integration test measures the actual `serverBundle.files`, not Vite's intermediate entry:

```sh
VITEST_MAX_WORKERS=4 pnpm --filter @rat-stack/infra exec vitest run test/website-build.test.ts
```

The test logs entry, non-content, content and total JavaScript bytes, and the total's share of Cloudflare's 64 MiB uncompressed Worker limit. Size never fails it; past half of that limit it warns. Until 2026-11-14 a desk-set shrink-only ceiling on entry and non-content bytes failed the build. It was removed with the Worker ceilings; `apps/site/STARTUP.md` says why.

Content is classified, not capped. Every JavaScript module with the stable `_virtual_reader-page-sources` chunk prefix is reader data; its generated hash does not affect classification. The test requires a content chunk and excludes the entry from that set. It logs content bytes and total JavaScript bytes without a growth ceiling. New lore and system pages must not fail a code-size budget.

Measurements go to `apps/web/dist/website-upload-metrics.json`. The repeated clean build measured 10,343,775 content bytes and 14,742,838 total JavaScript bytes. A cold build had 192 fewer content bytes because a generated manifest path became a link on the next generation. Neither content variation blocks the gate. Source maps and client assets are excluded.

The full `pnpm turbo run check test build` gate includes this test. These checks measure uncompressed bytes, not startup CPU or Cloudflare limits. On preview, compare uploaded modules with the metrics file, record provider startup CPU, and check prerendered HTML, preview commit, unknown-path 404 and `/rpc`. Local workerd proof does not establish deployed latency or production health.
