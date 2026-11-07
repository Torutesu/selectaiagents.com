/** Isolated browser-test infrastructure with explicit test-only app configuration. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { createServer as netServer } from "node:net";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Pool } from "pg";

const adminUrl = new URL(
  process.env.E2E_DATABASE_ADMIN_URL || "postgresql://localhost/postgres",
);
assert.ok(
  ["localhost", "127.0.0.1"].includes(adminUrl.hostname),
  "E2E requires a local PostgreSQL server",
);
assert.equal(
  adminUrl.pathname,
  "/postgres",
  "Use the postgres maintenance database; the suite creates its own database",
);
assert.equal(
  adminUrl.search,
  "",
  "Database URL query overrides are not supported",
);
const databaseName = `selectaiagents_e2e_${randomBytes(8).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Pool({ connectionString: adminUrl.toString() });
const origin = "http://127.0.0.1:3215";
const directory = resolve(".data/e2e");
const password = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("hex");
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  NODE_ENV: "development" as const,
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_TELEMETRY_DISABLED: "1",
  SHOW_DEMO_AGENTS: "false",
  ALLOW_LOCAL_UPSTREAM: "true",
  ROUTER_ALLOWED_HOSTS: "",
  OPERATOR_USER_IDS: "",
  MAKER_E2E_TOKEN: token,
  SMTP_URL: "",
  MAIL_FROM: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  NODE_EXTRA_CA_CERTS: resolve(directory, "certificate.pem"),
  NODE_TLS_REJECT_UNAUTHORIZED: "1",
};
let created = false;
let stopping = false;
let ready = false;
let app: ChildProcess | undefined;
const hits: { key: string | undefined; content: string; status: number }[] = [];
const control = httpServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/ready")
    res.writeHead(ready ? 200 : 503).end(JSON.stringify({ ready }));
  else if (req.url === "/observations") res.end(JSON.stringify(hits));
  else res.writeHead(404).end();
});
let upstream: ReturnType<typeof httpsServer> | undefined;

async function command(binary: string, args: string[]) {
  const child = spawn(binary, args, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `${args[0]} failed: ${output}`);
}

async function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  ready = false;
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill("SIGTERM");
    const timer = setTimeout(() => app?.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  control.closeAllConnections();
  control.close();
  upstream?.closeAllConnections();
  upstream?.close();
  try {
    if (created) {
      // Only the random database created by this process can reach this statement.
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
    for (const name of [
      "runtime.json",
      "key.pem",
      "certificate.pem",
      "openssl.cnf",
    ])
      await rm(resolve(directory, name), { force: true });
  }
  process.exit(code);
}

async function main() {
  // Fail rather than attach to an unrelated application or reset an existing DB.
  const probe = netServer();
  probe.listen(3215, "127.0.0.1");
  await once(probe, "listening");
  await new Promise<void>((done, reject) =>
    probe.close((error) => (error ? reject(error) : done())),
  );
  control.listen(3216, "127.0.0.1");
  await once(control, "listening");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await command(process.execPath, ["--import", "tsx", "scripts/migrate.ts"]);

  Object.assign(process.env, environment);
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/lib/db");
  const operator = await auth.api.signUpEmail({
    body: {
      name: "E2E Operator",
      email: "operator@example.test",
      password,
    },
  });
  environment.OPERATOR_USER_IDS = operator.user.id;
  await db.end();

  await writeFile(
    resolve(directory, "openssl.cnf"),
    `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n`,
  );
  await command("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    resolve(directory, "key.pem"),
    "-out",
    environment.NODE_EXTRA_CA_CERTS,
    "-config",
    resolve(directory, "openssl.cnf"),
  ]);
  upstream = httpsServer(
    {
      key: await readFile(resolve(directory, "key.pem")),
      cert: await readFile(environment.NODE_EXTRA_CA_CERTS),
    },
    async (req, res) => {
      if (req.method !== "POST" || req.url !== "/run") {
        res.writeHead(404).end();
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();
        return;
      }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        const content = input.messages.at(-1).content as string;
        const status = content === "FAIL_FIXTURE" ? 503 : 200;
        hits.push({
          key: req.headers["idempotency-key"] as string,
          content,
          status,
        });
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(
            JSON.stringify(
              status === 200
                ? { content: `Fixture response: ${content}` }
                : { error: "Controlled fixture failure" },
            ),
          );
      } catch {
        res.writeHead(400).end();
      }
    },
  );
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  await writeFile(
    resolve(directory, "runtime.json"),
    JSON.stringify({
      databaseUrl: databaseUrl.toString(),
      password,
      operatorId: operator.user.id,
      endpointUrl: `https://127.0.0.1:${address.port}/run`,
    }),
    { mode: 0o600 },
  );
  const log = await open(resolve(directory, "server.log"), "w");
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3215",
    ],
    {
      env: environment,
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  await log.close();
  app.once("exit", () => {
    if (!stopping) void shutdown(1);
  });
  for (let i = 0; i < 120; i++) {
    try {
      if (
        (
          await fetch(`${origin}/api/v1/models`, {
            signal: AbortSignal.timeout(2000),
          })
        ).ok
      ) {
        ready = true;
        console.log("Isolated browser test app and HTTPS fixture ready");
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("E2E app did not start; inspect .data/e2e/server.log");
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
main().catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
