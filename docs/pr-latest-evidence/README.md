# Latest PR screenshot refresh

Captured October 26, 2026 (Asia/Kolkata). Application source: `c73be1e882a034a377ab11aade11550e3500adea` (PR #8, blue/black/white UI).

These are real browser screenshots of the cumulative latest application. They are **not captures of the separate older PR heads**. Original PR implementation/test claims and historical log links remain separate in each description.

## Environment and evidence

- Isolated local application on port 3400, dedicated `selectaiagents_evidence` PostgreSQL database, disposable maker/operator accounts, deterministic HTTP fixture on port 3405. No production account or database was changed.
- The tracked application files were copied from the source commit above. No application source was modified for these captures.
- Draft setup used the authenticated maker API. Resume, both Save & continue steps, and final submission were exercised in the browser.
- Request changes, endpoint resubmission, and approval used authenticated local APIs. Disable was saved through the operator review UI. Screenshots show persisted UI outcomes, not proof that every mutation was clicked in the browser.
- Review sequence for Blue UI Evidence Fixture: submitted version 1; changes requested version 2; local endpoint resubmitted version 3; approved version 4; disabled through UI version 5.
- Existing development-only local upstream allowance was already enabled in this isolated app. The review screen still displays the normal host-allowlist warning. This does not verify production host configuration, real credential attachment, or a real provider.
- A new browser playground call to Onboarding Evidence Fixture returned its labelled deterministic HTTP response. The gateway charged 12345 micro-USD ($0.012345); the account screenshot shows the completed call and corresponding debit.
- Community vote/comment and older fixture calls were preserved from prior local verification; they were not recreated or backdated. Their latest rendering is shown. Small local samples do not establish production reliability.
- `pr6-ci-passed.jpg` is a direct screenshot of GitHub Actions run 40223077698 (head b660829f27ff398a2e0ed2c6d46fc97360605e2b): Success. The API also confirmed successful test, integration, lint, build and audit steps. This is a fresh capture of an existing successful run, not a new run or fabricated terminal output.
- Existing public desktop/mobile/dark catalog screenshots in `docs/screenshots/product-ui/` already match the same source commit and are reused where relevant.

## Limits

No full regression suite was rerun for this documentation-only refresh. Original CI/stdout links retain their original provenance. No live AI provider, staging deployment, Stripe checkout, production email, real upstream credential attachment, or multi-page audit pagination was verified. PR #7 remains staging preparation only; its latest UI preview is explicitly context, not staging evidence.

Screenshots are JPEGs as returned by the browser, without synthetic overlays or altered page content. Dummy fixture names/account identifiers and a masked test key prefix may appear; no secret values are included.
