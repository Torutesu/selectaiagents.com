import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

test("maker → operator → customer: success, replay and failed-call accounting", async ({
  browser,
}, info) => {
  const runtime = JSON.parse(
    await readFile(".data/e2e/runtime.json", "utf8"),
  ) as {
    databaseUrl: string;
    password: string;
    operatorId: string;
    endpointUrl: string;
  };
  const pool = new Pool({ connectionString: runtime.databaseUrl });
  const makerContext = await browser.newContext();
  const operatorContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const operator = await operatorContext.newPage();
  const customer = await customerContext.newPage();
  const model = "e2e-maker/browser-fixture#run";
  let successBody: Record<string, unknown>;
  let successKey: string;
  let successResult: Record<string, unknown>;
  let customerId: string;

  async function screenshot(
    page: Page,
    name: string,
    testInfo: TestInfo = info,
  ) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  }
  async function signup(page: Page, role: string) {
    await page.goto("/account");
    await page
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(`E2E ${role}`);
    await page
      .getByLabel("Email", { exact: true })
      .fill(`${role.toLowerCase()}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill(runtime.password);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${role.toLowerCase()}@example.test`, { exact: false }),
    ).toBeVisible();
  }
  async function account() {
    const response = await customerContext.request.get("/api/account");
    expect(response.status()).toBe(200);
    return response.json();
  }
  async function observations() {
    const response = await customerContext.request.get(
      "http://127.0.0.1:3216/observations",
    );
    expect(response.ok()).toBe(true);
    return response.json();
  }
  async function accounting(
    balance: number,
    requests: number,
    calls: number,
    debits: number,
  ) {
    const result = await pool.query(
      `SELECT
      (SELECT balance_micros::int FROM wallets WHERE user_id=$1) AS balance,
      (SELECT reserved_micros::int FROM wallets WHERE user_id=$1) AS reserved,
      (SELECT count(*)::int FROM requests WHERE user_id=$1) AS requests,
      (SELECT count(*)::int FROM call_logs l JOIN requests r ON r.id=l.request_id WHERE r.user_id=$1) AS calls,
      (SELECT count(*)::int FROM ledger WHERE user_id=$1 AND kind='call') AS debits`,
      [customerId],
    );
    expect(result.rows[0]).toEqual({
      balance,
      reserved: 0,
      requests,
      calls,
      debits,
    });
    expect((await account()).wallet).toEqual({
      balanceUsd: balance / 1e6,
      availableUsd: balance / 1e6,
      reservedUsd: 0,
    });
  }

  try {
    await test.step("Maker signs up, saves and resumes a draft, then submits through the UI", async () => {
      await signup(maker, "Maker");
      await maker.goto("/submit");
      await maker.getByLabel(/^Agent name/).fill("Browser Fixture");
      await maker.getByLabel(/^Maker name/).fill("E2E Maker");
      await maker
        .getByLabel(/^What does it do/)
        .fill("Deterministic local agent for browser regression tests");
      await maker
        .getByLabel(/^Description/)
        .fill(
          "A local HTTPS test fixture that echoes messages and can return a controlled failure. No external AI provider is called.",
        );
      await maker.getByLabel(/^Website/).fill("https://example.test");
      await maker.getByRole("button", { name: "Save & continue" }).click();
      await maker.getByLabel(/^Endpoint URL/).fill(runtime.endpointUrl);
      await maker.getByLabel(/^Price per successful call/).fill("0.01");
      await maker.getByLabel(/^Can this action/).selectOption("read");
      await maker.getByRole("button", { name: "Save & continue" }).click();
      await expect(
        maker.getByRole("heading", {
          name: "Ready for its first introduction?",
        }),
      ).toBeVisible();
      const draftUrl = maker.url();
      await maker.reload();
      await expect(maker.getByLabel(/^Agent name/)).toHaveValue(
        "Browser Fixture",
      );
      await maker.getByRole("button", { name: "Save & continue" }).click();
      await expect(maker.getByLabel(/^Endpoint URL/)).toHaveValue(
        runtime.endpointUrl,
      );
      await maker.getByRole("button", { name: "Save & continue" }).click();
      await screenshot(maker, "01-maker-review");
      await maker.getByRole("button", { name: "Submit for review" }).click();
      await expect(maker).toHaveURL(/\/agents\/browser-fixture\/manage/);
      expect(
        (
          await pool.query(
            "SELECT published_slug FROM maker_drafts WHERE id=$1",
            [draftUrl.split("/").pop()],
          )
        ).rows[0].published_slug,
      ).toBe("browser-fixture");
      expect(
        (
          await pool.query(
            "SELECT approved FROM endpoints WHERE agent_slug='browser-fixture'",
          )
        ).rows,
      ).toEqual([{ approved: false }]);
      const models = await (
        await makerContext.request.get("/api/v1/models")
      ).json();
      expect(models.data).toHaveLength(1);
      expect(models.data[0].runnable).toBe(false);
      expect(models.data[0].endpoints[0].available).toBe(false);
      await customer.goto("/playground");
      await expect(
        customer.getByLabel(/^Agent/).locator(`option[value="${model}"]`),
      ).toHaveCount(0);
      await screenshot(maker, "02-awaiting-approval");
      await maker.close();
    });

    await test.step("A separate operator signs in and approves the endpoint through the UI", async () => {
      await operator.goto("/account");
      await operator
        .getByLabel("Email", { exact: true })
        .fill("operator@example.test");
      await operator
        .getByLabel("Password", { exact: true })
        .fill(runtime.password);
      await operator
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(
        operator.getByRole("heading", { name: "Your account", exact: true }),
      ).toBeVisible();
      await operator.goto("/operator/browser-fixture/run");
      await operator.getByLabel(/^Decision/).selectOption("approve");
      await operator
        .getByLabel(/^Upstream authentication/)
        .selectOption("MAKER_E2E_TOKEN");
      await operator.getByLabel(/^I reviewed ownership/).check();
      await operator
        .getByLabel(/^Feedback for the maker/)
        .fill(
          "Approved deterministic local fixture for browser regression tests.",
        );
      const decisionResponse = operator.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith("/api/operator/endpoints/browser-fixture/run") &&
          response.request().method() === "POST",
      );
      await operator.getByRole("button", { name: "Save decision" }).click();
      expect((await decisionResponse).status()).toBe(200);
      // The decision form remounts after refresh; assert the durable audit entry,
      // not the short-lived success message from the previous form instance.
      await expect(
        operator
          .locator(".review-history")
          .getByText(
            "Approved deterministic local fixture for browser regression tests.",
            { exact: true },
          ),
      ).toBeVisible();
      const endpoint = (
        await pool.query(
          "SELECT approved, config FROM endpoints WHERE agent_slug='browser-fixture'",
        )
      ).rows[0];
      expect(endpoint.approved).toBe(true);
      expect(endpoint.config.credentialEnv).toBe("MAKER_E2E_TOKEN");
      const owner = (
        await pool.query(
          "SELECT owner_id FROM agents WHERE slug='browser-fixture'",
        )
      ).rows[0].owner_id;
      expect(owner).not.toBe(runtime.operatorId);
      expect(
        (
          await pool.query(
            "SELECT actor_id, actor_type, action FROM endpoint_reviews WHERE agent_slug='browser-fixture'",
          )
        ).rows,
      ).toEqual([
        {
          actor_id: runtime.operatorId,
          actor_type: "operator",
          action: "approve",
        },
      ]);
      await screenshot(operator, "03-operator-approved");
      await operator.close();
    });

    await test.step("Customer signs up and receives $1 through the existing development-credit command", async () => {
      await signup(customer, "Customer");
      customerId = (
        await pool.query('SELECT id FROM "user" WHERE email=$1', [
          "customer@example.test",
        ])
      ).rows[0].id;
      const credit = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/ops.ts",
          "credit",
          "customer@example.test",
          "1",
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: runtime.databaseUrl,
            NODE_ENV: "development",
            BETTER_AUTH_SECRET: "e2e-credit-command-only-not-a-live-secret",
            BETTER_AUTH_URL: "http://127.0.0.1:3215",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      credit.stdout.on("data", (chunk) => (output += chunk));
      credit.stderr.on("data", (chunk) => (output += chunk));
      const [code] = await once(credit, "exit");
      expect(code, output).toBe(0);
      await accounting(1_000_000, 0, 0, 0);
      await customer.getByRole("button", { name: "Refresh balance" }).click();
      await expect(
        customer.getByText("$1.0000", { exact: true }),
      ).toBeVisible();
      await screenshot(customer, "04-funded-customer");
    });

    await test.step("Playground executes the HTTPS fixture and charges exactly $0.01", async () => {
      await customer.goto(`/playground?model=${encodeURIComponent(model)}`);
      await expect(customer.getByLabel(/^Agent/)).toHaveValue(model);
      await customer
        .getByPlaceholder("Send a task to the agent")
        .fill("Browser flow success");
      const responsePromise = customer.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/chat/completions") &&
          response.request().method() === "POST",
      );
      await customer.getByRole("button", { name: "Send", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      successBody = response.request().postDataJSON();
      successKey = response.request().headers()["idempotency-key"];
      expect(successKey).toBeTruthy();
      successResult = await response.json();
      await expect(
        customer.getByText("Fixture response: Browser flow success", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        customer.getByText("charged $0.01", { exact: true }),
      ).toBeVisible();
      await accounting(990_000, 1, 1, 1);
      expect(await observations()).toHaveLength(1);
      await screenshot(customer, "05-playground-success");
    });

    await test.step("Replaying the exact Playground request returns the cached response without a second call or debit", async () => {
      // Playground creates a new key for each user action. Replay the captured
      // request at HTTP level with its original key; this is not a retry-button test.
      const replay = await customerContext.request.post(
        "/api/v1/chat/completions",
        {
          headers: {
            Origin: "http://127.0.0.1:3215",
            "Idempotency-Key": successKey!,
          },
          data: successBody!,
        },
      );
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual(successResult!);
      await accounting(990_000, 1, 1, 1);
      expect(await observations()).toHaveLength(1);
      const conflict = await customerContext.request.post(
        "/api/v1/chat/completions",
        {
          headers: {
            Origin: "http://127.0.0.1:3215",
            "Idempotency-Key": successKey!,
          },
          data: {
            ...successBody!,
            messages: [{ role: "user", content: "Changed payload" }],
          },
        },
      );
      expect(conflict.status()).toBe(409);
      await accounting(990_000, 1, 1, 1);
      expect(await observations()).toHaveLength(1);
    });

    await test.step("A controlled upstream failure appears in Playground with no debit or stranded reservation", async () => {
      await customer
        .getByPlaceholder("Send a task to the agent")
        .fill("FAIL_FIXTURE");
      const responsePromise = customer.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/chat/completions") &&
          response.request().method() === "POST",
      );
      await customer.getByRole("button", { name: "Send", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(502);
      const failure = await response.json();
      await expect(
        customer.getByText(failure.error.message, { exact: true }),
      ).toBeVisible();
      await accounting(990_000, 2, 2, 1);
      expect(
        (await observations()).map((hit: { status: number }) => hit.status),
      ).toEqual([200, 503]);
      await screenshot(customer, "06-playground-failure");
      await customer.goto("/account");
      await expect(
        customer.getByText("$0.9900", { exact: true }),
      ).toBeVisible();
      await expect(customer.getByText(/· completed/)).toBeVisible();
      await expect(customer.getByText(/· failed/)).toBeVisible();
      await screenshot(customer, "07-final-account");
      const requests = (
        await pool.query(
          "SELECT id, status, charged_micros, reserved_micros, needs_reconciliation FROM requests WHERE user_id=$1 ORDER BY created_at",
          [customerId],
        )
      ).rows;
      expect(
        requests.map((row) => [
          row.status,
          Number(row.charged_micros),
          row.needs_reconciliation,
        ]),
      ).toEqual([
        ["completed", 10000, false],
        ["failed", 0, false],
      ]);
      const hits = await observations();
      expect(hits.map((hit: { key: string }) => hit.key)).toEqual(
        requests.map((row) => row.id),
      );
      await info.attach("accounting-evidence", {
        contentType: "application/json",
        body: JSON.stringify(
          {
            fixture:
              "Deterministic local HTTPS agent; no AI provider or payment processor",
            wallet: (await account()).wallet,
            requests,
            upstream: hits,
            replay:
              "Identical response, one upstream call and one debit after replay and conflicting-payload rejection",
          },
          null,
          2,
        ),
      });
    });
  } catch (error) {
    // These contexts are explicit so each actor has its own session. Capture
    // their state on failure as well as the normal per-step evidence.
    for (const [name, page] of [
      ["maker", maker],
      ["operator", operator],
      ["customer", customer],
    ] as const)
      await screenshot(page, `failure-${name}`).catch(() => {});
    throw error;
  } finally {
    await Promise.allSettled([
      makerContext.close(),
      operatorContext.close(),
      customerContext.close(),
      pool.end(),
    ]);
  }
});
