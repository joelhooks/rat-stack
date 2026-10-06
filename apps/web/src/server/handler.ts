import type { BackendFetch } from "./rpc.js";

export const websiteHandler =
  (rpc: BackendFetch, assets: BackendFetch): BackendFetch =>
  // @effect-diagnostics-next-line asyncFunction:off -- A Worker fetch handler is a Promise boundary.
  async (request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/rpc" || pathname.startsWith("/rpc/")) {
      return await rpc(request);
    }

    if (pathname === "/__rat" || pathname.startsWith("/__rat/")) {
      return new Response("Not found", { status: 404 });
    }

    return await assets(request);
  };
