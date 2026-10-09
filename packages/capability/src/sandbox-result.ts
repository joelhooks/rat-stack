import { Cause, Effect, Option, Schema } from "effect";

import { modelSafeMessage } from "./sandbox-diagnostic.js";
import type { SandboxDiagnosticData } from "./sandbox-diagnostic.js";
import { SandboxError } from "./sandbox-error.js";
import { invokeFailure } from "./sandbox-invoke.js";
import { boundOutput, resolveLimits } from "./sandbox-limits.js";
import type { SandboxLimits } from "./sandbox-limits.js";
import type { Invoke, SandboxRun } from "./sandbox-service.js";

const diagnosticOf = (error: SandboxError): SandboxDiagnosticData => {
  if (error.diagnostic !== undefined) {
    return {
      ...error.diagnostic,
      message: modelSafeMessage(error.diagnostic.message),
    };
  }

  if (error.reason === "timeout") {
    return {
      kind: "TimeoutExceeded",
      message: "The program exceeded its execution timeout",
    };
  }

  if (error.reason === "threw") {
    return {
      kind: "ExecutionFailure",
      message: modelSafeMessage(error.message),
    };
  }

  return {
    kind: "HostFailure",
    message: "The sandbox could not complete the program",
  };
};

export const sandboxRunner = (
  run: (
    code: string,
    invoke: Invoke,
    names: readonly string[]
  ) => Effect.Effect<SandboxRun, SandboxError>,
  defaults: SandboxLimits = {}
) => {
  const configured = resolveLimits(defaults);

  return (
    code: string,
    invoke: Invoke,
    names: readonly string[] = [],
    overrides: SandboxLimits = {}
  ): Effect.Effect<SandboxRun, SandboxError> => {
    const limits = resolveLimits({
      maxOutputBytes: overrides.maxOutputBytes ?? configured.maxOutputBytes,
      maxToolCalls: overrides.maxToolCalls ?? configured.maxToolCalls,
    });

    return Effect.gen(function* normalizedSandboxRun() {
      const toolCalls: string[] = [];

      const admitted: Invoke = (name, input) => {
        if (
          limits.maxToolCalls !== undefined &&
          toolCalls.length >= limits.maxToolCalls
        ) {
          const failure = invokeFailure(
            "ToolCallLimitExceeded",
            "The program exceeded its tool-call limit"
          );

          return Effect.succeed({
            ...failure,
            diagnostic: {
              kind: "ToolCallLimitExceeded",
              message: "The program exceeded its tool-call limit",
            },
          });
        }

        toolCalls.push(name);

        return invoke(name, input);
      };

      const outcome = yield* run(code, admitted, names).pipe(
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(Schema.Json)(value.result).pipe(
            Effect.map((result): SandboxRun => ({
              ...value,
              diagnostic: value.diagnostic ?? null,
              result,
              toolCalls: value.toolCalls?.slice(0, limits.maxToolCalls) ?? [
                ...toolCalls,
              ],
            })),
            Effect.orElseSucceed((): SandboxRun => ({
              diagnostic: {
                kind: "InvalidDataValue",
                message: "Return a JSON-safe value from the program",
              },
              logs: value.logs,
              result: null,
              toolCalls: value.toolCalls?.slice(0, limits.maxToolCalls) ?? [
                ...toolCalls,
              ],
            }))
          )
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => {
            const error = Option.filter(
              Cause.findErrorOption(cause),
              Schema.is(SandboxError)
            );

            return Effect.succeed<SandboxRun>({
              diagnostic: Option.match(error, {
                onNone: (): SandboxDiagnosticData =>
                  toolCalls.length > 0
                    ? {
                        kind: "ToolFailure",
                        message: "Capability execution failed",
                        tag: "HostDefect",
                      }
                    : {
                        kind: "HostFailure",
                        message: "The sandbox could not complete the program",
                      },
                onSome: diagnosticOf,
              }),
              logs: Option.match(error, {
                onNone: () => [],
                onSome: (failure) => failure.logs,
              }),
              result: null,
              toolCalls: [...toolCalls],
            });
          }
        )
      );

      return boundOutput(outcome, limits.maxOutputBytes);
    });
  };
};
