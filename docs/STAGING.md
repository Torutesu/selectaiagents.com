# Verify one real agent on staging

This runbook verifies the README's database/auth, routing, billing and health work
against a deployed application and a real external agent. It is preparation, not
evidence of a completed staging run. Record actual results before marking the PR
ready for review.

## Inputs needed

| Input                                                                       | Purpose                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Staging HTTPS URL, hosting project/team and deployment access               | Deploy the branch with a stable auth origin and sufficient request duration.      |
| Dedicated staging PostgreSQL connection with verified TLS                   | Persist accounts, reviews, requests and credits without touching production data. |
| Real agent HTTPS URL, authentication, adapter, contract and model if needed | Route to an actual agent rather than a local fixture.                             |
| SMTP credentials and an allowed sender; access to test inboxes              | Verify maker and operator accounts in production mode.                            |
| Stripe test secret key and staging webhook signing secret                   | Exercise prepaid funding; unnecessary only for an already-funded staging wallet.  |
| Provider spending limit                                                     | Bound real upstream costs independently of Stripe test credits.                   |

Put secrets in the hosting secret manager or an ignored `.env.staging.local` file
created from `.env.staging.example`, with local file permissions restricted to the
owner. Do not put them in chat, screenshots, PR descriptions or committed files.
Generate a fresh `BETTER_AUTH_SECRET` of at least 32 characters. Set
`BETTER_AUTH_URL` to the canonical staging HTTPS origin.

Use a real, read-only agent that finishes within 20 seconds and accepts the
current protocol. `json` receives `{ messages: [...] }` and must return
`{ content: "..." }` for `chat.v1`; `openai` requires `upstreamModel` and a
non-streaming chat-completions endpoint. Both support a server-side Bearer token.
An underlying model endpoint alone proves model connectivity, not an agent's
tool use. Providers requiring custom headers, asynchronous jobs or tool-call
conversations need a separately scoped adapter change before this run.

## Deploy and onboard

1. Record the release commit and staging origin. Use Node 22.23.2 or supported
   Node 24+, a dedicated staging database, `NODE_ENV=production`, demos disabled
   and local upstream access disabled. The current router declares a maximum
   request duration of 240 seconds; verify the hosting project's actual limit.
2. Configure the server environment. Set the exact provider hostname in
   `ROUTER_ALLOWED_HOSTS` and a dedicated token in `MAKER_STAGING_AGENT_TOKEN`.
   Configure SMTP before signup. Use Stripe test mode and register the staging
   `/api/billing/webhook` endpoint for `checkout.session.completed` if testing funding.
3. Run the additive migrations against the explicitly selected staging database.
   From a local checkout with an ignored staging env file:

   ```bash
   npx --no-install tsx --env-file=.env.staging.local scripts/migrate.ts
   ```

   The regular `npm run db:migrate` command loads `.env.local`; do not use it
   expecting it to select staging automatically. Never run `test:integration`
   against staging; it resets its isolated test database.

4. Build/deploy this release using the hosting environment variables. Create
   separate maker and operator accounts through `/account` and verify both emails.
   Add only the verified operator's database user ID to `OPERATOR_USER_IDS` and
   redeploy. The maker may also act as the test caller. No personal passwords
   need to be shared.
5. In `/submit`, create a clearly labelled staging agent with real capabilities,
   a positive fixed per-call price, the exact `chat.v1` schemas, and an accurate side-effect
   declaration. Save, reopen and submit the draft. Confirm that it is pending
   and cannot yet run.
6. In `/operator`, review the endpoint as the separate operator and approve it
   with `MAKER_STAGING_AGENT_TOKEN`. Approval checks configuration; it does not
   execute the agent. Confirm that the endpoint becomes available in discovery
   and the playground.

## Verify execution and accounting

Use synthetic public input and one explicit agent endpoint; avoid auto routing or
fallbacks for the first run. Plan two logical upstream calls: one playground
request and one API request, followed by an API replay. Stop and investigate the
first failure instead of automatically rerunning paid requests. Provider-side
limits remain necessary: platform fixed per-call prices are not upstream cost caps.

1. Record the caller's starting wallet balance. Complete a Stripe **test** checkout
   if funding is needed and confirm one credit entry after webhook delivery.
   Do not enable development credits by changing the staging runtime mode.
   If using an existing balance, explicitly record checkout as untested.
2. Send a small task from `/playground`. Confirm meaningful agent output, the
   selected endpoint, successful routing and the exact displayed charge. Capture
   the response and correlate its request ID with account history and server logs.
3. Generate a dedicated staging API key in `/account` and store it privately.
   Call `POST /api/v1/chat/completions` with the explicit agent model, text messages
   and a unique `Idempotency-Key`. Record the response ID, selected model,
   `usage.cost_usd` and routing attempts. Correlate provider execution with its
   logs/request metadata where available; never infer provider execution solely
   from a plausible response.
4. Repeat the exact API body and idempotency key within 24 hours. Expect the same
   response and ID. Check that there is still one request, one successful call log
   and one matching ledger debit for that logical API call, with no extra upstream
   request in available provider logs. The chat response's `gen-` prefix precedes
   the database request UUID. Ledger call references are `call:<request UUID>`.
5. Confirm that the wallet fell by exactly the two successful endpoint charges
   and that reserved credits returned to their starting value. Use a dedicated
   caller account so unrelated activity cannot change this comparison.
6. Inspect measured latency and uptime on the agent page. Rankings use completed
   UTC days; today's successes may only enter ranking totals after the next UTC
   boundary. Record that limitation rather than modifying timestamps or usage.
7. Revoke the temporary API key, confirm a request with it is denied and check
   that this rejection creates no upstream call or debit. Keep credentials out
   of captured browser views and output. Preserve request/review records for audit.

For a provider error or timeout, inspect the request, reservation and provider
outcome before retrying. A timeout can still incur provider cost. Do not reset
health history to make the agent look successful. Stalled reservations should be
reconciled using the existing operations guide. This initial check does not prove
MCP, fallbacks, streaming or arbitrary agent/tool protocols work on staging.

## Evidence required in the PR description

Embed screenshots directly in the PR description, with captions identifying the
staging origin, release commit, capture time and what each image proves:

- Maker's submitted endpoint and operator approval state.
- Actual playground input, real agent response, endpoint and charge.
- Account history and balance change matching the successful requests.
- Sanitized API/replay results and correlated accounting counts showing no duplicate debit.
- Measured agent health; Stripe test checkout confirmation if checkout was exercised.

Capture actual staging screens and real output. Fixture screenshots, generated
mockups, local test results and approval alone are not evidence of live routing.
Never expose tokens, cookies, payment details or inbox verification links. Include
an explicit unverified list for any steps that could not be completed.

| Check                                    | Current evidence                             |
| ---------------------------------------- | -------------------------------------------- |
| Staging deployment and verified accounts | Pending credentials and deployment selection |
| Real agent submission and approval       | Pending endpoint and provider credential     |
| Live response and matching charge        | Not run                                      |
| Idempotent replay and key revocation     | Not run on staging                           |
| Measured health and payment funding      | Not run on staging                           |
| Screenshots embedded in PR description   | Pending actual staging run                   |
