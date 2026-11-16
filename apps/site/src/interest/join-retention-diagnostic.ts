import { JoinRetentionDiagnosticSchema } from "@rat-stack/core/join-interest";
import { Cause, Option, Result, Schema } from "effect";

type Diagnostic = typeof JoinRetentionDiagnosticSchema.Type;

const TaggedKind = Schema.Struct({
  _tag: Schema.Literals([
    "JoinContactUnreadable",
    "RpcError",
    "RpcCallError",
    "DurableObjectError",
    "TimeoutError",
  ]),
});

const kinds = {
  JoinContactUnreadable: "JoinContactUnreadable",
  RpcError: "RpcError",
  RpcCallError: "RpcError",
  DurableObjectError: "DurableObjectError",
  TimeoutError: "Timeout",
} satisfies Record<typeof TaggedKind.Type._tag, Diagnostic["kind"]>;

export const retentionDiagnostic = <E>(
  step: Diagnostic["step"],
  submissionId: string | null,
  cause: Cause.Cause<E>
): Diagnostic => {
  const failed = Cause.findErrorOption(cause);

  const died = Result.match(Cause.findDie(cause), {
    onSuccess: (reason) => reason.defect,
    onFailure: () => null,
  });

  const value = Option.isSome(failed) ? failed.value : died;
  const tag = Schema.decodeUnknownOption(TaggedKind)(value);

  const fallback =
    Cause.hasInterrupts(cause) &&
    !Cause.hasFails(cause) &&
    !Cause.hasDies(cause)
      ? "Interrupt"
      : "Defect";

  const kind = Option.isSome(tag) ? kinds[tag.value._tag] : fallback;

  const constructorName =
    value instanceof Error || value instanceof DOMException
      ? value.constructor.name
      : "Unknown";

  const name =
    kind === "Defect"
      ? Option.getOrElse(
          Schema.decodeUnknownOption(JoinRetentionDiagnosticSchema.fields.name)(
            constructorName
          ),
          (): Diagnostic["name"] => "Unknown"
        )
      : null;

  return {
    step,
    submissionId: Option.getOrNull(
      Schema.decodeOption(JoinRetentionDiagnosticSchema.fields.submissionId)(
        submissionId
      )
    ),
    kind,
    name,
  };
};
