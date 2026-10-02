import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { expect } from "vitest";

import { writeFileAtomically } from "../scripts/write-file-atomically.ts";

it.effect("concurrent report publication only exposes complete values", () =>
  Effect.gen(function* checkAtomicReport() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const directory = yield* fs.makeTempDirectoryScoped();
    const file = path.join(directory, "report.json");
    const values = ["initial", "a".repeat(200_000), "b".repeat(200_000)];

    yield* writeFileAtomically(file, JSON.stringify(values[0]));
    yield* Effect.all(
      [
        writeFileAtomically(file, JSON.stringify(values[1])),
        writeFileAtomically(file, JSON.stringify(values[2])),
        Effect.forEach(Array.from({ length: 20 }), () =>
          fs.readFileString(file).pipe(
            Effect.flatMap(
              Schema.decodeEffect(Schema.fromJsonString(Schema.String))
            ),
            Effect.tap((value) =>
              Effect.sync(() => {
                expect(values).toContain(value);
              })
            )
          )
        ),
      ],
      { concurrency: "unbounded" }
    );
  }).pipe(Effect.provide(NodeServices.layer))
);
