import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { fetchSources } from "@rat-stack/code-snippets/fetch";
import { Effect, Path } from "effect";

import { codeRepositories } from "./code-config.ts";
import { collectBuildFences } from "./code-inputs.ts";

const program = Effect.gen(function* fetchCodeSources() {
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");
  const jobs = yield* collectBuildFences(root);
  const results = yield* fetchSources(jobs, codeRepositories(root));

  for (const result of results) {
    if (result !== null) {
      yield* Effect.log(
        `${result.repo}@${result.commit}: ${result.fetched ? "fetched" : "already present"}`
      );
    }
  }
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
