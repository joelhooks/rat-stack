import { EmailHashList } from "@rat-stack/core/tokenmaxx-help";
import { Effect, Schema, SchemaIssue } from "effect";

export class HashListRejected extends Schema.TaggedError<
  HashListRejected,
  { readonly brand: unique symbol }
>()("HashListRejected", { file: Schema.String, problems: Schema.String }) {
  override get message() {
    return `${this.file} is not a valid hash list: ${this.problems}. A set but invalid TOKENMAXX_ATTENDEE_HASHES turns workshop help off. Fix: write a JSON array of sha256 hex digests of trimmed, lowercased emails, then rerun \`pnpm --filter @rat-stack/site help:check-hashes ${this.file}\`.`;
  }
}

const whereIn = (path: readonly unknown[] | undefined) => {
  const joined = (path ?? []).map(String).join(".");

  return joined.length > 0 ? joined : "(list)";
};

export const checkHashList = (file: string, text: string) =>
  Schema.decodeUnknownEffect(EmailHashList)(text, { errors: "all" }).pipe(
    Effect.mapError(
      (cause) =>
        new HashListRejected({
          file,
          problems: SchemaIssue.makeFormatterStandardSchemaV1()(cause.issue)
            .issues.map((issue) => `${whereIn(issue.path)}: ${issue.message}`)
            .join("; "),
        })
    ),
    Effect.map((hashes) => {
      const distinct = new Set(hashes.map((hash) => hash.toLowerCase()));

      return {
        count: distinct.size,
        duplicates: hashes.length - distinct.size,
      };
    })
  );
