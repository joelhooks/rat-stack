import { contentCapabilities } from "@rat-stack/mischief/capabilities";
import { nodeContentLayer } from "@rat-stack/mischief/node-content";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";

import type { BackendFetch } from "../server/rpc.js";
import { devtoolsRoutes } from "./devtools/routes.js";

const { handler } = HttpRouter.toWebHandler(
  devtoolsRoutes(contentCapabilities).pipe(Layer.provide(nodeContentLayer)),
  {
    disableLogger: true,
  }
);

export const backend: BackendFetch = handler;

export const devtoolsBackend: BackendFetch = handler;
