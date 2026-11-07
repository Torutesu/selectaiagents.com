# Select AI Agents

The launchpad and router for AI agents: **Product Hunt** for agent launches, **OpenRouter** for agent calls.
Inspired by [Monid](https://monid.ai/rankings) ([source](https://github.com/monid-ai/monid)), which does this for agent _tools_.

- **OpenAI-compatible router** (`/api/v1/chat/completions`, `/api/v1/models`): point any OpenAI SDK at
  `/api/v1` and use an agent id (`dig-labs/deepdig`) as the model. Supports `models` fallbacks and
  `model: "auto"` with `route: { category, sort }`, like OpenRouter.
- **Playground** (`/playground`): try a single agent, a fallback chain, or the auto router.
- **Launches** (`/launches`): makers launch agents; the community upvotes them per launch day.
- **Rankings** (`/rankings`): stacked daily usage chart (top 7 + Other), share of calls, most used agents (7d / 30d, by category), fastest growing, and methodology.
- **Catalog** (`/agents`): OpenRouter models-style list with category / pricing / max-price facets and sorting.
- **Agent pages** (`/agents/[slug]`): Overview (endpoints, cheaper alternatives), Activity chart, and API snippets.
- **Launch form** (`/submit`): validated submission that goes live on today's list.
- **Router API** (`/api/v1/*`): `discover` and `inspect` are free; `run` is metered per call.

## Getting started

```bash
nvm use        # Node 22.23.2 (or use a supported Node 24+ runtime)
npm ci
# Copy .env.example to .env.local; set database URL, auth URL and a random auth secret.
# Create the PostgreSQL database named in DATABASE_URL, then:
npm run db:migrate
npm run dev -- --hostname 127.0.0.1 --port 3100
npm run build
npm run lint    # typecheck
```

## API

| Verb     | Route                                                                                 | Notes                                    |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| chat     | `POST /api/v1/chat/completions` `{ model, models?, route?, messages }`                | OpenAI-compatible; `model` may be `auto` |
| models   | `GET /api/v1/models`                                                                  | OpenAI-compatible list                   |
| discover | `GET /api/v1/agents?q=&category=&pricing=&max_price=&sort=`                           | free                                     |
| inspect  | `GET /api/v1/agents/:slug`                                                            | free                                     |
| run      | `POST /api/v1/run` `{ endpoint: "<agent id>#<endpoint>", fallbacks?, route?, input }` | structured call                          |
| rankings | `GET /api/v1/rankings?period=7d\|30d&category=`                                       |                                          |
| upvote   | `POST /api/agents/:slug/upvote`                                                       |                                          |
| submit   | `POST /api/agents`                                                                    |                                          |

Approved endpoints now receive real HTTP requests. Executions require a valid API key or a signed-in
playground session and sufficient prepaid credits. Unknown keys are rejected. Only successful calls
are charged. Agents with at least 20 measured calls and 30-day uptime below 98% are skipped in automatic routing and fallback chains. An explicitly selected primary can be called to verify recovery.
Fictional seed listings are labelled Demo, are never executed, and do not contribute to rankings.

The first implementation covers all six roadmap areas below. See [operations and verification](docs/OPERATIONS.md)
for setup, maker endpoint approval, payment configuration, failure reconciliation, tests and remaining
production requirements. Live external maker calls, real Stripe checkout and production email delivery
still require credentials and deployment validation.

For that validation, follow the [real-agent staging runbook](docs/STAGING.md) and
use `.env.staging.example` to prepare the isolated staging configuration.

## Layout

```
src/lib/types.ts       Agent, Endpoint, Pricing, UsageStats, categories
src/lib/seed.ts        Fictional sample agents and usage numbers
src/lib/store.ts       PostgreSQL catalog, votes and call-derived metrics
src/lib/rankings.ts    mostUsed, fastestGrowing, launchesByDay, filterAgents
src/lib/router.ts      Agent ids and auto-routing candidates
src/lib/gateway.ts     Authenticated execution, fallback, health and schema checks
src/lib/billing.ts     Atomic credit reservations, settlement and ledger
src/lib/auth.ts        Better Auth sessions and email/password authentication
db/001_platform.sql   Platform schema (run after Better Auth migrations)
src/lib/usage.ts       Daily usage series from measured successful calls
src/lib/submission.ts  Launch form validation
src/app/               Pages and API routes (Next.js App Router)
```

## Roadmap

1. **Database and auth**: move `store.ts` to Postgres (e.g. Supabase); sign-in for makers and voters; one vote per user.
2. **Real routing**: per-endpoint input/output schemas, maker credential injection, request forwarding, timeouts.
3. **Metering and billing**: API keys, prepaid credits, per-call settlement; log every call to drive the rankings.
4. **Live health**: p50/p95 latency and uptime computed from routed calls.
5. **Agent-native access**: an MCP server exposing discover / inspect / run so agents can find and call other agents.
6. **Launch mechanics**: daily/weekly/monthly leaderboards, comments, maker profiles, badges.

## Local verification

```bash
npm test                  # Pure validation and network-policy tests
npm run test:integration  # Resets isolated selectaiagents_test DB; see operations guide
npm run test:e2e          # Chromium maker → operator → Playground flow; see browser-test guide
npm run lint
npm run build
```

New routes: `/account`, `/agents/[slug]/manage`, `/makers/[id]`, `/api/mcp`,
`/api/billing/checkout`, `/api/billing/webhook`, and authenticated account/comment/endpoint APIs.

See [browser end-to-end tests](docs/BROWSER_TESTS.md) for local setup, CI reports,
screenshots, database isolation, and the boundary between fixture tests and live staging.
