export function assertVscodeGlobalState(context: any, subject: string): void {
  const ok = context?.globalState && typeof context.globalState.get === "function" && typeof context.globalState.update === "function";
  if (!ok) throw new Error(`${subject}不可用（缺少 globalState）`);
}

export function assertVscodeSecrets(context: any, subject: string): void {
  const ok =
    context?.secrets && typeof context.secrets.get === "function" && typeof context.secrets.store === "function" && typeof context.secrets.delete === "function";
  if (!ok) throw new Error(`${subject}不可用（缺少 secrets）`);
}

export function assertVscodeContextStorage(context: any, subject: string): void {
  const okGlobalState = context?.globalState && typeof context.globalState.get === "function" && typeof context.globalState.update === "function";
  const okSecrets =
    context?.secrets && typeof context.secrets.get === "function" && typeof context.secrets.store === "function" && typeof context.secrets.delete === "function";
  if (!okGlobalState || !okSecrets) throw new Error(`${subject}不可用（缺少 globalState / secrets）`);
}
