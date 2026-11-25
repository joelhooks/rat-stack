import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export { ogImagePath } from "./coverage.ts";

export interface OgPage {
  readonly description: string;
  readonly routePath: `/${string}`;
  readonly title: string;
}

export const ogAssets = {
  bold: new URL("../assets/fonts/JetBrainsMono-Bold.ttf", import.meta.url),
  emoji: new URL("../assets/emoji/1f400.svg", import.meta.url),
  regular: new URL(
    "../assets/fonts/JetBrainsMono-Regular.ttf",
    import.meta.url
  ),
};

export const cleanOgEmoji = (svg: string) =>
  svg.replaceAll(/<!--[\s\S]*?-->/gu, "").trim();

const makeOgElement = (page: OgPage, emojiDataUrl: string) => ({
  key: null,
  props: {
    children: [
      {
        key: null,
        props: {
          children: page.title,
          style: {
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
          },
        },
        type: "div",
      },
      {
        key: null,
        props: {
          children: page.description,
          style: {
            fontSize: 30,
            lineHeight: 1.35,
            marginTop: 24,
            maxWidth: 1000,
          },
        },
        type: "div",
      },
      {
        key: null,
        props: {
          src: emojiDataUrl,
          style: {
            bottom: 64,
            height: 96,
            position: "absolute",
            right: 64,
            width: 96,
          },
        },
        type: "img",
      },
    ],
    style: {
      backgroundColor: "#ffffff",
      boxSizing: "border-box",
      color: "#000000",
      display: "flex",
      flexDirection: "column",
      height: 630,
      padding: 80,
      position: "relative",
      width: 1200,
    },
  },
  type: "div",
});

export const renderOgSvg = (
  page: OgPage,
  emojiSvg: string,
  regularFont: Buffer,
  boldFont: Buffer
) =>
  satori(
    makeOgElement(
      page,
      `data:image/png;base64,${Buffer.from(new Resvg(emojiSvg, { fitTo: { mode: "width", value: 96 } }).render().asPng()).toString("base64")}`
    ),
    {
      embedFont: true,
      fonts: [
        { data: regularFont, name: "JetBrains Mono", weight: 400 },
        { data: boldFont, name: "JetBrains Mono", weight: 700 },
      ],
      height: 630,
      width: 1200,
    }
  );

export const renderOgPng = (svg: string) =>
  new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();

export const renderRatPng = (
  ratSvg: string,
  size: number,
  background?: string
) => {
  const options = {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  } as const;

  return new Resvg(
    ratSvg,
    background === undefined ? options : { ...options, background }
  )
    .render()
    .asPng();
};
