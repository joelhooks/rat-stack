import { Drift, prepareCode } from "@rat-stack/code-snippets";
import { shikiLayer } from "@rat-stack/code-snippets/shiki";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { collectBuildFences } from "./code-inputs.ts";
import { codeComponent } from "./code-pipeline.ts";
import { createComponentRegistry } from "./component-registry.ts";
import { openGitSnapshot } from "./git-snapshot.ts";
import { PeerRows, peerComponentRegistry, peerPins } from "./peers.ts";

export const migrationRegistry = Effect.fn("migrationRegistry")(
  function* migrationRegistry(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const read = (file: string) => fs.readFileString(`${root}/${file}`);

    const peers = yield* Schema.decodeEffect(Schema.fromJsonString(PeerRows))(
      yield* read(".brain/data/peers.json")
    );

    const pins = peerPins(
      yield* read("package.json"),
      yield* read("apps/infra/package.json"),
      yield* read("packages/core/package.json")
    );

    const snapshot = yield* openGitSnapshot(root, false);
    const fences = yield* collectBuildFences(root);

    const prepared = yield* prepareCode(fences).pipe(
      Effect.provide(
        Layer.mergeAll(Drift.silent, snapshot.sourceLayer, shikiLayer())
      )
    );

    return {
      registry: createComponentRegistry({
        ...peerComponentRegistry(peers, pins),
        Code: codeComponent(prepared.snippets),
      }),
      snippets: prepared.snippets,
    };
  }
);
