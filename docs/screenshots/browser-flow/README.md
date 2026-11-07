# Browser-flow evidence

Captured on October 27, 2026 from the passing Chromium scenario in
`tests/e2e/marketplace.spec.ts`. The scenario passed in 50.1 seconds locally, with
six named steps and zero retries. `08-passing-report.jpg` is a browser capture of
that run's actual Playwright report. Files 01–07 are unedited screenshots attached
by the automated test after its UI assertions passed.

The app ran at `http://127.0.0.1:3215` against a fresh, disposable PostgreSQL
database. Maker/operator/customer are separate fictional accounts. The upstream
was the deterministic local HTTPS fixture, not an AI provider. Credits came from
the existing development-credit CLI, not Stripe. No live credentials are included.

| Capture | Observed state |
| --- | --- |
| 01-maker-review.png | Saved and resumed draft ready for submission, priced at $0.01 |
| 02-awaiting-approval.png | Submitted endpoint awaiting operator approval |
| 03-operator-approved.png | Separate operator's saved approval and audit note |
| 04-funded-customer.png | Customer with $1 in development credits |
| 05-playground-success.png | Fixture response rendered, charged $0.01 |
| 06-playground-failure.png | Controlled failure rendered with no additional charge |
| 07-final-account.png | $0.99 available, $0 reserved, one completed and one failed request, one debit |
| 08-passing-report.jpg | All six steps passed, including HTTP replay and conflicting-payload rejection |

`accounting-evidence.json` is the actual test attachment correlating persisted
request IDs and upstream calls. The per-request `reserved_micros` records the
original reservation; `wallet.reservedUsd: 0` confirms no active reservation remains.
Replay assertions check one upstream hit, request, call log and debit both before
and after retrying the same request. A screenshot alone does not prove idempotency.

The suite drops its database and removes temporary credentials on shutdown.
CI uploads fresh reports and captures on every run; these committed screenshots
preserve the local run that accompanied this change, not a hosted staging test.
