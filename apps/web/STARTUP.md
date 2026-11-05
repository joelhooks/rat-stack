# Website upload budgets

The Alchemy/workerd integration test measures the actual `serverBundle.files`, not Vite's intermediate entry:

```sh
VITEST_MAX_WORKERS=4 pnpm --filter @rat-stack/infra exec vitest run test/website-build.test.ts
```

Two shrink-only ceilings **block** code growth: **1,076,000 entry bytes** and **2,869,000 non-content JavaScript bytes**. Lower them when code shrinks; never raise them to accept growth.

The reader redesign grew the unminified entry from 1,566,139 to 1,609,697 bytes (+43,558), past the old 1,600,000 ceiling. Whitespace-only minification (`serverWhitespaceOnly` in `apps/web/vite.config.ts`: no mangling, no compression) absorbed that growth. After merging main the entry measured 1,042,264 bytes and non-content JavaScript 2,768,098 bytes. The ceilings keep the old absolute headroom over those numbers: 33,861 and 100,937 bytes, rounded down.

Function names survive because nothing is mangled. Line numbers do not help: the entry is 227 lines, about 4.6 KB per line. Use the column, or `dist/server/fetch.js.map`, which the build emits beside it.

Content size **alarms only**. Every JavaScript module with the stable `_virtual_reader-page-sources` chunk prefix is reader data; its generated hash does not affect classification. The test requires a content chunk and excludes the entry from that set. It logs content bytes and total JavaScript bytes without a growth ceiling. New lore and system pages must not fail a code-size budget.

Measurements and ceilings go to `apps/web/dist/website-upload-metrics.json`. The repeated clean build measured 10,343,775 content bytes and 14,742,838 total JavaScript bytes. A cold build had 192 fewer content bytes because a generated manifest path became a link on the next generation. Neither content variation blocks the gate. Source maps and client assets are excluded.

The full `pnpm turbo run check test build` gate includes this test. These checks measure uncompressed bytes, not startup CPU or Cloudflare limits. On preview, compare uploaded modules with the metrics file, record provider startup CPU, and check prerendered HTML, preview commit, unknown-path 404 and `/rpc`. Local workerd proof does not establish deployed latency or production health.
