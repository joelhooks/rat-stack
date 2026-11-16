import * as Schema from "effect/Schema";

export const AuthorIdentity = Schema.Struct({
  source: Schema.NonEmptyString,
  author: Schema.NonEmptyString,
});

export const normalizeAuthor = (author: string) => author.toLowerCase();

export const authorIdentityKey = (identity: typeof AuthorIdentity.Type) =>
  JSON.stringify([identity.source, normalizeAuthor(identity.author)]);
