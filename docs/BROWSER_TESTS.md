# Browser end-to-end regression

This suite runs the real Next.js application, Better Auth sessions, PostgreSQL,
operator review, router, ledger and browser UI. Only the external agent is a
deterministic local HTTPS fixture. No provider API key is needed.

## Run locally

Use the Node version in `.nvmrc`, local PostgreSQL 14+ and OpenSSL (macOS/Linux):

```sh
npm ci
npx playwright install chromium
# Optional: defaults to postgresql://localhost/postgres.
# The local PostgreSQL role must be able to create and drop databases.
export E2E_DATABASE_ADMIN_URL=postgresql://localhost/postgres
npm run test:e2e
npx playwright show-report
```

On Linux, install browser OS dependencies with `npx playwright install --with-deps chromium`.
Ports 3215 (app) and 3216 (fixture observations/readiness) must be free. The fixture
uses an automatically allocated loopback HTTPS port. Existing servers are never reused.

Every run creates a random `selectaiagents_e2e_*` database on **localhost only**,
migrates it, and drops only that database on normal exit, failure or SIGINT/SIGTERM.
It never resets the application database or the existing integration-test database.
The harness explicitly overrides database, auth, payment, email and upstream settings
for its child app. Next.js can still read other values from local environment files;
CI uses a clean checkout. Development auth skips production email verification.

Only the operator account is bootstrapped server-side; maker and customer sign up
in separate browser sessions, and the operator signs in through the browser.
The operator's ID is explicitly configured in the test app's environment.
An ephemeral self-signed localhost certificate is trusted with `NODE_EXTRA_CA_CERTS`
in the test app only; TLS verification is not disabled.

Temporary credentials/certificates live in ignored `.data/e2e/` and are deleted at
shutdown. A forced kill or host crash can leave an E2E database behind; inspect its
name before removing it manually. Do not run two copies from the same checkout.

## What must pass

One browser scenario contains six named steps, with no automatic retries:

1. Maker signs up, saves and reloads a private draft, submits it, and the endpoint
   remains unavailable until approval.
2. A different operator reviews and approves the endpoint using a server-side
   fixture credential reference.
3. Customer signs up; the existing development-credit command adds exactly $1.
4. Customer sends a task in Playground; the real router calls the HTTPS fixture,
   shows its response and charges $0.01.
5. An HTTP replay of the **captured browser request with the original idempotency
   key** returns the same response without another upstream hit, call log or debit.
   Reusing that key with a changed payload returns 409 and also changes no balances.
6. A second task makes the fixture return 503; Playground displays the router error,
   the wallet stays at $0.99 with $0 reserved, and the account lists one completed
   request and one failed request. Only the successful request has a debit.

Assertions correlate upstream idempotency keys with persisted request IDs, call
logs and accounting. Screenshots are attached after the relevant UI assertions;
the final JSON attachment records the observed wallet and request results.
The replay is an HTTP-level assertion, not a claim that Playground has a retry button.

## CI and evidence

The independent `browser-flow` job runs on pushes and pull requests. It uploads the
Playwright HTML report, screenshots, failure traces and application log even when
the scenario fails. Artifacts expire after seven days. Use the report's six steps
and accounting JSON to diagnose failures, rather than relying on screenshots alone.

This covers a Chromium desktop development flow. It does **not** verify a live AI
provider, SMTP verification/delivery, Stripe checkout/webhooks, hosted staging,
other browsers, or production configuration. Those remain separate validation.
