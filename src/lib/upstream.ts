import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import type { EndpointConfig } from "./endpoint-config";
import { validateExecutionTimeout } from "./endpoint-timeout";

export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function targetAddresses(raw: string) {
  const url = new URL(raw);
  const local =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_LOCAL_UPSTREAM === "true" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (!local && (url.protocol !== "https:" || (url.port && url.port !== "443")))
  )
    throw new Error("Unsafe upstream URL");
  const allowed = (process.env.ROUTER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase());
  if (!local && !allowed.includes(url.hostname.toLowerCase()))
    throw new Error("Upstream host has not been approved");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 3000);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (
    !addresses.length ||
    (!local && addresses.some((a) => !publicAddress(a.address)))
  )
    throw new Error("Upstream must resolve to public IPs");
  return { url, addresses };
}

export async function forward(
  config: EndpointConfig,
  input: unknown,
  requestId: string,
): Promise<unknown> {
  validateExecutionTimeout(config);
  const { url, addresses } = await targetAddresses(config.url);
  const credential = config.credentialEnv
    ? process.env[config.credentialEnv]
    : undefined;
  if (config.credentialEnv && !credential)
    throw new Error("Maker credential is unavailable");
  // Pin validated DNS results to the connection, closing the DNS rebinding gap.
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    },
  });
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    const body =
      config.adapter === "openai"
        ? { ...(input as object), model: config.upstreamModel, stream: false }
        : input;
    const response = await fetch(url, {
      method: "POST",
      dispatcher,
      redirect: "manual",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId,
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Upstream rejected the request");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty upstream response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new Error("Upstream response is too large");
      }
      chunks.push(value);
    }
    const output = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (config.adapter === "openai")
      return { content: output?.choices?.[0]?.message?.content };
    return output;
  } finally {
    await dispatcher.close();
  }
}
