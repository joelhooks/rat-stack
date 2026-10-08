import { Effect } from "effect";

export const inspect = Effect.fn("FileInspector.inspect")(function* inspect(
  path: string
) {
  const extension = path.split(".").at(-1) ?? "none";
  yield* Effect.annotateCurrentSpan("file.extension", extension);

  return path.length;
});

export const report = inspect("README.md").pipe(
  Effect.withSpan("report.build")
);
