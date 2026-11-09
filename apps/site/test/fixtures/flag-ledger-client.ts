import type * as Test from "@alchemy.run/test/Vitest";
import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { FlagPosition, FlagReceipt } from "@rat-stack/core/flag-control";
import type { FlagChange } from "@rat-stack/core/flag-control";
import { Effect, Layer, Schedule, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpClient, HttpClientRequest } from "effect/http";

import { LedgerCommand, LedgerOutcome } from "./flag-ledger-protocol.js";
import FlagLedgerWorker from "./flag-ledger-worker.js";
import { deployScratch } from "./scratch-deploy.js";

const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(LedgerCommand));

const decodeOutcome = Schema.decodeEffect(Schema.fromJsonString(LedgerOutcome));

export class UnexpectedOutcome extends Schema.TaggedError<
  UnexpectedOutcome,
  { readonly brand: unique symbol }
>()("UnexpectedOutcome", { expected: Schema.String, outcome: Schema.String }) {}

const mismatch = (expected: string, outcome: typeof LedgerOutcome.Type) =>
  new UnexpectedOutcome({ expected, outcome: JSON.stringify(outcome) });

export const succeeded =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (outcome: typeof LedgerOutcome.Type) =>
    LedgerOutcome.match(outcome, {
      Defect: () => Effect.fail(mismatch("Success", outcome)),
      Failure: () => Effect.fail(mismatch("Success", outcome)),
      Success: ({ value }) =>
        Schema.decodeEffect(schema)(value).pipe(
          Effect.mapError(() => mismatch("a decodable success", outcome))
        ),
      Unexpected: () => Effect.fail(mismatch("Success", outcome)),
    });

export const failed = (outcome: typeof LedgerOutcome.Type) =>
  LedgerOutcome.match(outcome, {
    Defect: () => Effect.fail(mismatch("Failure", outcome)),
    Failure: ({ error }) => Effect.succeed(error),
    Success: () => Effect.fail(mismatch("Failure", outcome)),
    Unexpected: () => Effect.fail(mismatch("Failure", outcome)),
  });

export const flagLedgerClient = (url: string) => {
  const send = (command: typeof LedgerCommand.Type) =>
    encodeCommand(command).pipe(
      Effect.map((body) =>
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyText(body, "application/json")
        )
      ),
      Effect.flatMap(HttpClient.execute),
      Effect.flatMap((response) => response.text),
      Effect.flatMap(decodeOutcome),
      Effect.orDie
    );

  return {
    directList: (
      partition: string,
      input: (typeof LedgerCommand.cases.List.Type)["input"]
    ) => send(LedgerCommand.cases.DirectList.make({ input, partition })),
    directRead: (partition: string, name: string, scope?: Schema.Json) =>
      send(
        LedgerCommand.cases.DirectRead.make({
          name,
          partition,
          scope,
        })
      ),
    evidence: (input: (typeof LedgerCommand.cases.Evidence.Type)["input"]) =>
      send(LedgerCommand.cases.Evidence.make({ input })),
    flip: (
      input: (typeof LedgerCommand.cases.Flip.Type)["input"],
      actor?: string
    ) =>
      send(
        LedgerCommand.cases.Flip.make({
          actor,
          input,
        })
      ),
    get: (name: string, scope?: Schema.Json) =>
      send(
        LedgerCommand.cases.Get.make({
          name,
          scope,
        })
      ),
    kvGet: (key: string) =>
      send(LedgerCommand.cases.KvGet.make({ key })).pipe(
        Effect.flatMap(succeeded(Schema.NullOr(Schema.String))),
        Effect.orDie
      ),
    kvPut: (key: string, value: string) =>
      send(LedgerCommand.cases.KvPut.make({ key, value })),
    list: (input: (typeof LedgerCommand.cases.List.Type)["input"]) =>
      send(LedgerCommand.cases.List.make({ input })),
    read: (name: string, scope?: Schema.Json) =>
      send(
        LedgerCommand.cases.Read.make({
          name,
          scope,
        })
      ),
    record: (change: FlagChange) =>
      send(LedgerCommand.cases.Record.make({ change })),
    redrive: (partition: string) =>
      send(LedgerCommand.cases.Redrive.make({ partition })),
    registry: () =>
      send(LedgerCommand.cases.Registry.make({})).pipe(
        Effect.flatMap(succeeded(Schema.Array(Schema.String))),
        Effect.orDie
      ),
  };
};

export type FlagLedgerClient = ReturnType<typeof flagLedgerClient>;

export const position = succeeded(FlagPosition);

export const receipt = succeeded(FlagReceipt);

export const eventually = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean
) =>
  effect.pipe(
    Effect.repeat({ schedule: Schedule.spaced("25 millis"), until }),
    Effect.timeout("15 seconds")
  );

export const localServices = Layer.merge(
  NodeServices.layer,
  NodeCrypto.layerSecureRandom
);

export const deployFlagLedger = (stack: Test.ScratchStack) =>
  Effect.gen(function* deployFlagLedgerWorker() {
    const worker = yield* deployScratch(stack, FlagLedgerWorker);
    const url = yield* Effect.fromNullishOr(worker.url);

    return flagLedgerClient(url);
  }).pipe(Effect.orDie);

export const tenantScope = SecureRandom.SecureRandom.use((random) =>
  random.uuidV4()
).pipe(Effect.map((tenant) => ({ tenant })));
