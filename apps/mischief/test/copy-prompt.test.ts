import { expect, it } from "vitest";

import {
  homeDocumentHtml,
  homeMarkdownTemplate,
  tokenmaxxDocumentHtml,
  tokenmaxxMarkdown,
} from "../src/bundled-content.generated.js";

it.each([
  ["home", homeDocumentHtml, 4],
  ["tokenmaxx", tokenmaxxDocumentHtml, 1],
])(
  "%s gives every copy control a visible label and live status",
  (_, html, count) => {
    const controls = [
      ...html.matchAll(
        /<span class="copy-actions">\s*(?<button><button\b[^>]*>[\s\S]*?<\/button>)\s*(?<status><span\b[^>]*><\/span>)\s*<\/span>/gu
      ),
    ];

    expect(controls).toHaveLength(count);

    for (const control of controls) {
      expect(control.groups?.button).toMatch(
        /<span class="copy-label">[^<]+<\/span>/u
      );
      expect(control.groups?.status).toContain('role="status"');
      expect(control.groups?.status).toContain('aria-live="polite"');
    }

    expect(html).not.toMatch(
      /copy-agent|agent-actions|robot-head|copy-(?:big|hero)/u
    );
  }
);

it.each([homeMarkdownTemplate, tokenmaxxMarkdown])(
  "agent markdown contains no copy controls",
  (markdown) => {
    expect(markdown).not.toContain("<button");
    expect(markdown).not.toContain("copy-actions");
    expect(markdown).not.toContain("<CopyPrompt");
  }
);
