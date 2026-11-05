import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { handoffToken } from "alchemy-turbo-cache/token";
import * as State from "alchemy/State";
import { Effect } from "effect";

import TurboCache from "../src/index.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `turbo_cache_adoption_${process.pid}`,
});

test.provider(
  "the installed cartridge preserves rat-stack resource identities and the credential handoff",
  (stack) =>
    Effect.gen(function* cartridgeAdoption() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- ScratchStack erases provider errors; this local runtime-test boundary converts failure to a defect.
      const deployment = yield* Effect.orDie(stack.deploy(TurboCache));

      const state = yield* Effect.flatten(State.State).pipe(
        Effect.provide(stack.state)
      );

      const fqns = yield* state.list({ stack: stack.name, stage: stack.stage });

      expect(fqns.toSorted()).toEqual([
        "TurboCache",
        "TurboCacheFoundation/TurboCacheBucket",
        "TurboCacheFoundation/TurboCacheToken-rat-stack",
      ]);

      const values = yield* handoffToken(
        (fqn) =>
          state
            .get({ fqn, stack: stack.name, stage: stack.stage })
            .pipe(Effect.orDie),
        {
          args: [
            "-e",
            "let input=''; process.stdin.on('data',x=>input+=x); process.stdin.on('end',async()=>{ if(!/^[a-f0-9]{64}$/.test(input))process.exit(1); const response=await fetch(process.argv[1]+'/v8/artifacts/status?slug=rat-stack',{headers:{authorization:'Bearer '+input}}); process.exit(response.status===200?0:2); });",
            deployment.url ?? "",
          ],
          command: process.execPath,
          resourceNamePrefix: "TurboCache",
          team: "rat-stack",
          teams: ["rat-stack"],
        }
      );

      expect(values.TURBO_API).toBe(new URL(deployment.url ?? "").origin);
      expect(values.TURBO_TEAM).toBe("rat-stack");
    }),
  { timeout: 180_000 }
);
