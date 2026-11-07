# Running Select AI Agents

This implementation follows the six steps of the founder's README. It is a local, testable first release of the agent marketplace and router. It does not introduce a separate first-party agent product.

## Runtime and database

Use Node 22.23.2 (`nvm use`) or a supported Node 24+ release. Node 23.7 is incompatible with the current HTTP client's compression support. PostgreSQL 14+ is required. Keep development, automated tests and production in different databases.

Copy `.env.example` to `.env.local`, generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32`, and set `DATABASE_URL` and `BETTER_AUTH_URL`. Never commit this file. PostgreSQL connection pooling is shared within each app process; production should use a provider's pooled connection URL and verified TLS.

```
npm ci
npm run db:migrate
npm run dev -- --hostname 127.0.0.1 --port 3100
```

The migration uses Better Auth's installed-version migration API for its tables and `db/001_platform.sql` for platform tables, `db/002_maker_drafts.sql` for private maker drafts, and `db/003_endpoint_reviews.sql` for review states and audit history. These migrations are idempotent. The migration takes a PostgreSQL advisory lock; its platform DDL is transactional. Back up a populated database before future schema changes. Database failures surface as errors; there is no in-memory/JSON success fallback.

Optional demo catalog: run `npm run db:seed` and set `SHOW_DEMO_AGENTS=true`. Seeded listings are fictional, visibly marked, cannot receive votes or executions, and contribute no usage statistics. No legacy `.data/store.json` existed in this checkout. If another installation has one, import listings only after assigning real owners; anonymous legacy votes cannot establish one-vote-per-user identity.

## Accounts and API keys

Create an account at `/account`. Development allows immediate email/password signup. Production requires email verification and disables new signups until `SMTP_URL` and `MAIL_FROM` are configured. Set the canonical HTTPS `BETTER_AUTH_URL` before deployment. Better Auth handles password hashing, session cookies, verification and reset endpoints. The first account UI includes signup, sign-in and sign-out; a password-reset UI is a follow-up, although the configured auth server supports reset delivery.

Session mutations require an exact matching Origin. API clients use `Authorization: Bearer saa_...`. Keys are generated with 256 bits of randomness, displayed once, and persisted only as SHA-256 hashes plus a short identifying prefix. Revocation takes effect on the next authorization check; calls already authorized may finish. API keys can spend the owning user's full available balance. Scoped keys and per-key budgets are future extensions.

Authenticated users can publish listings immediately, vote once per listing (database unique constraint), comment, and delete their own comments. Maker profiles expose public names and owned listings, not email addresses. Daily/weekly/monthly leaderboards use current UTC calendar periods, votes cast within the period, and earlier launch time to break ties. Top-three badges are live standings, not permanent awards.

## Maker studio and guided onboarding

Open `/maker` from Account or the footer. `/submit` now guides makers through agent details, endpoint setup, and review. **Save draft** stores work privately in PostgreSQL; drafts are visible only to their owner and never appear in the directory, model list, rankings, or router. Save explicitly before leaving; drafts resume at the details step with all saved fields intact.

Submitting publishes the listing and creates an unapproved endpoint in one transaction. Repeating the submission request returns the existing listing. The published listing is visible immediately, but calls remain disabled until operator approval. The older `POST /api/agents` API still supports direct listing-only creation for existing clients.

The dashboard derives statuses from stored configuration and measured health:

- **Draft:** a private, unpublished draft.
- **Awaiting approval:** endpoint configuration exists, but none is approved.
- **Live:** at least one approved endpoint and measured uptime is not below the routing threshold. No samples is explicitly shown as unmeasured.
- **Needs attention:** a published listing has no configured endpoint, has only endpoints needing changes/disabled by an operator, or measured uptime is below 98%.

An agent with an approved endpoint and additional unapproved endpoints remains Live; its dashboard hint distinguishes pending reviews from endpoints needing changes or disabled by an operator. Each endpoint’s status and latest 20 review notes are visible in the private endpoint editor.

Manage a published agent at `/agents/<slug>/manage`. Makers can edit descriptions, category, website and tags; agent/maker names stay fixed to preserve public/API identity. The guided endpoint editor takes USD prices and seconds, converting them to existing integer server units. Custom contracts remain available in the advanced JSON editor. Saving an endpoint, including a price change, revokes its prior approval and clears its attached credential reference until the operator approves it again. Drafts are preparation, not proof that an endpoint works.

Run `npm run db:migrate` before using these routes on an existing installation. The maker flow has been compile-checked; interactive and live-provider verification are intentionally deferred.

## Operator review dashboard

After running `npm run db:migrate`, set `OPERATOR_USER_IDS` to a comma-separated list of trusted, existing account IDs on the server and restart/redeploy the application. IDs come from the Better Auth `user` table; verify the account identity before adding it. This is an explicit administrative permission. No account, email domain, or first signup is made an operator automatically. Removing an ID revokes access on subsequent requests after the new server configuration takes effect. Do not expose this environment variable as a NEXT_PUBLIC value.

Allowlisted users see **Account → Open review queue**. `/operator` lists pending, approved, changes-requested, and disabled endpoints, with pagination. `/operator/<agent-slug>/<endpoint-id>` displays the submitted URL, price, schemas, format, declared effects, host configuration, and audit history. Both pages and the decision API enforce operator access; API writes also require a same-origin session and rate limiting. The browser does not determine authorization. Operators cannot approve their own agent through the web API.

Decisions:

- **Approve:** validates schemas, contract compatibility, the configured host allowlist, DNS/public-address rules and the selected credential reference. Only names of configured `MAKER_*` variables are offered; values never go to the browser. Choose no authentication explicitly for unauthenticated upstreams. This action does not send a task to the agent or validate provider quality.
- **Request changes:** requires feedback, disables routing, and shows the note to the maker.
- **Disable:** requires a reason, removes the credential reference, and stops the endpoint from being selected by future routing requests. Requests already authorized/selected may still finish.

The host allowlist and credential values are still deployment configuration, not editable in the review UI. A host must be configured before approval succeeds. Keep credentials and sensitive internal details out of review notes: notes are intentionally visible to the maker. Approval is not a health reset; low measured uptime can still prevent routing.

Each decision locks and checks the endpoint version, changes its state, and appends an audit record in one transaction. A stale version returns 409; reload before deciding again. Maker edits increment the version, clear prior approval and credential references, and put the endpoint back into the pending queue. Historical decisions remain available with the configuration that was reviewed. Notes, actor display name/account ID (for web reviews), timestamp and action are retained; snapshots omit the credential reference. Maker views show recent notes only, without snapshots or operator account IDs. Operator history is paginated.

The existing `approve-endpoint` and `disable-endpoint` CLI commands use the same review service. CLI records are labelled **Operator CLI (server access)**, not attributed to a signed-in person. Host/credential configuration and trusted database/CLI access remain administrative powers. There is no application route to edit/delete review history; this is an application audit trail, not tamper-proof storage against database administrators. Pre-existing approvals retain their state after migration but do not receive invented historical audit records.

Verification for this increment: compile/type checks and local additive migration only. Unit and fixture-based integration regression cases are included for CI; interactive, live-provider and local functional tests remain deferred. No operator account is granted access by the implementation itself.

## Onboarding a real maker endpoint

1. Maker opens **Account → Maker studio → New agent**, saves details and an endpoint, then submits the review step. Existing listings use **Manage agent**.
2. Maker submits its URL, schemas, versioned contract, fixed microdollar price, timeout and side-effect declaration. Configuration stays private except for public endpoint schemas, pricing and availability. All edits disable routing until reviewed again.
3. Operator opens the review queue and verifies ownership, behavior, price, side-effect declaration, data handling and schema compatibility. Review schemas as executable validation rules, including regex complexity. This is a deliberate manual control; submission alone does not prove an agent works.
4. Operator adds the exact hostname to `ROUTER_ALLOWED_HOSTS`. Store any provider token under a dedicated `MAKER_*` environment variable on the server. Never reuse unrelated service credentials.
5. Approve from the review page, selecting the configured credential reference, or use the server CLI:

```
npm run ops -- approve-endpoint agent-slug run MAKER_AGENT_TOKEN
# For an intentionally unauthenticated upstream, omit the final argument.
npm run ops -- disable-endpoint agent-slug run
```

Approval validates the schema, resolves/checks the destination, and rejects a contract whose schemas differ from an already approved contract. It does not send a test task or certify provider quality. The router rechecks the destination on every call, pins validated DNS addresses to the connection, rejects private/link-local addresses and redirects, and injects only the configured Bearer credential. HTTPS on port 443 is required. Localhost HTTP is permitted only with `ALLOW_LOCAL_UPSTREAM=true` outside production, for local testing.

For `chat.v1`, use the exact `CHAT_INPUT`/`CHAT_OUTPUT` schemas in `src/lib/endpoint-config.ts` (the editor preloads them). The `json` adapter POSTs input directly and expects the configured output shape. The `openai` adapter also requires `upstreamModel`, forwards text messages, and normalizes the first assistant content. Arbitrary authentication headers, streaming, tool-call conversations, multimodal payloads, long-running jobs, and per-token billing are not implemented. A custom adapter is required before onboarding providers with different protocols.

The current API is compatible with OpenAI SDK **non-streaming text chat completions and model listing**, not the entire OpenAI API. Unsupported parameters are rejected rather than silently ignored.

## Routing, accounting and failures

REST `/api/v1/run`, `/api/v1/chat/completions`, the signed-in playground and MCP `/api/mcp` share one execution path. Auto routing uses category/keyword matches and the selected deterministic sort. Structured auto calls require `route.contract`; chat uses `chat.v1`. Fallback schemas must match a reviewed contract. Up to nine eligible endpoints can be attempted, each with a configured 100 ms–20 s HTTP timeout, a 3 s DNS budget and a 1 MB response limit. Deploy on a host with a request duration of at least 240 seconds or reduce these limits.

Amounts use integer USD microdollars, never floating point ledger arithmetic. A wallet row lock reserves the maximum eligible candidate price before networking. Concurrent requests cannot reserve more than available credits. One successful result is charged at its quoted price; unused credit is released. Failed attempts are recorded for health but are not charged. Metering is fixed-price per endpoint execution even if a listing describes a task or unit.

Set `Idempotency-Key` for each logical task. Replays with the same normalized body return the original response without executing or charging again. Different bodies under the same key return 409. An in-flight duplicate returns 409; retry later with the same key. Cached response replay expires after 24 hours and returns 410, never a new execution. The request identity is retained to prevent replay from becoming a duplicate side effect.

For an endpoint declaring side effects, failure, timeout or invalid output stops fallback. The provider may already have performed the action. If an application/database process fails after reservation, funds remain reserved until an operator verifies the provider outcome:

```
npm run ops -- stalled
npm run ops -- resolve-stalled REQUEST_UUID refund 0
npm run ops -- resolve-stalled REQUEST_UUID charge VERIFIED_MICRODOLLARS
```

Detected infrastructure failures after dispatch are marked `needs_reconciliation` and appear immediately in `stalled`. They can be reconciled immediately because their worker has stopped. Other running requests must be older than ten minutes (longer than the bounded execution chain). The durable `upstream_started` marker is written before any maker call. Before-dispatch failures release credits and cache a failed response; uncertain dispatched actions retain their reservation until the operator verifies the outcome. If the database is unavailable while handling the failure, the running row remains recoverable through `stalled` after ten minutes once the database returns. Do not infer the provider outcome from a timeout. Reconciliation is idempotent and does not re-execute the task. Alert on stale reservations before public launch; automated provider reconciliation is not yet implemented.

## Payments

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from the same Stripe environment. Configure `/api/billing/webhook` to receive `checkout.session.completed` events. Checkout offers $10/$25/$50 USD credits and filters to card payments. Credits are granted only after a signed event reports a paid session with matching user, currency and amount. The Checkout session ID is a unique ledger reference, so repeated webhook delivery cannot double-credit.

Use Stripe test mode and the Stripe CLI for an actual checkout test before enabling live payments. The automated suite signs fixture events locally; it does not contact Stripe or validate a real payment/account configuration. Do not grant credits from the success redirect.

For local development only:

```
npm run ops -- credit your-local-account@example.test 10
```

This command is disabled when `NODE_ENV=production`. There is no public credit-grant endpoint. Refunds, disputes, taxes, maker payouts and revenue sharing need an operational workflow before handling public paid traffic. They are not automated in this first release.

## Data and health

Call logs retain endpoint, status and latency, without prompts, provider credentials or raw upstream responses. The private idempotency cache contains the user's response to support replay, so secure the database and limit access accordingly. Schedule `npm run ops -- cleanup` at least daily to remove response bodies older than 24 hours and expired rate-limit buckets. Identity and ledger rows remain for accounting. Decide production retention for call logs, accounts and payment records before launch.

Usage rankings count successful executions only, end on the last complete UTC day, and exclude demo listings. Replays do not add logs. Health includes all routed attempts over the rolling last 30 days, including today. Uptime is success/attempts; p50/p95 use successful attempts. No observations is shown as “Not measured”, although approved new endpoints are eligible for routing. Auto routing and fallback candidates require at least 20 measured calls before the 98% uptime cutoff applies. An explicitly selected primary remains callable for recovery; approval, schema and budget checks still apply. This avoids permanently excluding new agents after one failure and gives degraded agents a path to recover without deleting failure history. Automated health probes are not implemented.

Aggregations currently run against indexed call logs. Add rollups/pagination and load-test before high-volume use. The platform does not yet provide a worker queue, independent tracing backend, automated abuse moderation, maker verification, OAuth for MCP, provider payouts, or reputation protection against many fake accounts. Email verification and account rate limits are a starting point, not a claim of launch-scale abuse resistance.

## Verification

```
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:integration
npm run build
npm audit
```

Integration tests **reset the dedicated `selectaiagents_test` database**. The script checks that exact database name before resetting its public schema. It defaults to local PostgreSQL; CI may set `TEST_DATABASE_URL` to another isolated PostgreSQL service with that database name. It starts its own app on 127.0.0.1:3200, uses `.next-integration`, creates local agent fixtures, signs test webhook payloads, and shuts the test server down. It never uses the application's `DATABASE_URL` for test data. Do not point it at an existing valuable database.

The suite covers auth/session ownership, CSRF, vote uniqueness, credential injection, real HTTP forwarding, schemas, timeouts, fallback restrictions, atomic accounting, API-key revocation, OpenAI SDK and official MCP client interoperability, Stripe signature validation/deduplication, measured health/rankings, and rendered routes. Local fixtures are not validation of any external maker or live payment provider.

## Production handoff

Before public deployment, configure and verify: PostgreSQL backups/TLS, HTTPS/canonical origin, production auth secret and working verification/reset email, at least one reviewed external agent and its credential, Stripe test checkout then live account settings, refund/dispute handling, scheduled cache cleanup, alerts for reserved credits and failures, and a host that supports the router's duration limits. Keep demos off in production. Run the regression suite on the release commit and smoke-test the deployed URL. No live deployment or Git push is performed by the local implementation workflow.

### Displayed endpoint prices

Catalog, detail, maker and discovery API summaries use the lowest approved endpoint price. If no endpoint is approved, they show the lowest current configured price; that price does not grant approval or enable calls. Only listings without configured endpoints retain their original declared pricing. Each endpoint keeps its own price, and the playground lists prices only for approved chat endpoints. USD labels preserve up to six fractional digits so a billable microdollar is not rounded away.

### Onboarding regression coverage

`npm run test:integration` runs `scripts/integration-onboarding.ts` through the existing isolated HTTP/PostgreSQL harness. It covers draft ownership and CSRF checks, save/resume and discovery exclusion, repeated/concurrent submission, invalid input, transaction rollback, competing names and approval removal after edits. The rollback case temporarily installs a narrowly targeted endpoint-insert failure trigger, removes it in `finally`, and verifies a retry succeeds. Both the harness and onboarding module require the database name `selectaiagents_test`; never point this suite at an application database.
