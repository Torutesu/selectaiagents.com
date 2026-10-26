import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexBridge,
  codexEnvironment,
  codexRunner,
  type Runner,
} from "../scripts/lib/codex-bridge";
import { validateExecutionTimeout } from "../src/lib/endpoint-timeout";
import { forward } from "../src/lib/upstream";
import {
  CHAT_INPUT,
  CHAT_OUTPUT,
  validateConfig,
  endpointConfigSchema,
} from "../src/lib/endpoint-config";

const token = "test-only-token-with-at-least-32-characters";
const body = { messages: [{ role: "user", content: "hello" }] };
async function harness(run: Runner, timeoutMs = 1000) {
  const bridge = createCodexBridge({ token, run, timeoutMs });
  bridge.server.listen(0, "127.0.0.1");
  await once(bridge.server, "listening");
  const address = bridge.server.address();
  assert.ok(address && typeof address !== "string");
  const post = (
    key: string,
    value: unknown = body,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${address.port}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...headers,
      },
      body: JSON.stringify(value),
    });
  return { ...bridge, post, address };
}
test("bridge rejects unauthorized/browser/invalid requests before execution", async () => {
  let calls = 0;
  const h = await harness(async () => {
    calls++;
    return { content: "ok" };
  });
  try {
    assert.equal(
      (await h.post("auth", body, { Authorization: "Bearer wrong" })).status,
      401,
    );
    assert.equal(
      (await h.post("browser", body, { Origin: "http://evil.test" })).status,
      401,
    );
    assert.equal((await h.post("bad", { messages: [] })).status, 400);
    assert.equal(
      (
        await h.post("large", {
          messages: [{ role: "user", content: "x".repeat(70000) }],
        })
      ).status,
      413,
    );
    assert.equal(calls, 0);
  } finally {
    h.stop();
  }
});
test("bridge deduplicates running and completed requests and rejects conflicting replays", async () => {
  let calls = 0;
  let finish!: (r: { content: string }) => void;
  const h = await harness(async () => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  try {
    const first = h.post("same");
    while (!finish) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await h.post("same")).status, 409);
    assert.equal((await h.post("other")).status, 429);
    finish({ content: "actual output" });
    assert.equal((await first).status, 200);
    assert.deepEqual(await (await h.post("same")).json(), {
      content: "actual output",
    });
    assert.equal(
      (
        await h.post("same", {
          messages: [{ role: "user", content: "different" }],
        })
      ).status,
      409,
    );
    assert.equal(calls, 1);
  } finally {
    h.stop();
  }
});
test("bridge aborts deadline failures and caches them without reexecution", async () => {
  let calls = 0,
    aborted = false;
  const h = await harness(async (_input, signal) => {
    calls++;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(Error("stop"));
      }),
    );
  }, 100);
  try {
    assert.equal((await h.post("timeout")).status, 504);
    assert.ok(aborted);
    assert.equal((await h.post("timeout")).status, 504);
    assert.equal(calls, 1);
  } finally {
    h.stop();
  }
});
test("disconnect aborts a running local task", async () => {
  let started = false,
    aborted = false;
  const h = await harness(async (_input, signal) => {
    started = true;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(Error("stop"));
      }),
    );
  });
  try {
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${h.address.port}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "disconnect",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {});
    while (!started) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await pending;
    for (let i = 0; i < 50 && !aborted; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(aborted);
  } finally {
    h.stop();
  }
});
test("local timeouts need explicit development opt-in; production/public remain capped", () => {
  const local = { url: "http://127.0.0.1:3210/run", timeoutMs: 120000 };
  validateExecutionTimeout(local, {
    NODE_ENV: "development",
    ALLOW_LOCAL_UPSTREAM: "true",
  });
  for (const env of [
    { NODE_ENV: "production", ALLOW_LOCAL_UPSTREAM: "true" },
    { NODE_ENV: "development", ALLOW_LOCAL_UPSTREAM: "false" },
    { NODE_ENV: "test", ALLOW_LOCAL_UPSTREAM: "true" },
  ])
    assert.throws(() => validateExecutionTimeout(local, env));
  for (const url of [
    "https://example.test/run",
    "http://127.0.0.1.evil.test/run",
    "file:///run",
  ])
    assert.throws(() =>
      validateExecutionTimeout(
        { ...local, url },
        { NODE_ENV: "development", ALLOW_LOCAL_UPSTREAM: "true" },
      ),
    );
  assert.throws(() =>
    validateExecutionTimeout(
      { ...local, timeoutMs: 120001 },
      { NODE_ENV: "development", ALLOW_LOCAL_UPSTREAM: "true" },
    ),
  );
});
test(
  "forwarding really permits an opted-in local task longer than 20 seconds",
  { timeout: 30000 },
  async () => {
    const old = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_LOCAL_UPSTREAM: process.env.ALLOW_LOCAL_UPSTREAM,
    };
    Object.assign(process.env, {
      NODE_ENV: "development",
      ALLOW_LOCAL_UPSTREAM: "true",
    });
    const h = await harness(async () => {
      await new Promise((r) => setTimeout(r, 20500));
      return { content: "completed after 20 seconds" };
    }, 25000);
    process.env.MAKER_BRIDGE_TEST = token;
    try {
      const config = {
        ...endpointConfigSchema.parse({
          id: "run",
          description: "Long local task",
          url: `http://127.0.0.1:${h.address.port}/run`,
          contract: "chat.v1",
          inputSchema: CHAT_INPUT,
          outputSchema: CHAT_OUTPUT,
          priceMicros: 0,
          timeoutMs: 26000,
        }),
        credentialEnv: "MAKER_BRIDGE_TEST",
      };
      validateConfig(config);
      assert.deepEqual(await forward(config, body, "long-local-task"), {
        content: "completed after 20 seconds",
      });
    } finally {
      for (const [key, value] of Object.entries(old))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      delete process.env.MAKER_BRIDGE_TEST;
      h.stop();
    }
  },
);
test("Codex child inherits desktop routing settings but no application credentials", () => {
  const env = codexEnvironment({
    HOME: "/home/test",
    PATH: "/bin",
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "desktop",
    CODEX_APP_TOOLS_PIPE_PATH: "/local/pipe",
    CODEX_AGENT_TOKEN: "secret",
    CODEX_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    DATABASE_URL: "secret",
    STRIPE_SECRET_KEY: "secret",
    MAKER_AGENT_TOKEN: "secret",
  });
  assert.deepEqual(env, {
    NODE_ENV: "development",
    HOME: "/home/test",
    PATH: "/bin",
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "desktop",
    CODEX_APP_TOOLS_PIPE_PATH: "/local/pipe",
  });
});
test("runner preserves split Unicode, rejects incomplete output, and terminates stalled children", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "codex-runner-test-"));
  const binary = join(dir, "fake-codex");
  try {
    await writeFile(
      binary,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end",()=>{
  const data=Buffer.from(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"€50"}})+"\\n"+JSON.stringify({type:"turn.completed"})+"\\n");
  const cut=data.indexOf(Buffer.from("€"))+1;
  process.stdout.write(data.subarray(0,cut));
  setTimeout(()=>process.stdout.write(data.subarray(cut)),20);
});
`,
      { mode: 0o700 },
    );
    assert.equal(
      (
        await codexRunner({ binary, workspace: dir })(
          body as any,
          new AbortController().signal,
        )
      ).content,
      "€50",
    );
    await writeFile(
      binary,
      '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"incomplete"}})));\n',
      { mode: 0o700 },
    );
    await assert.rejects(
      codexRunner({ binary, workspace: dir })(
        body as any,
        new AbortController().signal,
      ),
    );
    await writeFile(
      binary,
      "#!/usr/bin/env node\nsetInterval(()=>{},1000);\n",
      { mode: 0o700 },
    );
    await assert.rejects(
      codexRunner({ binary, workspace: dir })(
        body as any,
        AbortSignal.timeout(100),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
