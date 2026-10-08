import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { expect, it } from "vitest";

import { acceptsHtml } from "../src/negotiation.js";

const request = (headers: Record<string, string>) =>
  HttpServerRequest.fromWeb(new Request("https://ratstack.sh/", { headers }));

it("chooses HTML for browsers and preview crawlers and Markdown for agents", () => {
  for (const [headers, html] of [
    [{}, false],
    [{ accept: "text/html" }, true],
    [{ accept: "TEXT/HTML" }, true],
    [{ accept: "text/html;q=0" }, false],
    [{ accept: "text/markdown" }, false],
    [{ "user-agent": "Twitterbot/1.0" }, true],
    [{ accept: "*/*", "user-agent": "Slackbot-LinkExpanding 1.0" }, true],
    [
      {
        accept: "*/*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      },
      true,
    ],
    [
      {
        accept: "*/*",
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
      },
      false,
    ],
    [
      {
        "user-agent":
          "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      },
      false,
    ],
    [{ accept: "*/*", "user-agent": "curl/8.7.1" }, false],
    [
      {
        accept: "text/markdown",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
      },
      false,
    ],
  ] as const) {
    expect(acceptsHtml(request(headers)), JSON.stringify(headers)).toBe(html);
  }
});
