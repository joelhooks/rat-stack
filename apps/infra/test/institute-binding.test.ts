import * as Cloudflare from "@alchemy.run/cloudflare";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import {
  Artifacts,
  createArtifactStore,
  makeScopedArtifacts,
} from "alchemy/Artifacts";
import * as Output from "alchemy/Output";
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpClient from "effect/http/HttpClient";

import { instituteStage } from "../../site/src/institute-mount.js";
import stack from "../alchemy.run.js";

const services = Layer.mergeAll(
  AlchemyContextLive,
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("Institute declarations must not call the provider")
    )
  )
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      NodeServices.layer,
      SecureRandom.layerWebCrypto,
      Digest.layerWebCrypto
    )
  )
);

const compile = (stage: string, artifact?: string) =>
  stack.pipe(
    Effect.provide(services),
    Effect.provideService(Stage, stage),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EMAIL_FORWARD_TO: "forward@example.test",
          INSTITUTE_ARTIFACT: artifact,
          INSTITUTE_ENABLED: artifact !== undefined,
        })
      )
    )
  );

it.effect(
  "does not change Mischief bindings or declare Institute without an artifact",
  () =>
    Effect.gen(function* checkDefault() {
      const compiled = yield* compile("prod");
      expect(compiled.resources.Institute).toBeUndefined();
      expect(compiled.resources.Mischief?.Props).not.toHaveProperty(
        "env.INSTITUTE_ENABLED"
      );
      expect(
        compiled.bindings.Mischief?.some(
          (binding) => binding.sid === "Institute"
        )
      ).toBe(false);
    })
);

const InstituteProps = Schema.Struct({
  assets: Schema.Struct({
    base: Schema.optionalKey(Schema.String),
    directory: Schema.String,
    notFoundHandling: Schema.Literal("none"),
    runWorkerFirst: Schema.Array(Schema.String),
  }),
  bundle: Schema.Literal(false),
  main: Schema.String,
  rules: Schema.Array(Schema.Struct({ globs: Schema.Array(Schema.String) })),
});

it.effect(
  "binds the prebuilt modules and mounted assets without creating a public stage or declaring production DNS",
  () =>
    Effect.gen(function* checkMount() {
      const fs = yield* FileSystem.FileSystem;
      const { join } = yield* Path.Path;

      const artifact = yield* fs.makeTempDirectoryScoped({
        prefix: "institute-dist-",
      });

      yield* fs.makeDirectory(join(artifact, "server/assets"), {
        recursive: true,
      });
      yield* fs.makeDirectory(join(artifact, "client/institute/content"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        join(artifact, "server/index.js"),
        'export { default } from "./assets/ssr.js";'
      );
      yield* fs.writeFileString(
        join(artifact, "server/assets/ssr.js"),
        'export default { fetch: () => new Response("institute") };'
      );
      yield* fs.writeFileString(join(artifact, "server/index.js.map"), "{}");
      yield* fs.writeFileString(join(artifact, "server/wrangler.json"), "{}");
      yield* fs.writeFileString(
        join(artifact, "client/institute/content/manifest.json"),
        "{}"
      );

      const compiled = yield* compile(instituteStage, artifact);

      expect(compiled.resources.Workshop).toBeUndefined();
      expect(compiled.resources.Mischief?.Props).toHaveProperty(
        "env.INSTITUTE_ENABLED",
        "true"
      );
      expect(
        Object.values(compiled.resources).filter((resource) =>
          /^Cloudflare\.(?:DNS\.|Email\.|Zone$)/u.test(resource.Type)
        )
      ).toEqual([]);

      for (const id of ["Institute", "Mischief"]) {
        const props: unknown = compiled.resources[id]?.Props;
        expect(props).toMatchObject({
          workersDev: { enabled: false, previewsEnabled: false },
        });
        expect(props).not.toHaveProperty("domain");
        expect(props).not.toHaveProperty("routes");
      }

      const binding = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          bindings: Schema.Tuple([
            Schema.Struct({
              name: Schema.Literal("INSTITUTE"),
              service: Schema.Unknown,
              type: Schema.Literal("service"),
            }),
          ]),
        })
      )(
        compiled.bindings.Mischief?.find((entry) => entry.sid === "Institute")
          ?.data
      );

      expect(
        Output.resolveUpstream(binding.bindings[0].service)
      ).toHaveProperty("Institute");
      expect(
        compiled.bindings.Mischief?.find((entry) => entry.sid === "Website")
          ?.data
      ).toMatchObject({
        bindings: [{ name: "WEBSITE", type: "service" }],
      });

      const props = yield* Schema.decodeUnknownEffect(InstituteProps)(
        compiled.resources.Institute?.Props
      );

      const workerProps = {
        ...props,
        assets: {
          ...props.assets,
          runWorkerFirst: [...props.assets.runWorkerFirst],
        },
        rules: [...props.rules],
      } satisfies Cloudflare.Workers.WorkerProps;

      const source = yield* Cloudflare.Workers.resolveSource(workerProps);

      const output = yield* source.build(
        Cloudflare.Workers.makeSourceContext({
          compatibility: { date: "2026-05-25", flags: ["nodejs_compat"] },
          fqn: "Institute",
          id: "Institute",
          props: workerProps,
          stack: { name: "RatStack", stage: instituteStage },
          workerName: "fixture-institute",
        })
      );

      expect(output.bundle?.files.map((file) => file.path)).toEqual([
        "index.js",
        "assets/ssr.js",
      ]);

      const assets = yield* Cloudflare.Workers.readAssets(workerProps.assets);

      expect(Object.keys(assets.manifest)).toEqual([
        "/institute/content/manifest.json",
      ]);
      expect(workerProps.assets.runWorkerFirst).toEqual([
        "/institute/content/*",
      ]);
    }).pipe(
      Effect.provide(services),
      Effect.provideServiceEffect(
        Artifacts,
        Effect.sync(() =>
          makeScopedArtifacts(createArtifactStore(), "Institute")
        )
      )
    )
);
