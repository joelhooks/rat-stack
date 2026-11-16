import { expect, it } from "@effect/vitest";
import { Cause, Schema } from "effect";

import { retentionDiagnostic } from "../src/interest/join-retention-diagnostic.js";

it.prop(
  "only known failure tags and constructor names enter diagnostics",
  {
    tag: Schema.Literals([
      "JoinContactUnreadable",
      "RpcError",
      "RpcCallError",
      "DurableObjectError",
      "TimeoutError",
      "synthetic-secret-tag",
    ]),
    die: Schema.Boolean,
  },
  ({ tag, die }) => {
    const secret = "synthetic-secret-in-error-message";

    const value = Object.assign(new TypeError(secret), {
      _tag: tag,
      cause: secret,
    });

    const result = retentionDiagnostic(
      "handoff",
      "synthetic-id",
      die ? Cause.die(value) : Cause.fail(value)
    );

    const kind = {
      JoinContactUnreadable: "JoinContactUnreadable",
      RpcError: "RpcError",
      RpcCallError: "RpcError",
      DurableObjectError: "DurableObjectError",
      TimeoutError: "Timeout",
      "synthetic-secret-tag": "Defect",
    }[tag];

    expect(result).toEqual({
      step: "handoff",
      submissionId: "synthetic-id",
      kind,
      name: kind === "Defect" ? "TypeError" : null,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-tag");
  }
);

it("redacts unknown constructor names and invalid internal identifiers", () => {
  class SyntheticPrivateConstructorError extends Error {
    override name = "SyntheticPrivateConstructorError";
  }

  const cause = Cause.die(
    new SyntheticPrivateConstructorError("synthetic-secret")
  );

  expect(retentionDiagnostic("migrate", "secret@example.test", cause)).toEqual({
    step: "migrate",
    submissionId: null,
    kind: "Defect",
    name: "Unknown",
  });
});
