# Usage evidence: what we can and cannot claim

No production adoption figures have been established by this repository update.
A running website, test messages, commits, stars, HTTP requests, and unique
browser identifiers are different signals; none is a verified count of people.

## Read-only FastAPI report

The optional local tool reads only aggregate columns from an explicitly selected
FastAPI SQLite `group_messages` table. It never reads legacy private-message
tables, modifies the DB, contacts a network service, or adds browser telemetry.
Do not point it at an unknown/untrusted database. For example:

```powershell
.\.venv\Scripts\python.exe scripts/usage_report.py --database .\chat.db --environment local --days 30
```

It outputs JSON with the UTC period, source environment, stored message count,
rooms with messages, distinct posting client IDs, referenced image count, and
client IDs posting on at least two different days. It emits no raw client IDs,
room IDs, room links, names, message text, or image URLs. Review even aggregate
counts before sharing them, particularly for small private groups. Reports
belong in ignored `.local-reports/`, not automatically in Git.

Keep the supplied limitations with any report. A client ID is per-tab,
unverified, and can be changed or spoofed. It is **not** a unique person, MAU,
DAU, or an account. A room with messages is not a count of rooms created.
QA, bots, and maintainer activity in a DB remain included. Do not call local or
synthetic data production usage by changing the label.

## Hosted Cloudflare deployment

The live app uses Durable Objects, not this local SQLite database. This tool does
not access or estimate its usage. Cloudflare request analytics can substantiate
requests, but not unique users, retention, or independent deployments. Keep
bot/static asset/test traffic separate. Export only appropriately reviewed,
aggregate production evidence using the provider's existing dashboard; do not
publish screenshots containing credentials, room IDs, or chat history.

There is no new public analytics endpoint, third-party tracker, fingerprinting,
or returning-user cookie in this change. Collecting production retention metrics
would need a separate privacy-reviewed implementation; it is not claimed here.

## Evidence that strengthens a future application

- Genuine community feedback with permission and a public issue/discussion link.
- Independent deployments reported by their maintainers; record an actual public
  URL and consent, not fork counts presented as deployments.
- Dated aggregate production measurements with methodology and exclusions.
- Meaningful merged changes, regression tests, actual CI run URLs, and release
  verification. State whether a check ran locally or in hosted CI.

Use an explicit observation date and source for every number. Missing evidence
should be marked **not measured**, never replaced with a plausible estimate.
