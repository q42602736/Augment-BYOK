import { AUGMENT_BYOK } from "../constants";
import type { InstallArgs } from "../types";
import { registerByokPanel } from "../coord/byok-panel/register-byok-panel";
import { installSettingsMemoriesRpc } from "../coord/vsix-patch-set/install-settings-memories-rpc";
import { syncUpstreamConfigOverrideFromByokStorage } from "../mol/byok-storage/byok-config";

async function maybeInstallUpstreamConfigOverride({ vscode, context, logger }: { vscode: any; context: any; logger: any }): Promise<void> {
  try {
    await syncUpstreamConfigOverrideFromByokStorage({ context });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      logger.warn?.(`[BYOK] upstream config override skipped: ${msg}`);
    } catch {
      // ignore
    }
    try {
      vscode?.window?.showErrorMessage?.(`[Augment BYOK] 上游配置注入失败：${msg}`);
    } catch {
      // ignore
    }
  }
}

export function install({ vscode, getActivate, setActivate }: InstallArgs): void {
  if (typeof getActivate !== "function" || typeof setActivate !== "function") return;
  if ((globalThis as any)[AUGMENT_BYOK.patchedGlobalKey]) return;

  const originalActivate = getActivate();
  if (typeof originalActivate !== "function") return;
  (globalThis as any)[AUGMENT_BYOK.patchedGlobalKey] = true;

  setActivate(async (context: any) => {
    const logger = console;
    try {
      (globalThis as any)[AUGMENT_BYOK.extensionContextGlobalKey] = context;
    } catch {
      // ignore
    }
    await maybeInstallUpstreamConfigOverride({ vscode, context, logger });
    installSettingsMemoriesRpc({ vscode, context, logger });
    registerByokPanel({ vscode, context, logger });
    return await (originalActivate as any)(context);
  });
}
