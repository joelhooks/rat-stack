import { it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { expect } from "vitest";

import { generateForCommand } from "../scripts/content-generation.ts";

for (const hash of [undefined, "", "turbo-task-hash"]) {
  it.effect(`generation ownership for ${hash ?? "a direct command"}`, () =>
    Effect.gen(function* checkGenerationOwnership() {
      let generated = false;
      yield* generateForCommand(
        Effect.sync(() => {
          generated = true;
        })
      );
      expect(generated).toBe(hash === undefined || hash === "");
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: hash === undefined ? {} : { TURBO_HASH: hash },
          })
        )
      )
    )
  );
}
