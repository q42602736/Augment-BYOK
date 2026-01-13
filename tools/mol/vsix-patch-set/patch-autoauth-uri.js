#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_autoauth_patched";

function inferSessionsAndEmailExpr(content) {
  const m1 = content.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*"augment\.sessions"/);
  const sessionsExpr = m1 ? m1[1] : '"augment.sessions"';
  const m2 = content.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\[\s*"email"\s*\]/);
  const emailExpr = m2 ? m2[1] : '["email"]';
  return { sessionsExpr, emailExpr };
}

function injectAutoAuthCase(content) {
  if (content.includes('case "/autoAuth"')) return content;

  const p1 = /(case[^:]*:[^}]*handleAuthURI[^}]*break;)/g;
  const m1 = Array.from(content.matchAll(p1));
  if (m1.length === 1) {
    const caseBlock = m1[0][1];
    const call = caseBlock.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\.\s*handleAuthURI\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/);
    const obj = call ? call[1] : "this";
    const param = call ? call[2] : "e";
    const newCase = `case "/autoAuth":${obj}.handleAutoAuth(${param});break;`;
    const end = m1[0].index + caseBlock.length;
    return content.slice(0, end) + newCase + content.slice(end);
  }

  if (m1.length > 1) throw new Error(`failed to inject autoAuth case: ambiguous handleAuthURI case blocks matched=${m1.length}`);

  const p2 = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\.\s*handleAuthURI\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)[^}]*break;/g;
  const m2 = Array.from(content.matchAll(p2));
  if (m2.length === 1) {
    const obj = m2[0][1];
    const param = m2[0][2];
    const newCase = `case "/autoAuth":${obj}.handleAutoAuth(${param});break;`;
    const end = m2[0].index + m2[0][0].length;
    return content.slice(0, end) + newCase + content.slice(end);
  }
  if (m2.length > 1) throw new Error(`failed to inject autoAuth case: ambiguous handleAuthURI calls matched=${m2.length}`);

  const p3 = /(handleAuthURI[^}]*break;)/;
  const m3 = content.match(p3);
  if (!m3) throw new Error("failed to inject autoAuth case: handleAuthURI break block not found");
  return content.replace(p3, `$1case "/autoAuth":this.handleAutoAuth(e);break;`);
}

function injectAutoAuthMethod(content, { sessionsExpr, emailExpr }) {
  if (content.includes("handleAutoAuth")) return content;

  const newMethod =
    "async handleAutoAuth(e){" +
    "try{" +
    "const p=new URLSearchParams(e.query);" +
    "const accessToken=p.get('token');" +
    "const tenantURL=p.get('url');" +
    "if(!accessToken||!tenantURL)throw new Error('autoAuth 缺少 token/url');" +
    `await this._context.secrets.store(${sessionsExpr},JSON.stringify({accessToken,tenantURL,scopes:${emailExpr}}));` +
    `await require(\"./byok/mol/byok-storage/byok-config\").applyAutoAuthToByokProxy({context:this._context,token:accessToken,baseUrl:tenantURL});` +
    "try{this._sessionChangeEmitter&&typeof this._sessionChangeEmitter.fire==='function'&&this._sessionChangeEmitter.fire({accessToken,tenantURL,scopes:" +
    `${emailExpr}` +
    "})}catch{}" +
    "try{console.log('[AUTO-AUTH] 自动认证完成')}catch{}" +
    "}catch(err){" +
    "try{console.log('[AUTO-AUTH] 自动认证失败:',err&&err.message?err.message:String(err))}catch{}" +
    "try{this._logger&&typeof this._logger.warn==='function'&&this._logger.warn('Failed to process auth request:',err)}catch{}" +
    "}" +
    "}";

  const p = /(async\s+handleAuthURI[^{]*\{(?:[^{}]|\{[^{}]*\})*\})/g;
  const matches = Array.from(content.matchAll(p));
  if (matches.length !== 1) throw new Error(`failed to locate handleAuthURI method for autoAuth injection: matched=${matches.length}`);
  const m = matches[0];
  const idx = m.index + m[0].length;
  return content.slice(0, idx) + newMethod + content.slice(idx);
}

function patchAutoAuthUri(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const { sessionsExpr, emailExpr } = inferSessionsAndEmailExpr(original);
  let next = original;
  next = injectAutoAuthCase(next);
  next = injectAutoAuthMethod(next, { sessionsExpr, emailExpr });

  if (!next.includes('case "/autoAuth"')) throw new Error('autoAuth patch failed: missing case "/autoAuth"');
  if (!next.includes("handleAutoAuth")) throw new Error("autoAuth patch failed: missing handleAutoAuth");

  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchAutoAuthUri };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchAutoAuthUri(p);
}
