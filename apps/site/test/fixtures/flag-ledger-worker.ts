import * as Cloudflare from "@alchemy.run/cloudflare";
import { FlagJournal, FlagLedger } from "@rat-stack/core/flag-control";
import { Flags } from "@rat-stack/core/flags";
import {
  cloudflareFlagControlLayer,
  cloudflareFlagsLayer,
  defineFlagLedger,
} from "@rat-stack/flags/cloudflare";
import { configFlagsLayer } from "@rat-stack/flags/config";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";
import * as RuntimeContext from "alchemy/RuntimeContext";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  LedgerCommand,
  LedgerFailure,
  LedgerOutcome,
  configuredValues,
  deployFlag,
  ledgerRegistry,
  readRegistry,
} from "./flag-ledger-protocol.js";

const TestFlagLedger = defineFlagLedger(ledgerRegistry, [deployFlag.name]);

const replicaNamespace = Cloudflare.KV.Namespace("Store").pipe(
  retain(),
  Namespace.set("FeatureFlags")
);

const taggedName = Schema.decodeUnknownOption(
  Schema.Struct({ _tag: Schema.String })
);

const outcomeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.match(exit, {
    onFailure: (cause) =>
      Option.match(Cause.findErrorOption(cause), {
        onNone: () => LedgerOutcome.cases.Defect.make({}),
        onSome: (error) =>
          Schema.is(LedgerFailure)(error)
            ? LedgerOutcome.cases.Failure.make({ error })
            : LedgerOutcome.cases.Unexpected.make({
                tag: Option.match(taggedName(error), {
                  onNone: () => "untagged",
                  onSome: ({ _tag }) => _tag,
                }),
              }),
      }),
    onSuccess: (value) =>
      LedgerOutcome.cases.Success.make({
        value: Schema.decodeSync(Schema.fromJsonString(Schema.Json))(
          JSON.stringify(value ?? null)
        ),
      }),
  });

export default class FlagLedgerWorker extends Cloudflare.Worker<FlagLedgerWorker>()(
  "FlagLedgerWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeFlagLedgerWorker() {
    const ledgers = yield* TestFlagLedger;
    const namespace = yield* replicaNamespace;
    const reader = yield* Cloudflare.KV.ReadNamespace(namespace);
    const writer = yield* Cloudflare.KV.WriteNamespace(namespace);

    const control = yield* Layer.build(
      cloudflareFlagControlLayer(TestFlagLedger)
    );

    const flags = yield* Layer.build(
      cloudflareFlagsLayer(
        readRegistry,
        configFlagsLayer(readRegistry).pipe(
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown(configuredValues))
          )
        ),
        [deployFlag.name]
      )
    );

    const run = Match.type<typeof LedgerCommand.Type>().pipe(
      Match.tagsExhaustive({
        DirectList: (command) =>
          ledgers.getByName(command.partition).list(command.input),
        DirectRead: (command) =>
          ledgers
            .getByName(command.partition)
            .read(command.name, command.scope),
        Evidence: (command) =>
          FlagLedger.use((ledger) =>
            ledger.recordEvidence(command.input, command.actor)
          ).pipe(Effect.provideContext(control)),
        Flip: (command) =>
          FlagLedger.use((ledger) =>
            ledger.flip(command.input, command.actor)
          ).pipe(Effect.provideContext(control)),
        Get: (command) =>
          Flags.use((service) =>
            Option.match(
              Option.fromUndefinedOr(
                readRegistry.find((flag) => flag.name === command.name)
              ),
              {
                onNone: () => Effect.die(`Undeclared flag ${command.name}`),
                onSome: (flag) =>
                  service.get(
                    flag,
                    command.scope === undefined ? {} : { scope: command.scope }
                  ),
              }
            )
          ).pipe(Effect.provideContext(flags)),
        KvGet: (command) =>
          reader
            .get(command.key)
            .pipe(Effect.provide(RuntimeContext.RuntimeContext.phantom)),
        KvPut: (command) =>
          writer
            .put(command.key, command.value)
            .pipe(Effect.provide(RuntimeContext.RuntimeContext.phantom)),
        List: (command) =>
          FlagJournal.use((journal) => journal.list(command.input)).pipe(
            Effect.provideContext(control)
          ),
        Read: (command) =>
          FlagLedger.use((ledger) =>
            ledger.read(command.name, command.scope)
          ).pipe(Effect.provideContext(control)),
        Record: (command) =>
          FlagJournal.use((journal) => journal.record(command.change)).pipe(
            Effect.provideContext(control)
          ),
        Redrive: (command) => ledgers.getByName(command.partition).redrive(),
        Registry: () =>
          Flags.use((service) =>
            Effect.succeed(service.registry.map((flag) => flag.name))
          ).pipe(Effect.provideContext(flags)),
      })
    );

    const handle = Effect.gen(function* handleLedgerCommand() {
      const request = yield* HttpServerRequest.HttpServerRequest;

      const command = yield* request.text.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(LedgerCommand))
        ),
        Effect.orDie
      );

      const outcome = outcomeOf(yield* Effect.exit(run(command)));

      return HttpServerResponse.text(
        yield* Schema.encodeEffect(Schema.fromJsonString(LedgerOutcome))(
          outcome
        ).pipe(Effect.orDie),
        { contentType: "application/json" }
      );
    });

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpRouter.add("POST", "/", handle)
      ).pipe(Effect.orDie),
    };
  }).pipe(
    Effect.provide(
      Layer.merge(
        Cloudflare.KV.ReadNamespaceBinding,
        Cloudflare.KV.WriteNamespaceBinding
      )
    )
  )
) {}
