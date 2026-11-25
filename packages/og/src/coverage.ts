export const ogImagePath = (route: string): `/${string}` =>
  `/og${route === "/" ? "/home" : route}.png`;

export type OgMetaContents = (
  attribute: "name" | "property",
  key: string
) => readonly string[];

export const ogMetadataProblems = (
  route: string,
  origin: string,
  contents: OgMetaContents
) => {
  const [image] = contents("property", "og:image");
  const prefix = `${origin}${ogImagePath(route)}?v=`;

  const expected = [
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:type", "image/png"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:image", image],
  ] as const;

  const [alt] = contents("property", "og:image:alt");

  return [
    ...(!/^https?:\/\//u.test(origin) ||
    image === undefined ||
    !image.startsWith(prefix) ||
    !/^[0-9a-f]{16,64}$/u.test(image.slice(prefix.length)) ||
    contents("property", "og:image").length !== 1
      ? ["og:image (absolute route image URL with ?v= hash)"]
      : []),
    ...(alt === undefined ||
    alt.trim() === "" ||
    contents("property", "og:image:alt").length !== 1
      ? ["og:image:alt (nonempty)"]
      : []),
    ...expected.flatMap(([attribute, key, value]) => {
      const values = contents(attribute, key);

      return values.length === 1 && values[0] === value ? [] : [key];
    }),
  ];
};

export const hasOgPngDimensions = (bytes: Uint8Array) => {
  if (bytes.byteLength < 33) {
    return false;
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return (
    header.getUint32(0) === 0x89_50_4e_47 &&
    header.getUint32(4) === 0x0d_0a_1a_0a &&
    header.getUint32(8) === 13 &&
    header.getUint32(12) === 0x49_48_44_52 &&
    header.getUint32(16) === 1200 &&
    header.getUint32(20) === 630
  );
};
