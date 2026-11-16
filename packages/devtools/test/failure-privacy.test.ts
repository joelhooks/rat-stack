import { expect, it } from "@effect/vitest";
import { Approval, defineContract, implement } from "@rat-stack/capability";
import { Effect, Layer, Logger, Schema } from "effect";

import { devtools, devtoolsLayer } from "../src/index.js";

class DiagnosticFailure extends Schema.TaggedError<
  DiagnosticFailure,
  { readonly brand: unique symbol }
>()("DiagnosticFailure", {
  cause: Schema.Defect(),
  detail: Schema.String,
}) {}

it.effect(
  "recorded failures keep causes out of rat_get_call's public JSON",
  () =>
    Effect.gen(function* recordedFailurePrivacy() {
      const secret = "planted-recorded-cause-secret-7841";

      const capability = implement(
        defineContract("diagnosticFailure", {
          description: "Fail with a private cause",
          input: Schema.Struct({}),
          output: Schema.Never,
          failure: DiagnosticFailure,
        }),
        () =>
          Effect.fail(
            new DiagnosticFailure({
              cause: new Error(secret),
              detail: "public-detail",
            })
          )
      );

      const { recorded, tools } = yield* devtools([capability]);
      const [recordedCapability] = recorded;
      yield* recordedCapability.handler({}).pipe(Effect.flip);
      const { 4: getCall } = tools;
      const response = yield* getCall.handler({ index: 0, expand: true });
      const json = JSON.stringify(response);
      expect(json).not.toContain(secret);
      expect(json).not.toContain('"cause"');
      expect(json).toContain("DiagnosticFailure");
      expect(json).toContain("public-detail");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(devtoolsLayer(), Approval.allowAll, Logger.layer([]))
      )
    )
);
