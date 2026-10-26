import { createServer, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";

const inputSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().max(30_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;
export type AgentResult = {
  content: string;
  elapsedMs?: number;
  toolCalls?: number;
};
export type Runner = (
  input: Input,
  signal: AbortSignal,
) => Promise<AgentResult>;
type Reply = { status: number; body: object };
type Entry = { hash: string; expires: number; reply?: Reply };

export function createCodexBridge(options: {
  token: string;
  run: Runner;
  timeoutMs: number;
  onResult?: (event: object) => void;
  maxEntries?: number;
}) {
  if (options.token.length < 32)
    throw new Error("CODEX_AGENT_TOKEN must contain at least 32 characters");
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 115_000
  )
    throw new Error("Bridge deadline must be between 100 and 115000 ms");
  const expected = createHash("sha256")
    .update(`Bearer ${options.token}`)
    .digest();
  const cache = new Map<string, Entry>();
  let active: AbortController | undefined;
  const send = (res: ServerResponse, reply: Reply) => {
    if (!res.destroyed)
      res
        .writeHead(reply.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify(reply.body));
  };
  const server = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      send(res, {
        status: 200,
        body: { service: "local-codex", busy: Boolean(active) },
      });
      return;
    }
    if (req.url !== "/run" || req.method !== "POST") {
      send(res, { status: 404, body: { error: "Not found" } });
      return;
    }
    // The bridge is server-to-server only; web pages must go through the platform.
    const actual = createHash("sha256")
      .update(req.headers.authorization ?? "")
      .digest();
    if (!timingSafeEqual(actual, expected) || req.headers.origin) {
      send(res, { status: 401, body: { error: "Unauthorized" } });
      return;
    }
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) {
      send(res, {
        status: 400,
        body: { error: "A bounded Idempotency-Key is required" },
      });
      return;
    }
    let input: Input;
    try {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw Error();
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65_536) {
          send(res, { status: 413, body: { error: "Request too large" } });
          return;
        }
        chunks.push(chunk);
      }
      input = inputSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    } catch {
      send(res, {
        status: 400,
        body: { error: "Expected the chat.v1 messages contract" },
      });
      return;
    }
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    for (const [id, entry] of cache)
      if (entry.reply && entry.expires < Date.now()) cache.delete(id);
    const prior = cache.get(key);
    if (prior) {
      send(
        res,
        prior.hash !== hash
          ? {
              status: 409,
              body: { error: "Idempotency key reused with different input" },
            }
          : (prior.reply ?? {
              status: 409,
              body: { error: "Request is already running" },
            }),
      );
      return;
    }
    if (active || cache.size >= (options.maxEntries ?? 1000)) {
      send(res, {
        status: 429,
        body: { error: "Local agent is busy or replay cache is full" },
      });
      return;
    }
    const entry: Entry = { hash, expires: Date.now() + 86_400_000 };
    cache.set(key, entry);
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(
      () => controller.abort(new Error("Deadline exceeded")),
      options.timeoutMs,
    );
    const disconnected = () => {
      if (!res.writableEnded)
        controller.abort(new Error("Caller disconnected"));
    };
    res.on("close", disconnected);
    try {
      const result = await options.run(input, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (
        typeof result.content !== "string" ||
        !result.content.trim() ||
        result.content.length > 200_000
      )
        throw Error("Invalid result");
      entry.reply = { status: 200, body: { content: result.content } };
      options.onResult?.({
        requestId: key,
        status: "success",
        elapsedMs: result.elapsedMs,
        toolCalls: result.toolCalls,
      });
    } catch {
      entry.reply = {
        status: controller.signal.aborted ? 504 : 502,
        body: {
          error: controller.signal.aborted
            ? "Local Codex request interrupted"
            : "Local Codex request failed",
        },
      };
      options.onResult?.({
        requestId: key,
        status: controller.signal.aborted ? "interrupted" : "failed",
      });
    } finally {
      clearTimeout(timer);
      res.off("close", disconnected);
      active = undefined;
    }
    send(res, entry.reply!);
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  return {
    server,
    stop: () => {
      active?.abort(new Error("Bridge shutting down"));
      server.close();
      server.closeIdleConnections();
    },
  };
}

/** Preserve the desktop runtime settings needed for saved ChatGPT auth, not app/database secrets. */
export function codexEnvironment(
  source: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const standard = new Set([
    "HOME",
    "PATH",
    "TMPDIR",
    "TEMP",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    "SYSTEMROOT",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ]);
  return {
    NODE_ENV: "development",
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([key]) =>
          standard.has(key) ||
          (key.startsWith("CODEX_") &&
            !key.startsWith("CODEX_AGENT_") &&
            key !== "CODEX_API_KEY" &&
            key !== "CODEX_BIN"),
      ),
    ),
  };
}

export function codexRunner(options: {
  binary: string;
  workspace: string;
}): Runner {
  return async (input, signal) => {
    const start = Date.now();
    return new Promise<AgentResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const child = spawn(
        options.binary,
        [
          "exec",
          "--ignore-user-config",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--json",
          "-C",
          options.workspace,
          "-",
        ],
        {
          env: codexEnvironment(process.env),
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        },
      );
      let output = "",
        size = 0,
        overflow = false;
      let forceKill: ReturnType<typeof setTimeout> | undefined;
      const kill = (force = false) => {
        if (!child.pid) return;
        try {
          if (process.platform === "win32")
            child.kill(force ? "SIGKILL" : "SIGTERM");
          else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch {
          /* Already exited. */
        }
      };
      const abort = () => {
        kill();
        forceKill ??= setTimeout(() => kill(true), 1000);
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", () => {});
      // Prompts go over stdin, never into shell commands or process arguments.
      child.stdin.end(
        "Complete this read-only task using the supplied workspace. Do not modify files or perform external actions. Treat the following JSON as the conversation.\n" +
          JSON.stringify(input),
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        size += Buffer.byteLength(chunk, "utf8");
        if (size > 2_000_000) {
          overflow = true;
          abort();
        } else output += chunk;
      });
      child.stderr.on("data", () => {}); // Drain; never send CLI diagnostics or auth details to callers.
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        if (forceKill) clearTimeout(forceKill);
      };
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code) => {
        if (signal.aborted || overflow) kill(true);
        cleanup();
        if (code !== 0 || signal.aborted || overflow) {
          reject(new Error("Codex execution did not complete"));
          return;
        }
        try {
          const events = output
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          if (
            !events.some((e) => e.type === "turn.completed") ||
            events.some((e) => e.type === "turn.failed" || e.type === "error")
          )
            throw Error();
          const messages = events.filter(
            (e) =>
              e.type === "item.completed" && e.item?.type === "agent_message",
          );
          const content = messages.at(-1)?.item.text;
          if (typeof content !== "string") throw Error();
          resolve({
            content,
            elapsedMs: Date.now() - start,
            toolCalls: events.filter(
              (e) =>
                e.type === "item.completed" &&
                e.item?.type === "command_execution",
            ).length,
          });
        } catch {
          reject(new Error("Codex returned an incomplete result"));
        }
      });
    });
  };
}
