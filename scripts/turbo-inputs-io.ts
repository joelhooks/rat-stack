// @effect-diagnostics-next-line nodeBuiltinImport:off -- Root has no @effect/platform-node dependency; this adapter owns the coverage CLI process boundary.
import { execFileSync } from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Root has no @effect/platform-node dependency; this adapter owns coverage and fixture filesystem operations.
import * as fs from "node:fs";
import os from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Root has no @effect/platform-node dependency; this adapter owns platform path resolution.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} = fs;

export {
  execFileSync,
  existsSync,
  fileURLToPath,
  globSync,
  mkdirSync,
  mkdtempSync,
  os,
  path,
  pathToFileURL,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
};
