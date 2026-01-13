#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_augment_interceptor_injected";

function patchAugmentInterceptorInject(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const repoRoot = path.resolve(__dirname, "../../..");
  const injectPath = path.join(repoRoot, "tools", "mol", "vsix-patch-set", "vendor", "inject-code.txt");
  if (!fs.existsSync(injectPath)) throw new Error(`missing inject source: ${path.relative(repoRoot, injectPath)}`);
  const code = fs.readFileSync(injectPath, "utf8");
  if (!code.includes("Augment Interceptor Injection Start")) throw new Error("inject-code source unexpected (missing header marker)");

  let next = `${code}\n;\n${original}`;
  next = ensureMarker(next, MARKER);

  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", injectPath };
}

module.exports = { patchAugmentInterceptorInject };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchAugmentInterceptorInject(p);
}
