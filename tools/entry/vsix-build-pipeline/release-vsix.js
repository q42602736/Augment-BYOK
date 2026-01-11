#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureDir, readJson, writeJson, writeText } = require("../../atom/common/fs");

function run(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  if (typeof r.status === "number" && r.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`);
}

function parseArgs(argv) {
  const out = {
    outDir: "",
    skipAudit: false,
    withRelay: false,
    relayProfile: "",
    relayBaseUrl: "",
    relayToken: "",
    relayTokenEnv: "",
    relayTimeoutMs: 0
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out-dir") out.outDir = argv[++i] || "";
    else if (a === "--skip-audit") out.skipAudit = true;
    else if (a === "--with-relay") out.withRelay = true;
    else if (a === "--relay-profile") out.relayProfile = argv[++i] || "";
    else if (a === "--relay-base-url") out.relayBaseUrl = argv[++i] || "";
    else if (a === "--relay-token") out.relayToken = argv[++i] || "";
    else if (a === "--relay-token-env") out.relayTokenEnv = argv[++i] || "";
    else if (a === "--relay-timeout-ms") {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) out.relayTimeoutMs = v;
    }
  }
  return out;
}

function formatTimestampForPath(now) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return (
    String(now.getUTCFullYear()) +
    pad2(now.getUTCMonth() + 1) +
    pad2(now.getUTCDate()) +
    "T" +
    pad2(now.getUTCHours()) +
    pad2(now.getUTCMinutes()) +
    pad2(now.getUTCSeconds()) +
    "Z"
  );
}

function sha256FileHex(filePath) {
  const buf = fs.readFileSync(filePath);
  return { hex: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function findLatestVsix({ repoRoot, distDir }) {
  if (!fs.existsSync(distDir)) throw new Error(`missing dist dir: ${path.relative(repoRoot, distDir)}`);
  const candidates = fs
    .readdirSync(distDir)
    .filter((n) => n.endsWith(".vsix") && n.includes(".byok-internal."))
    .map((name) => {
      const abs = path.join(distDir, name);
      const st = fs.statSync(abs);
      return { name, abs, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) throw new Error("no VSIX found in dist/ (run: pnpm build:vsix)");
  return candidates[0];
}

function parseUpstreamVersionFromVsixName(name) {
  const m = name.match(/^augment\.vscode-augment\.(.+)\.byok-internal\.vsix$/);
  return m ? m[1] : "";
}

function extractPatchInfoFromModules({ repoRoot }) {
  const patchModules = [
    "tools/mol/vsix-patch-set/patch-extension-entry.js",
    "tools/mol/vsix-patch-set/patch-api-token-preserve-case.js",
    "tools/mol/vsix-patch-set/patch-api-endpoint-strip-leading-slash.js",
    "tools/mol/vsix-patch-set/patch-upstream-config-override.js",
    "tools/mol/vsix-patch-set/patch-prompt-enhancer-third-party-override.js",
    "tools/mol/vsix-patch-set/patch-secrets-local-store.js",
    "tools/mol/vsix-patch-set/patch-llm-endpoint-router.js",
    "tools/mol/vsix-patch-set/patch-settings-memories.js",
    "tools/mol/vsix-patch-set/patch-settings-secrets.js",
    "tools/mol/vsix-patch-set/patch-package-json-byok-panel-command.js",
    "tools/mol/vsix-patch-set/patch-expose-tooling.js",
    "tools/mol/vsix-patch-set/patch-suggested-questions-content-guard.js",
    "tools/mol/vsix-patch-set/patch-main-panel-error-overlay.js",
    "tools/mol/vsix-patch-set/patch-subscription-banner-nonfatal.js",
    "tools/mol/vsix-patch-set/patch-webview-message-timeout-guard.js"
  ];

  const markers = [];
  const modulesWithoutMarker = [];
  for (const rel of patchModules) {
    const p = path.join(repoRoot, rel);
    if (!fs.existsSync(p)) throw new Error(`missing patch module: ${rel}`);
    const src = fs.readFileSync(p, "utf8");
    const m = src.match(/const\s+MARKER\s*=\s*["']([^"']+)["']\s*;/);
    if (!m) modulesWithoutMarker.push(rel);
    else markers.push(m[1]);
  }

  return { patchModules, markers: Array.from(new Set(markers)).sort(), modulesWithoutMarker };
}

function maybeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJson(filePath);
  } catch {
    return null;
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));

  const cacheReportsDir = path.join(repoRoot, ".cache", "reports");
  const upstreamAnalysisPath = path.join(cacheReportsDir, "upstream-analysis.json");
  const endpointCoverageJsonPath = path.join(cacheReportsDir, "endpoint-coverage.report.json");
  const endpointCoverageMdPath = path.join(cacheReportsDir, "endpoint-coverage.report.md");

  console.log(`[release] build:vsix`);
  run("pnpm", ["build:vsix"], { cwd: repoRoot });

  if (!args.skipAudit) {
    console.log(`[release] upstream:analyze`);
    run("pnpm", ["upstream:analyze"], { cwd: repoRoot });
    console.log(`[release] check:matrix`);
    run("pnpm", ["check:matrix"], { cwd: repoRoot });
  } else {
    console.log(`[release] skip audit (--skip-audit)`);
  }

  if (args.withRelay) {
    const relayArgs = [];
    if (args.relayProfile) relayArgs.push("--profile", args.relayProfile);
    if (args.relayBaseUrl) relayArgs.push("--base-url", args.relayBaseUrl);
    if (args.relayToken) relayArgs.push("--token", args.relayToken);
    if (args.relayTokenEnv) relayArgs.push("--token-env", args.relayTokenEnv);
    if (args.relayTimeoutMs) relayArgs.push("--timeout-ms", String(args.relayTimeoutMs));
    console.log(`[release] test:relay (${relayArgs.length ? "custom args" : "default args"})`);
    run("node", ["tools/entry/relay-profiles/relay-smoke.js", ...relayArgs], { cwd: repoRoot });
  }

  const distDir = path.join(repoRoot, "dist");
  const vsix = findLatestVsix({ repoRoot, distDir });

  const upstreamVersion = (() => {
    const report = maybeReadJson(upstreamAnalysisPath);
    const fromReport = typeof report?.upstream?.version === "string" ? report.upstream.version : "";
    if (fromReport) return fromReport;
    const fromName = parseUpstreamVersionFromVsixName(vsix.name);
    if (fromName) return fromName;
    return "unknown";
  })();

  const now = new Date();
  const tsPath = formatTimestampForPath(now);
  const releasesRoot = args.outDir ? path.resolve(repoRoot, args.outDir) : path.join(distDir, "releases");
  const releaseDir = path.join(releasesRoot, upstreamVersion, tsPath);
  ensureDir(releaseDir);

  const vsixOutPath = path.join(releaseDir, vsix.name);
  copyFile(vsix.abs, vsixOutPath);

  const sha = sha256FileHex(vsixOutPath);
  const shaPath = path.join(releaseDir, `${vsix.name}.sha256`);
  writeText(shaPath, `${sha.hex}  ${vsix.name}\n`);

  const patchInfo = extractPatchInfoFromModules({ repoRoot });
  if (!patchInfo.markers.length) throw new Error("no patch markers extracted (expected at least one __augment_byok_* marker)");
  const markers = patchInfo.markers;

  const upstreamReport = maybeReadJson(upstreamAnalysisPath);
  const coverageReport = maybeReadJson(endpointCoverageJsonPath);
  const reportSummary = {
    upstreamAnalysis: upstreamReport
      ? {
          path: path.relative(repoRoot, upstreamAnalysisPath),
          endpoints: upstreamReport?.stats?.endpointCount ?? (Array.isArray(upstreamReport?.endpoints) ? upstreamReport.endpoints.length : 0),
          contextKeys: Array.isArray(upstreamReport?.contextKeys) ? upstreamReport.contextKeys.length : 0,
          featureFlagsV1: Array.isArray(upstreamReport?.featureFlags?.v1) ? upstreamReport.featureFlags.v1.length : 0,
          featureFlagsV2: Array.isArray(upstreamReport?.featureFlags?.v2) ? upstreamReport.featureFlags.v2.length : 0
        }
      : null,
    endpointCoverage: coverageReport
      ? {
          pathJson: path.relative(repoRoot, endpointCoverageJsonPath),
          pathMd: fs.existsSync(endpointCoverageMdPath) ? path.relative(repoRoot, endpointCoverageMdPath) : "",
          referencedEndpointCount: coverageReport?.upstream?.referencedEndpointCount ?? 0,
          missingFromProfile: Array.isArray(coverageReport?.missingFromProfile) ? coverageReport.missingFromProfile.length : 0,
          missingFromProfileNotLlm: Array.isArray(coverageReport?.missingFromProfileNotLlm) ? coverageReport.missingFromProfileNotLlm.length : 0,
          missingFromProfileLlm: Array.isArray(coverageReport?.missingFromProfileLlm) ? coverageReport.missingFromProfileLlm.length : 0
        }
      : null
  };

  if (!args.skipAudit) {
    if (!fs.existsSync(upstreamAnalysisPath)) throw new Error(`missing upstream analysis report: ${path.relative(repoRoot, upstreamAnalysisPath)}`);
    if (!fs.existsSync(endpointCoverageJsonPath)) throw new Error(`missing endpoint coverage report: ${path.relative(repoRoot, endpointCoverageJsonPath)}`);
  }

  if (upstreamReport) copyFile(upstreamAnalysisPath, path.join(releaseDir, "upstream-analysis.json"));
  if (fs.existsSync(endpointCoverageJsonPath)) copyFile(endpointCoverageJsonPath, path.join(releaseDir, "endpoint-coverage.report.json"));
  if (fs.existsSync(endpointCoverageMdPath)) copyFile(endpointCoverageMdPath, path.join(releaseDir, "endpoint-coverage.report.md"));

  const manifest = {
    schemaVersion: 1,
    generatedAtMs: Date.now(),
    upstream: { publisher: "augment", extension: "vscode-augment", version: upstreamVersion },
    ci: {
      github: {
        repository: process.env.GITHUB_REPOSITORY || "",
        workflow: process.env.GITHUB_WORKFLOW || "",
        runId: process.env.GITHUB_RUN_ID || "",
        runNumber: process.env.GITHUB_RUN_NUMBER || "",
        sha: process.env.GITHUB_SHA || "",
        ref: process.env.GITHUB_REF || "",
        refName: process.env.GITHUB_REF_NAME || "",
        actor: process.env.GITHUB_ACTOR || ""
      }
    },
    artifacts: {
      vsix: { fileName: vsix.name, sha256: sha.hex, bytes: sha.bytes, sourceDistPath: path.relative(repoRoot, vsix.abs) },
      sha256: { fileName: path.basename(shaPath) }
    },
    patch: { markerCount: markers.length, markers, moduleCount: patchInfo.patchModules.length, modules: patchInfo.patchModules, modulesWithoutMarker: patchInfo.modulesWithoutMarker },
    reports: reportSummary,
    command: { argv: process.argv.slice(2), skipAudit: args.skipAudit, withRelay: args.withRelay },
    output: { releaseDir: path.relative(repoRoot, releaseDir) }
  };

  const manifestPath = path.join(releaseDir, "manifest.json");
  writeJson(manifestPath, manifest);

  console.log(`[release] VSIX: ${path.relative(repoRoot, vsixOutPath)}`);
  console.log(`[release] sha256: ${path.relative(repoRoot, shaPath)}`);
  console.log(`[release] manifest: ${path.relative(repoRoot, manifestPath)}`);
}

main().catch((err) => {
  console.error(`[release] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});

