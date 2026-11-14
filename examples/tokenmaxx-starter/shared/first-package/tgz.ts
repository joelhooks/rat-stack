import { gunzipSync, gzipSync } from "node:zlib";

// Just enough tar for a catch-up package: regular files in a gzipped ustar
// archive, with fixed metadata (mode 644, owner 0, mtime 0), so the same files
// always pack to the same bytes. Plain Node, so unpacking needs no system
// `tar` (macOS's adds AppleDouble files; Windows may have none).

export type PackedFile = { readonly path: string; readonly content: Buffer };

const block = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** Throws on a path that could land outside the folder it's unpacked into. */
export function safePath(path: string): string {
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.length === 0 ||
    parts.some((p) => p === "..")
  ) {
    throw new Error(`unsafe path in archive: ${path}`);
  }
  return parts.join("/");
}

function header(path: string, size: number): Buffer {
  const name = Buffer.from(path, "utf8");
  if (name.length > 100) {
    throw new Error(`path too long for this archive: ${path}`);
  }
  const h = Buffer.alloc(block);
  name.copy(h, 0);
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(0, 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of h) {
    sum += byte;
  }
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}

/** Packs files (sorted by path) into gzipped ustar bytes. */
export function packTgz(files: readonly PackedFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    parts.push(header(safePath(file.path), file.content.length), file.content);
    const pad = (block - (file.content.length % block)) % block;
    parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(block * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

const field = (h: Buffer, start: number, length: number) =>
  h
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "");

/** The regular files in gzipped tar bytes. Directories and links are skipped. */
export function unpackTgz(bytes: Buffer): PackedFile[] {
  const tar = gunzipSync(bytes);
  const files: PackedFile[] = [];
  let at = 0;
  while (at + block <= tar.length) {
    const h = tar.subarray(at, at + block);
    if (h.every((byte) => byte === 0)) {
      break;
    }
    const size = Number.parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = field(h, 156, 1);
    const prefix = field(h, 345, 155);
    const name = field(h, 0, 100);
    const start = at + block;
    if (type === "0" || type === "") {
      files.push({
        path: safePath(prefix === "" ? name : `${prefix}/${name}`),
        content: Buffer.from(tar.subarray(start, start + size)),
      });
    }
    at = start + Math.ceil(size / block) * block;
  }
  return files;
}
