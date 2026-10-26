export const PUBLIC_TIMEOUT_MS = 20_000;
export const LOCAL_TIMEOUT_MS = 120_000;

export function isLoopbackEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function localUpstreamEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.NODE_ENV === "development" && env.ALLOW_LOCAL_UPSTREAM === "true";
}

/** Recheck at execution as well as submission/approval: configs can outlive an environment. */
export function validateExecutionTimeout(
  config: { url: string; timeoutMs: number },
  env: Record<string, string | undefined> = process.env,
) {
  const max =
    localUpstreamEnabled(env) && isLoopbackEndpoint(config.url)
      ? LOCAL_TIMEOUT_MS
      : PUBLIC_TIMEOUT_MS;
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > max
  )
    throw new Error(
      `Response timeout must be between 0.1 and ${max / 1000} seconds in this environment.`,
    );
}
