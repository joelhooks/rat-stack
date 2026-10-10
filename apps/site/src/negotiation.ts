import type * as HttpServerRequest from "effect/http/HttpServerRequest";

const previewCrawler =
  /(?:Twitterbot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|TelegramBot|Bluesky|Mastodon|Pinterestbot|redditbot|Applebot)/iu;

const agentCrawler =
  /(?:GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Bytespider|Amazonbot|cohere-ai|Meta-ExternalAgent|MistralAI-User|DuckAssistBot|Applebot-Extended)/iu;

export const acceptedMediaTypes = (accept: string | undefined) =>
  (accept ?? "")
    .split(",")
    .map((entry) => {
      const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");

      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));

      return { mediaType: mediaType ?? "", rejected: quality === "q=0" };
    })
    .filter((entry) => entry.mediaType !== "" && !entry.rejected)
    .map((entry) => entry.mediaType);

export const acceptsHtml = (request: HttpServerRequest.HttpServerRequest) => {
  const accepted = acceptedMediaTypes(request.headers.accept);

  if (accepted.includes("text/html")) {
    return true;
  }

  if (accepted.includes("text/markdown")) {
    return false;
  }

  const userAgent = request.headers["user-agent"] ?? "";

  if (previewCrawler.test(userAgent)) {
    return true;
  }

  if (agentCrawler.test(userAgent)) {
    return false;
  }

  return userAgent.startsWith("Mozilla/");
};
