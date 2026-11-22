import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schema } from "effect";

import { checkHashList } from "./help-hash-list.ts";

const program = Effect.gen(function* checkHashesFile() {
  const file = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(
    process.argv[2]
  );

  const text = yield* FileSystem.FileSystem.use((fs) =>
    fs.readFileString(file)
  );

  const result = yield* checkHashList(file, text);

  yield* Console.log(JSON.stringify({ file, ok: true, ...result }));
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
