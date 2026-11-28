import type { Plugin } from "vite";

const foldkitFetchModule = "\0virtual:foldkit/fetch";

const generatedFetch = `return handleRequest(request, {
      renderPage: server.renderPage,
      renderDocument: application => renderDocument(application, assets),
    })`;

export const instituteFetchPlugin = (): Plugin => ({
  enforce: "post",
  name: "institute-fetch-boundary",
  transform(source, id) {
    if (id !== foldkitFetchModule) {
      return null;
    }

    if (!source.includes(generatedFetch)) {
      return this.error(
        "Unknown Foldkit fetch entry. Institute media and XML require dispatch before Foldkit's asset classifier. Fix: update `instituteFetchPlugin` for the pinned Foldkit fetch template."
      );
    }

    return source.replace(
      generatedFetch,
      "return server.renderWebsiteRequest(request, assets)"
    );
  },
});
