import type { BackendFetch } from "./rpc.js";

const routeWebsite =
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

export const websiteHandler = (
  rpc: BackendFetch,
  assets: BackendFetch,
  previewCommit?: string
): BackendFetch => {
  const route = routeWebsite(rpc, assets);

  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare serves the same response with preview-only indexing headers.
  return async (request) => {
    const response = await route(request);

    if (
      !/^pr-[1-9][0-9]*\.ratstack\.sh$/u.test(new URL(request.url).hostname)
    ) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex");

    if (previewCommit !== undefined) {
      headers.set("X-Preview-Commit", previewCommit);
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
};
