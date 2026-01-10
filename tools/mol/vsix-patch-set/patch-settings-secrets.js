#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_settings_secrets_webview_patched";

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listSettingsAssets(assetsDir) {
  try {
    return fs
      .readdirSync(assetsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => n.startsWith("settings-") && n.endsWith(".js"))
      .map((n) => path.join(assetsDir, n));
  } catch {
    return [];
  }
}

function findIdeApiSymbolFromMemoriesPage(src, locatorFn) {
  const idx = src.indexOf("loadMemoriesFile");
  if (idx < 0) return null;
  const windowStart = Math.max(0, idx - 400);
  const window = src.slice(windowStart, idx);
  const re = new RegExp(`${escapeRegExp(locatorFn)}\\(([A-Za-z0-9_$]+)\\)`, "g");
  let last = null;
  for (const m of window.matchAll(re)) last = m;
  return last ? last[1] : null;
}

function patchFile(filePath, { checkOnly }) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { filePath, changed: false, patched: true, reason: "already_patched" };

  const listIdx = original.indexOf("listUserSecrets({includeValues:!1})");
  if (listIdx < 0) return { filePath, changed: false, patched: false, reason: "no_secrets_block" };

  const start = original.lastIndexOf("const ", listIdx);
  if (start < 0) throw new Error(`secrets webview patch: failed to locate block start (const ...) in ${path.basename(filePath)}`);
  const end = original.indexOf("}};", listIdx);
  if (end < 0) throw new Error(`secrets webview patch: failed to locate block end (}};) in ${path.basename(filePath)}`);

  const block = original.slice(start, end + 3);
  if (!block.includes("=new class{async loadSecrets") || !block.includes("listUserSecrets") || !block.includes("upsertUserSecret") || !block.includes("deleteUserSecret")) {
    throw new Error(`secrets webview patch: unexpected secrets block in ${path.basename(filePath)} (upstream may have changed)`);
  }

  const varMatch = block.match(/const\s+([A-Za-z0-9_$]+)=new class\{/);
  if (!varMatch) throw new Error(`secrets webview patch: failed to extract service var name in ${path.basename(filePath)}`);
  const serviceVar = varMatch[1];

  const locatorMatch = block.match(/await\(await\s*([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)\)\.listUserSecrets/);
  if (!locatorMatch) throw new Error(`secrets webview patch: failed to extract locator fn in ${path.basename(filePath)}`);
  const locatorFn = locatorMatch[1];

  const mapMatch = block.match(/\.map\(\(e=>\s*([A-Za-z0-9_$]+)\(e\)\)\)/);
  if (!mapMatch) throw new Error(`secrets webview patch: failed to extract secret mapper fn in ${path.basename(filePath)}`);
  const mapFn = mapMatch[1];

  const ideApiSym = findIdeApiSymbolFromMemoriesPage(original, locatorFn);
  if (!ideApiSym) throw new Error(`secrets webview patch: failed to detect IDE API symbol from memories page in ${path.basename(filePath)}`);

  const replacement =
    `const ${serviceVar}=new class{async loadSecrets(){return((await(await ${locatorFn}(${ideApiSym})).listSecrets({})).secrets||[]).filter((e=>e!=null)).map((e=>${mapFn}(e)))}async createSecret(i){const e=await ${locatorFn}(${ideApiSym}),r=await e.createSecret({name:i.name,value:i.value,tags:i.tags,description:i.description});if(!r.secret)throw new Error(\"Failed to create secret: no secret returned\");return ${mapFn}(r.secret)}async updateSecret(i){const e=await ${locatorFn}(${ideApiSym}),r=await e.updateSecret({name:i.name,value:i.value,tags:i.tags,description:i.description,expectedVersion:i.expectedVersion??\"\"});return{updatedAt:r.updatedAt??new Date().toISOString(),version:r.version||\"\",valueSizeBytes:i.value?new TextEncoder().encode(i.value).length:void 0}}async deleteSecret(i){if(!(await(await ${locatorFn}(${ideApiSym})).deleteSecret({name:i})).deleted)throw new Error(\"Failed to delete secret\")}};`;

  const next = original.slice(0, start) + replacement + original.slice(end + 3);
  const patched = next.includes(`${serviceVar}=new class{async loadSecrets`) && next.includes(".listSecrets") && next.includes(".createSecret") && next.includes(".updateSecret") && next.includes(".deleteSecret");
  if (checkOnly) {
    if (!patched) throw new Error(`Settings Secrets patch missing in ${path.basename(filePath)}`);
    return { filePath, changed: false, patched: true, reason: "check_only_ok" };
  }

  const out = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, out, "utf8");
  if (!out.includes(MARKER) || !patched) throw new Error(`Settings Secrets patch failed for ${path.basename(filePath)}`);
  return { filePath, changed: true, patched: true, reason: "patched" };
}

function patchSettingsSecretsWebview({ extensionDir, checkOnly }) {
  const assetsDir = path.join(extensionDir, "common-webviews", "assets");
  const files = listSettingsAssets(assetsDir);
  if (files.length === 0) throw new Error(`no settings assets found in ${assetsDir}`);

  const results = files.map((filePath) => patchFile(filePath, { checkOnly: Boolean(checkOnly) }));
  const patchedCount = results.filter((r) => r.patched).length;
  const changedCount = results.filter((r) => r.changed).length;
  if (patchedCount === 0) throw new Error(`Settings Secrets patch missed: patchedCount=0 (upstream may have changed; assetsDir=${assetsDir})`);
  return { ok: true, patchedCount, changedCount, total: results.length };
}

module.exports = { patchSettingsSecretsWebview };

if (require.main === module) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const dirFlag = args.findIndex((a) => a === "--extensionDir");
  const extensionDir = dirFlag >= 0 ? args[dirFlag + 1] : null;
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} --extensionDir <path-to-extension/> [--check]`);
    process.exit(2);
  }
  patchSettingsSecretsWebview({ extensionDir, checkOnly });
}
