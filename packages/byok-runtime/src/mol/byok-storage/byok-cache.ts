import { AUGMENT_BYOK } from "../../constants";
import { ensureTrailingSlash, normalizeString } from "../../atom/common/http";
import { asRecord } from "../../atom/common/object";
import { assertVscodeGlobalState } from "../../atom/common/vscode-storage";

type ProviderModelsCacheEntry = { baseUrl: string; updatedAtMs: number; models: string[] };
type ProviderModelsCacheV2 = { version: 2; providers: Record<string, ProviderModelsCacheEntry> };
type UpstreamGetModelsCacheEntry = { baseUrl: string; updatedAtMs: number; value: Record<string, any> };
type UpstreamGetModelsCacheV1 = { version: 1; entries: Record<string, UpstreamGetModelsCacheEntry> };

function normalizeBaseUrlKey(v: unknown): string {
  return ensureTrailingSlash(normalizeString(v));
}

function assertGlobalState(context: any): void {
  assertVscodeGlobalState(context, "BYOK cache ");
}

function normalizeProviderModelsCacheEntry(v: unknown): ProviderModelsCacheEntry | null {
  const r = asRecord(v);
  if (!r) return null;
  const baseUrl = normalizeString(r.baseUrl);
  const updatedAtMs = Number(r.updatedAtMs);
  const modelsRaw = Array.isArray(r.models) ? (r.models as unknown[]) : [];
  const models = modelsRaw.map(normalizeString).filter(Boolean);
  if (!baseUrl || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0 || !models.length) return null;
  return { baseUrl, updatedAtMs, models };
}

function normalizeModelsCacheV2(v: unknown): ProviderModelsCacheV2 {
  const r = asRecord(v) || {};
  const providersRaw = asRecord(r.providers) || {};
  const providers: Record<string, ProviderModelsCacheEntry> = {};
  for (const [k, vv] of Object.entries(providersRaw)) {
    const id = normalizeString(k);
    const entry = normalizeProviderModelsCacheEntry(vv);
    if (id && entry) providers[id] = entry;
  }
  return { version: 2, providers };
}

export async function loadProviderModelsCacheRaw({ context }: { context: any }): Promise<ProviderModelsCacheV2> {
  assertGlobalState(context);
  const stored = await context.globalState.get(AUGMENT_BYOK.byokModelsCacheGlobalStateKey);
  return normalizeModelsCacheV2(stored);
}

export async function getCachedProviderModels({
  context,
  providerId,
  baseUrl
}: {
  context: any;
  providerId: string;
  baseUrl: string;
}): Promise<ProviderModelsCacheEntry | null> {
  assertGlobalState(context);
  const pid = normalizeString(providerId);
  const b = normalizeBaseUrlKey(baseUrl);
  if (!pid || !b) return null;
  const cache = await loadProviderModelsCacheRaw({ context });
  const entry = cache.providers[pid] || null;
  if (!entry) return null;
  if (normalizeBaseUrlKey(entry.baseUrl) !== b) return null;
  return entry;
}

export async function saveCachedProviderModels({
  context,
  providerId,
  baseUrl,
  models
}: {
  context: any;
  providerId: string;
  baseUrl: string;
  models: string[];
}): Promise<void> {
  assertGlobalState(context);
  const pid = normalizeString(providerId);
  const b = normalizeBaseUrlKey(baseUrl);
  const list = Array.isArray(models) ? models.map(normalizeString).filter(Boolean) : [];
  if (!pid) throw new Error("缺少 providerId");
  if (!b) throw new Error("缺少 baseUrl");
  if (!list.length) throw new Error("models 为空");

  const cache = await loadProviderModelsCacheRaw({ context });
  cache.providers[pid] = { baseUrl: b, updatedAtMs: Date.now(), models: list };
  await context.globalState.update(AUGMENT_BYOK.byokModelsCacheGlobalStateKey, cache);
}

function normalizeUpstreamGetModelsCacheEntry(v: unknown): UpstreamGetModelsCacheEntry | null {
  const r = asRecord(v);
  if (!r) return null;
  const baseUrl = normalizeString(r.baseUrl);
  const updatedAtMs = Number(r.updatedAtMs);
  const value = asRecord(r.value);
  if (!baseUrl || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0 || !value) return null;
  return { baseUrl, updatedAtMs, value: value as Record<string, any> };
}

function normalizeUpstreamGetModelsCacheV1(v: unknown): UpstreamGetModelsCacheV1 {
  const r = asRecord(v) || {};
  const entriesRaw = asRecord(r.entries) || {};
  const entries: Record<string, UpstreamGetModelsCacheEntry> = {};
  for (const [k, vv] of Object.entries(entriesRaw)) {
    const key = normalizeBaseUrlKey(k);
    const entry = normalizeUpstreamGetModelsCacheEntry(vv);
    if (key && entry) entries[key] = entry;
  }
  return { version: 1, entries };
}

export async function loadUpstreamGetModelsCacheRaw({ context }: { context: any }): Promise<UpstreamGetModelsCacheV1> {
  assertGlobalState(context);
  const stored = await context.globalState.get(AUGMENT_BYOK.byokUpstreamGetModelsCacheGlobalStateKey);
  return normalizeUpstreamGetModelsCacheV1(stored);
}

export async function getCachedUpstreamGetModels({
  context,
  baseUrl,
  maxAgeMs
}: {
  context: any;
  baseUrl: string;
  maxAgeMs: number;
}): Promise<UpstreamGetModelsCacheEntry | null> {
  assertGlobalState(context);
  const b = normalizeBaseUrlKey(baseUrl);
  if (!b) return null;
  const cache = await loadUpstreamGetModelsCacheRaw({ context });
  const entry = cache.entries[b] || null;
  if (!entry) return null;
  if (normalizeBaseUrlKey(entry.baseUrl) !== b) return null;
  const ageMs = Date.now() - entry.updatedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return null;
  return entry;
}

export async function saveCachedUpstreamGetModels({
  context,
  baseUrl,
  value
}: {
  context: any;
  baseUrl: string;
  value: any;
}): Promise<void> {
  assertGlobalState(context);
  const b = normalizeBaseUrlKey(baseUrl);
  const v = asRecord(value);
  if (!b) throw new Error("缺少 baseUrl");
  if (!v) throw new Error("value 不是对象");
  const cache = await loadUpstreamGetModelsCacheRaw({ context });
  cache.entries[b] = { baseUrl: b, updatedAtMs: Date.now(), value: v as Record<string, any> };
  await context.globalState.update(AUGMENT_BYOK.byokUpstreamGetModelsCacheGlobalStateKey, cache);
}
