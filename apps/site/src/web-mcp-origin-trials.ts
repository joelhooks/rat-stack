import { Config, Effect, Schema } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { ReaderResponseHeaders } from "./reader-website.js";

const TrialToken = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/_-]*={0,2}$/u)
);

export const chromeWebMcpTrialToken = Config.schema(
  TrialToken,
  "WEB_MCP_CHROME_TRIAL_TOKEN"
).pipe(Config.withDefault(""));

export const edgeWebMcpTrialToken = Config.schema(
  TrialToken,
  "WEB_MCP_EDGE_TRIAL_TOKEN"
).pipe(Config.withDefault(""));

export const withWebMcpOriginTrials = (
  tokens: readonly string[],
  responseHeaders: ReaderResponseHeaders
): ReaderResponseHeaders => {
  const value = tokens.filter((token) => token !== "").join(", ");

  return (pathname, response, origin) =>
    responseHeaders(pathname, response, origin).pipe(
      Effect.map((secured) =>
        value !== "" &&
        secured.headers["content-type"]?.startsWith("text/html") === true
          ? HttpServerResponse.setHeader(secured, "Origin-Trial", value)
          : secured
      )
    );
};
