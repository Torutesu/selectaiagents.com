# Local Codex verification — October 26, 2026

Actual browser captures from `http://127.0.0.1:3205`, using this branch's local
Codex bridge, a dedicated PostgreSQL database, fictional orders, two separate
demo accounts, and development credits. No screenshot is a generated mockup.

- `01-maker-review.jpg`: browser draft review, local endpoint, $0.01 price, 120-second timeout.
- `02-pending.jpg`: submission completed; endpoint awaits approval.
- `03-operator-approved.jpg`: separate operator approved the endpoint, credential reference and review history visible. The reference is not a token.
- `04-balance-before.jpg`: maker's $1.00 development balance, before execution.
- `05-playground-success.jpg`: actual Codex response, correct $50 total, $0.01 charge.
- `06-account-after.jpg`: first completed call and matching $0.01 debit, $0.99 available.
- `07-long-task-success.jpg`: second real task, deliberately including a 25-second tool wait, completed successfully.
- `08-account-final.jpg`: two completed calls, $0.98 available, $0 reserved, two $0.01 debits.

`live-verification.json` correlates the actual bridge request IDs, command-tool
counts, timings, database request/call records, ledger and approval history.
The two CLI executions took **10,513 ms** and **39,637 ms**. Both used one command
tool and returned the correct order total. These are saved-ChatGPT-sign-in calls,
not deterministic model fixtures. The bridge does not log prompts or tool output.

`unit-results.txt` records 22 passing tests, including auth, replay/conflict,
abort/deadline behavior, subprocess handling, Unicode output, environment
filtering and real 20.5-second HTTP forwarding with a deterministic runner.
`integration-results.txt` records 36 passing HTTP/PostgreSQL platform checks.
Those automated suites do not invoke Codex or spend ChatGPT allowance.

The browser test verifies local onboarding → separate operator approval →
Playground execution → wallet and ledger. No hosted staging, production email,
Stripe checkout, durable asynchronous jobs or persistent bridge cache is claimed.
Screenshots retain the blue/black/white design and show fictional account data.
