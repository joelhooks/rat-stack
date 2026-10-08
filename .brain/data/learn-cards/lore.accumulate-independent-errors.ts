import { Effect, Schema } from "effect";

export class SnippetError extends Schema.TaggedError<SnippetError>()(
  "SnippetError",
  { id: Schema.String, reason: Schema.String }
) {}

interface Snippet {
  readonly id: string;
  readonly source: string;
}

const check = (snippet: Snippet) =>
  snippet.source.trim() === ""
    ? Effect.fail(new SnippetError({ id: snippet.id, reason: "empty" }))
    : Effect.succeed(snippet);

const writeAssets = (snippets: readonly Snippet[]) =>
  Effect.log(`writing ${snippets.length} assets`);

export const preflight = (snippets: readonly Snippet[]) =>
  Effect.validate(snippets, check).pipe(Effect.andThen(writeAssets));
