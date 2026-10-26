# Run a local Codex agent

This connects a locally signed-in Codex CLI to the existing `chat.v1` router.
The model runs through your ChatGPT account; it is not offline inference and uses
your plan's allowance. No OpenAI API key is required. This is a personal local
development bridge, not a shared hosted service or staging deployment.

## Start the bridge

Use the repository's Node version (`nvm use`), install dependencies (`npm ci`),
and install a native Codex CLI. Verify `codex --version` and `codex login status`;
run `codex login` if needed. The bridge uses saved CLI authentication and ignores
user model/config overrides. It does not read or copy your authentication file.
See [Codex authentication](https://learn.chatgpt.com/docs/auth) and
[non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

1. Copy `.env.codex.example` to `.env.codex.local` and restrict it to your user
   (`chmod 600 .env.codex.local`). Generate a token with `openssl rand -hex 32` and
   set `CODEX_AGENT_TOKEN`. Keep this file out of Git.
2. Leave `CODEX_AGENT_WORKSPACE=examples/codex-agent` for the supplied fictional
   order file. Only use a directory you intend this agent to read. The CLI runs
   in its read-only sandbox; this is not a security boundary for untrusted users.
3. Set `CODEX_BIN` to the native CLI's absolute path if needed. An available
   desktop `CODEX_APP_RUNTIME_CLI_PATH` is otherwise used before falling back to
   `codex` on PATH. Desktop runtime environment variables are preserved because
   the same sign-in can depend on them; application secrets and API keys are not
   forwarded to the CLI child.
4. Run `npm run agent:codex`. It listens only on `127.0.0.1:3210`. Keep this terminal
   open. `GET http://127.0.0.1:3210/health` reports availability, not model access.
   Only a completed task verifies model access. Do not expose this port through
   a tunnel or deploy your personal sign-in to a shared server.

The bridge accepts authenticated `POST /run` requests with a `chat.v1` messages
body and an `Idempotency-Key`. The platform supplies both the key and credential.
It rejects browser-origin requests, limits input/output size, and runs one task
at a time. Prompts go to stdin, not a shell command. It returns only final text;
stdout logs contain request ID, result status, duration, and command-tool count,
not prompts, command output, cookies, or tokens.

## Connect it through the browser

1. Configure the platform's ignored `.env.local` for a dedicated local PostgreSQL
   database, an auth secret and `BETTER_AUTH_URL=http://127.0.0.1:3100`. Set
   `ALLOW_LOCAL_UPSTREAM=true` and `MAKER_CODEX_LOCAL_TOKEN` to the **same token**
   as the bridge. Use `npm run dev -- --hostname 127.0.0.1 --port 3100`.
2. Run migrations, then create separate maker and operator accounts at `/account`.
   Add the operator's existing user ID to `OPERATOR_USER_IDS` and restart the app.
   The operator cannot approve their own agent. To find a test account's ID:

   ```sql
   SELECT id, email FROM "user" WHERE email = 'your-local-operator@example.test';
   ```

3. As the maker, open `/submit`, enter a listing, and choose:
   - URL: `http://127.0.0.1:3210/run`
   - Format: **Chat messages → text response**
   - Endpoint name: `run`
   - Price: `$0.01` per successful call (development credits only)
   - Response timeout: **120 seconds**
   - Side effects: **No, it only reads information or generates text**
4. Save/reopen if desired, review, and submit. The listing appears as pending.
   As the separate operator, open `/operator`, review the endpoint, and approve
   using credential name `MAKER_CODEX_LOCAL_TOKEN`. Never paste the token itself
   into the browser. Approval does not execute Codex.
5. Give the maker a development balance:

   ```bash
   npm run ops -- credit your-local-maker@example.test 1
   ```

6. Sign back in as the maker. In `/playground`, select this agent explicitly and
   send: **Read orders.txt with a tool and calculate the total value of both
   synthetic orders in USD. Do not modify files. Answer in one short sentence.**
   The expected total is **$50**. Confirm a successful tool call in the bridge's
   terminal and a `$0.01` charge in `/account`. Revoke test API keys when finished.

## Longer tasks and interruptions

Opted-in **development loopback endpoints** can use up to 120 seconds. The
bridge defaults to a 110-second deadline, leaving time for it to stop and return
an error before the router expires. Public endpoints and production execution
remain capped at 20 seconds. Submission, operator approval, and forwarding all
enforce the policy; copying an approved local config to production does not
bypass it. Restart the platform after changing environment settings.

These are bounded, synchronous calls. The bridge aborts the CLI process group
on its deadline, caller disconnect, or shutdown. ChatGPT usage already consumed
cannot be undone. Platform credits are charged only for successful calls.

Identical bridge requests reuse a cached outcome for 24 hours; different input
with the same key returns a conflict. Running duplicates and simultaneous new
tasks are rejected. The bounded cache refuses new work when full rather than
evicting replay protection. It is memory-only and resets on restart. The
platform's persisted idempotency/ledger remains the primary replay guarantee;
never use this bridge for external side effects. After an uncertain failure,
inspect account history before issuing a new task.

Tasks beyond this local limit need durable asynchronous jobs, status polling,
cancellation, and settlement on completion. That production architecture is
outside this local bridge. Hosted provider authentication, SMTP and Stripe
checkout are also still separate staging work.

## Verification

`npm test` includes bridge auth, replay/conflict, cancellation, subprocess error,
credential filtering, environment policy, and an actual 20.5-second local HTTP
forwarding regression. It uses a deterministic runner, not your ChatGPT sign-in.
`npm run test:integration` covers the existing platform with isolated fixtures.
The live browser/Codex walkthrough above is manual and consumes plan usage;
record its commit, origin, request IDs, logs, and screenshots separately in PRs.
