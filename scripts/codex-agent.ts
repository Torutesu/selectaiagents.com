import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createCodexBridge, codexRunner } from "./lib/codex-bridge";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("This bridge is for local development only");
  const token = process.env.CODEX_AGENT_TOKEN ?? "";
  const workspace = resolve(
    process.env.CODEX_AGENT_WORKSPACE ?? "examples/codex-agent",
  );
  if (!(await stat(workspace)).isDirectory())
    throw new Error("CODEX_AGENT_WORKSPACE must be a directory");
  const port = Number(process.env.CODEX_AGENT_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid CODEX_AGENT_PORT");
  const bridge = createCodexBridge({
    token,
    timeoutMs: Number(process.env.CODEX_AGENT_TIMEOUT_MS ?? 110000),
    run: codexRunner({
      binary:
        process.env.CODEX_BIN ||
        process.env.CODEX_APP_RUNTIME_CLI_PATH ||
        "codex",
      workspace,
    }),
    onResult: (event) => console.log(JSON.stringify(event)),
  });
  bridge.server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  bridge.server.listen(port, "127.0.0.1", () =>
    console.log(
      `Local Codex agent: http://127.0.0.1:${port}/run (saved ChatGPT sign-in; read-only workspace)`,
    ),
  );
  process.once("SIGINT", bridge.stop);
  process.once("SIGTERM", bridge.stop);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
