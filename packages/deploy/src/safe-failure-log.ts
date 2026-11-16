import { Effect, Predicate, Schema, SchemaIssue } from "effect";
import type { Config, FileSystem } from "effect";

const paths = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: () => "",
  checkHook: () => "",
});

const publicKeys = new Set([
  "profile",
  "outcome",
  "checks",
  "rows",
  "reason",
  "step",
  "keys",
  "updated",
  "notUpdated",
  "versions",
  "previousVersions",
  "retainedOrphans",
  "observedAt",
  "operation",
  "completed",
  "targets",
  "source",
  "receipt",
]);

export const logSafeDeployFailure = (
  error:
    | Schema.SchemaError
    | Config.ConfigError
    | Effect.Error<ReturnType<FileSystem.FileSystem["makeDirectory"]>>,
  step: string,
  reason: string
) =>
  Effect.logError({
    _tag: Schema.isSchemaError(error) ? error._tag : "DeployBoundaryFailure",
    paths: Schema.isSchemaError(error)
      ? paths(error.issue).issues.map((issue) =>
          issue.path?.map((key) =>
            Predicate.isNumber(key) ||
            (Predicate.isString(key) && publicKeys.has(key))
              ? key
              : "<key>"
          )
        )
      : [],
    step,
    reason,
  });
