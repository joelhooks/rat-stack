import { expect, it } from "@effect/vitest";
import {
  HelpCaller,
  SetupHelpAccess,
  readSetupHelpSettings,
  setupHelpStatus,
} from "@rat-stack/core/tokenmaxx-help";
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { Origin } from "../scripts/help-desk-client.ts";
import { HashListRejected, checkHashList } from "../scripts/help-hash-list.ts";

const host = Arbitrary.schema(
  Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9-]{0,20}(?:\.[a-z]{2,6}){1,2}$/u)
  )
);

const hexHash = Arbitrary.schema(
  Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{64}$/u))
);

const Corruption = Schema.Literals([
  "drop-char",
  "non-hex",
  "object",
  "trailing-comma",
  "number",
]);

const corruption = Arbitrary.schema(Corruption);

const corrupt = (hashes: readonly string[], how: typeof Corruption.Type) => {
  const [first = "a".repeat(64), ...rest] = hashes;

  const corrupted = {
    "drop-char": JSON.stringify([first.slice(1), ...rest]),
    "non-hex": JSON.stringify([`z${first.slice(1)}`, ...rest]),
    number: JSON.stringify([1, ...hashes]),
    object: JSON.stringify({ hashes }),
    "trailing-comma": `${JSON.stringify(hashes).slice(0, -1)},]`,
  } as const;

  return corrupted[how];
};

const operator = "synthetic-operator-token";

it.prop(
  "operator scripts accept an https origin and refuse plain http, paths and spaces",
  {
    name: host,
    form: Arbitrary.schema(Schema.Literals(["https", "http", "path", "space"])),
  },
  ({ name, form }) => {
    const origins = {
      http: `http://${name}`,
      https: `https://${name}`,
      path: `https://${name}/tokenmaxx`,
      space: `https://${name} `,
    } as const;

    expect(Schema.is(Origin)(origins[form])).toBe(form === "https");
  }
);

it.effect.prop(
  "help:check-hashes accepts exactly the lists the Worker reads, and counts what setupHelpStatus reports",
  {
    broken: Arbitrary.schema(Schema.Boolean),
    hashes: Arbitrary.array(hexHash, { maxLength: 8, minLength: 1 }),
    how: corruption,
    repeated: Arbitrary.schema(Schema.Boolean),
  },
  ({ broken, hashes: drawn, how, repeated }) =>
    Effect.gen(function* checkAgreement() {
      const hashes = repeated
        ? [...drawn, (drawn[0] ?? "a".repeat(64)).toUpperCase()]
        : drawn;

      const text = broken ? corrupt(hashes, how) : JSON.stringify(hashes);
      const checked = yield* Effect.exit(checkHashList("hashes.json", text));

      const settings = yield* readSetupHelpSettings.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              TOKENMAXX_ATTENDEE_HASHES: text,
              TOKENMAXX_HELP_OPERATOR_TOKEN: operator,
              TOKENMAXX_WORKSHOP_CODE: "synthetic-code",
            })
          )
        )
      );

      const status = yield* setupHelpStatus.handler({}).pipe(
        Effect.provide(
          Layer.merge(
            SetupHelpAccess.configLayer(settings),
            Layer.succeed(HelpCaller, {
              authorization: Option.some(Redacted.make(`Bearer ${operator}`)),
            })
          )
        )
      );

      expect(status.configured).toBe(Exit.isSuccess(checked));

      if (Exit.isSuccess(checked)) {
        expect(checked.value.count).toBe(status.attendeeCount);
      } else {
        expect(
          yield* Effect.flip(checkHashList("hashes.json", text))
        ).toBeInstanceOf(HashListRejected);
        expect(status.attendeeCount).toBe(0);
      }
    })
);
