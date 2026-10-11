import type { CopyPromptSpec } from "./component-data.ts";

export const escapeHtmlText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

export const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

export interface HouseAd {
  readonly href: string;
  readonly label: string;
  readonly line: string;
  readonly link: string;
}

export interface DiscoveryLink {
  readonly href: string;
  readonly rel: string;
  readonly type: string;
}

export interface DocumentShell {
  readonly agentPointerHtml: string;
  readonly bodyHtml: string;
  readonly breadcrumbHref?: string;
  readonly breadcrumbLabel?: string;
  readonly breadcrumbName?: string;
  readonly description: string;
  readonly discoveryLinks: readonly DiscoveryLink[];
  readonly houseAdHtml?: string;
  readonly noindex?: boolean;
  readonly ogImageUrl: string;
  readonly origin: string;
  readonly path: string;
  readonly stylesheet: string;
  readonly title: string;
}

const copyIcon =
  '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2m16 0h2m-7-1v2m-6-2v2"></path></svg>';

const copiedIcon =
  '<svg class="icon icon-done" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" hidden=""><path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

const copyControl = (spec: CopyPromptSpec) =>
  `<span class="copy-actions"><button type="button" class="${spec.variant === "primary" ? "copy copy-primary" : "copy"}" data-text="${escapeHtmlAttribute(spec.text)}" aria-label="${escapeHtmlAttribute(spec.label)}" hidden="">${copyIcon} ${copiedIcon} <span class="copy-label">${escapeHtmlText(spec.label)}</span></button> <span class="copy-status" role="status" aria-live="polite"></span></span>`;

const promptText = (spec: CopyPromptSpec) =>
  `<details class="prompt-text"><summary>See the prompt</summary> <pre><code>${escapeHtmlText(spec.text)}</code></pre></details>`;

export const renderCopyPrompt = (spec: CopyPromptSpec) => {
  if (spec.variant === "text") {
    return `<div class="prompt">${promptText(spec)}</div>`;
  }

  return spec.showText
    ? `<div class="prompt">${copyControl(spec)} ${promptText(spec)}</div>`
    : copyControl(spec);
};

const arrowIcon =
  '<svg aria-hidden="true" class="icon" fill="none" height="16" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16"><path d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

export const renderHouseAd = (ad: HouseAd) =>
  `<aside class="workshop-callout" aria-label="${escapeHtmlAttribute(ad.label)}"><span class="workshop-callout-label">${escapeHtmlText(ad.label)}</span> <span class="workshop-callout-title">${escapeHtmlText(ad.line)}</span> <span class="workshop-callout-action"><a class="workshop-callout-apply" href="${escapeHtmlAttribute(ad.href)}">${escapeHtmlText(ad.link)}${arrowIcon}</a></span></aside>`;

const siteNavigation =
  '<header><nav aria-label="Primary navigation" class="site-nav"><a class="brand" href="/"><strong>🐀 Rat Stack</strong></a> <div class="site-links"><ul><li><a href="/skills">skills</a></li> <li><a href="/lore">lore</a></li> <li><a href="/systems">systems</a></li> <li><a href="/glossary">glossary</a></li> <li><a href="/search">search</a></li></ul> <ul><li><a href="/llms.txt">agent guide</a></li></ul></div></nav></header>';

const siteFooter =
  '<footer><hr> <div class="site-reference"><section aria-label="Explore"><h2>Explore</h2> <ul><li><a href="/learn">learn mode</a></li> <li><a href="/glossary">glossary</a></li> <li><a href="/log">change log</a></li> <li><a href="/resources/peers">peers</a></li></ul></section> <section aria-label="Reference"><h2>Reference</h2> <ul><li><a href="/llms.txt">agent guide</a></li> <li><a href="/openapi.json">API docs</a></li> <li><a href="https://github.com/joelhooks/rat-stack">source</a></li></ul></section></div> <p>Markdown by default. HTML when you ask for it. <a href="/llms.txt">Agents start here</a>.</p></footer>';

const meta = (key: "name" | "property", name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeHtmlAttribute(content)}">`;

export const renderDocumentShell = (shell: DocumentShell) => {
  const canonicalUrl = `${shell.origin}${shell.path}`;

  const head = [
    `<style>${shell.stylesheet}</style>`,
    ' <meta charset="utf-8">',
    ' <meta name="viewport" content="width=device-width, initial-scale=1">',
    ` ${meta("name", "description", shell.description)}`,
    ` ${shell.noindex === true ? '<meta name="robots" content="noindex">' : ""}`,
    ` ${meta("property", "og:type", "website")}`,
    ` ${meta("property", "og:title", shell.title)}`,
    ` ${meta("property", "og:description", shell.description)}`,
    ` ${meta("property", "og:url", canonicalUrl)}`,
    ` ${meta("property", "og:site_name", "ratstack.sh")}`,
    ` ${meta("property", "og:image", shell.ogImageUrl)}`,
    ` ${meta("property", "og:image:width", "1200")}`,
    ` ${meta("property", "og:image:height", "630")}`,
    ` ${meta("property", "og:image:type", "image/png")}`,
    ` ${meta("property", "og:image:alt", shell.description)}`,
    ` ${meta("name", "twitter:card", "summary_large_image")}`,
    ` ${meta("name", "twitter:title", shell.title)}`,
    ` ${meta("name", "twitter:description", shell.description)}`,
    ` ${meta("name", "twitter:image", shell.ogImageUrl)}`,
    ` <link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}">`,
    ` ${shell.discoveryLinks
      .map(
        (link) =>
          `<link rel="${escapeHtmlAttribute(link.rel)}" type="${escapeHtmlAttribute(link.type)}" href="${escapeHtmlAttribute(link.href)}">`
      )
      .join("")}`,
    ' <link rel="icon" href="/favicon.ico" sizes="48x48">',
    ' <link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    ' <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    `<title>${escapeHtmlText(shell.title)}</title>`,
  ].join("");

  const pointer = shell.path === "/tokenmaxx" ? "" : shell.agentPointerHtml;

  const breadcrumb =
    shell.breadcrumbHref !== undefined &&
    shell.breadcrumbHref !== "" &&
    shell.breadcrumbLabel !== undefined &&
    shell.breadcrumbLabel !== "" &&
    shell.breadcrumbName !== undefined &&
    shell.breadcrumbName !== ""
      ? `<nav aria-label="Breadcrumb" class="breadcrumb"><a href="${escapeHtmlAttribute(shell.breadcrumbHref)}">${escapeHtmlText(shell.breadcrumbLabel)}</a> / ${escapeHtmlText(shell.breadcrumbName)}</nav>`
      : "";

  const body = `${siteNavigation} <main data-path="${escapeHtmlAttribute(shell.path)}">${pointer} ${shell.houseAdHtml ?? ""} ${breadcrumb} ${shell.bodyHtml}</main> ${siteFooter}`;

  return { body, head };
};
