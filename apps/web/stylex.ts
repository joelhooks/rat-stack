import stylexRollup from "@stylexjs/unplugin/rollup";
import stylexVite from "@stylexjs/unplugin/vite";
import { Predicate, Schema } from "effect";
import type { Plugin } from "vite";

const PluginSchema = Schema.declare<Plugin>(
  (value): value is Plugin =>
    Predicate.isObject(value) &&
    Predicate.hasProperty(value, "name") &&
    Predicate.isString(value.name)
);

const options = {
  runtimeInjection: false,
  useCSSLayers: { before: ["rat-base"] },
};

export const stylexRenderingPlugin = () =>
  Schema.decodeUnknownSync(PluginSchema)(stylexRollup(options));

export const stylexPlugin = () =>
  Schema.decodeUnknownSync(PluginSchema)(stylexVite(options));
