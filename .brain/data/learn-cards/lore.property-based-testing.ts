import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

const hidden = new Set(["token", "email", "password"]);

const redact = (query: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(query).filter(([key]) => !hidden.has(key)));

const secret = Arbitrary.schema(
  Schema.Struct({
    key: Schema.Literals(["token", "email", "password"]),
    value: Schema.String,
  })
);

it.prop("a credential key never survives redaction", { secret }, (run) => {
  expect(
    redact({ [run.secret.key]: run.secret.value, page: "2" })
  ).toStrictEqual({
    page: "2",
  });
});
