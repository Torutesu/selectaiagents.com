# Working feature evidence

Captured on 2026-10-25 for Torutesu/selectaiagents.com PRs #1, #2 and #4.
These are real browser captures, with each application version exported from its PR head commit. No application source was changed for the captures.

## Environment and limits

- Isolated local app on port 3400 and PostgreSQL database `selectaiagents_evidence`; the regular development app/database were not used.
- Disposable Evidence Maker and Evidence Operator accounts, example.test website URLs, a deterministic HTTP fixture on port 3405, and development credits granted through the existing CLI.
- PR #1's playground really forwarded an HTTP request and recorded one successful $0.01 charge. The fixture is not an AI provider. No external provider, real payment, email delivery, or production deployment was verified.
- PR #2 submitted a placeholder HTTPS endpoint, which stayed unapproved. PR #4 requested changes, resubmitted the local HTTP fixture using the development-only local-host allowance, approved it, then disabled it. Approval itself does not execute a request.
- The operator account was allowlisted only in the isolated evidence app. No production or normal development account permissions were changed.
- A screenshot demonstrates the visible outcome of the recorded interaction, not a proof of security, concurrency, or transaction atomicity. Backend claims are supported separately by the linked CI runs and test source.
- `*-backend-checks.png` are browser captures of locally rendered **verbatim selected CI log lines**, with a source banner. They are not screenshots of the GitHub UI or a new local test run. The corresponding `.txt` and `.html` files are included for inspection.

## PR #1 — platform and UI

Source: `e845fc57ca80437317e608f6c2311a380394c732`.
[CI source](https://github.com/Torutesu/selectaiagents.com/actions/runs/40214518911/job/121232657976): 7 unit tests and 21 integration checks passed.

| Screenshot | Action and visible result |
| --- | --- |
| [Routing](pr1-routing.png) | Sent a playground task; received the explicitly labelled fixture response and $0.01 charge. |
| [Account and ledger](pr1-account-ledger.png) | Signed-in account, masked API-key prefix, $9.99 remaining from $10 development credit, completed call and matching debit. |
| [Community and health](pr1-agent-community.png) | Cast one vote and posted a comment; one measured call contributes latency/uptime. One sample does not establish reliability. |
| [Maker profile](pr1-maker-profile.png) | Opened the maker profile and its real persisted fixture listing. |
| [Launches](pr1-launches.png) | The submitted fixture appears on the launch board with its recorded vote. |
| [Backend checks](pr1-backend-checks.png) | Actual CI assertions for SDK/MCP execution, fallback, reservations/refunds, idempotency, webhook signatures, rankings, ownership and key revocation. |
| [GitHub CI status](pr1-ci.png) | Original GitHub job page showing successful verification steps. |

The earlier homepage images remain in `docs/screenshots/`. They show the demo catalog and visual design, not live providers. Fresh fixture calls fall outside completed-day ranking windows; no traffic was backdated to manufacture a rankings screenshot. Ranking aggregation and signed Stripe webhooks are covered by fixture CI; real checkout remains unverified.

## PR #2 — maker onboarding

Source: `45c9caa4ac5b065fc68accb60c502fbef93623df`.
[CI source](https://github.com/Torutesu/selectaiagents.com/actions/runs/40216596085/job/121238953351): 7 unit tests and 21 pre-existing integration checks passed. This suite does not independently prove the new private-draft and duplicate-submission guarantees.

| Screenshot | Action and visible result |
| --- | --- |
| [Draft dashboard](pr2-draft-dashboard.png) | Saved a draft, navigated away, and found it under private drafts. |
| [Resumed draft](pr2-resumed-draft.png) | Reopened the saved draft with its original field values restored. |
| [Review step](pr2-submission-review.png) | Completed details and endpoint steps and reached the review summary. |
| [Submitted](pr2-submitted.png) | Submitted through the UI; public listing exists and endpoint remains Awaiting approval. |
| [Persisted edits](pr2-persisted-edits.png) | Changed the tagline and endpoint price to $0.02, saved both, then reloaded to verify persistence. |
| [Backend checks](pr2-backend-checks.png) | Existing platform regression results; not new draft-specific coverage. |

Known limitation observed: the maker dashboard's listing-level price remains $0.01 after the endpoint price changes to $0.02. The endpoint editor and operator queue show $0.02. This evidence does not claim every price display is synchronized. Cross-account draft access and concurrent duplicate submission were not manually exercised in this capture session.

## PR #4 — operator review

Source: `05f66252b3f776650794550ac5a4fb4f5a34c8cd`.
[CI source](https://github.com/Torutesu/selectaiagents.com/actions/runs/40217870297/job/121242845194): 10 unit tests and 22 integration checks passed, including operator access, feedback privacy, stale/concurrent decisions, resubmission and atomic audit history.

| Screenshot | Action and visible result |
| --- | --- |
| [Pending queue](pr4-pending-queue.png) | Operator sees the pending submission with current endpoint price. |
| [Changes requested](pr4-changes-requested.png) | Saved a request-changes decision with an explanation and audit record. |
| [Maker attention](pr4-maker-attention.png) | Maker dashboard reports Needs attention. |
| [Maker feedback](pr4-maker-feedback.png) | Maker sees the reviewer note and current version in Manage agent. |
| [Resubmitted](pr4-resubmitted.png) | Maker saved corrected endpoint; version advanced to 3 and returned to Awaiting approval, retaining earlier feedback. |
| [Approved](pr4-approved.png) | Operator approved version 3; status became Approved, version 4, and approval entered history. |
| [Disabled and audit](pr4-disabled-audit.png) | Operator disabled version 4; version 5 retains all three decisions, notes and reviewer attribution. |
| [Disabled queue](pr4-disabled-queue.png) | Status filter shows the disabled endpoint and updated counts. |
| [Backend checks](pr4-backend-checks.png) | Actual CI results include the operator regression checks. |

The disabled fixture was also absent from the playground's agent selector. Queue/history pagination with multiple pages and attaching a real MAKER_* credential were not manually exercised. The local-host review page still displays the normal allowlist warning even though the development-only local-host allowance permits approval; this is not production host validation evidence.
