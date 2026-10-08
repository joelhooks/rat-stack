import { Config, ConfigProvider, Context, Effect, Layer } from "effect";

const appEnv = Config.Literals(
  ["development", "test", "production"],
  "APP_ENV"
).pipe(Config.withDefault("development"));

export class AppConfig extends Context.Service<
  AppConfig,
  { readonly appEnv: Config.Success<typeof appEnv> }
>()("myapp/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* readAppConfig() {
      return AppConfig.of({ appEnv: yield* appEnv });
    })
  );
}

const testSource = ConfigProvider.fromUnknown({ APP_ENV: "test" });

export const inTests = AppConfig.layer.pipe(
  Layer.provide(ConfigProvider.layer(testSource))
);
