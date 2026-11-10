# Security and privacy limitations

Damn Chat currently has no verified accounts, end-to-end encryption, in-app
moderation/reporting, age verification, or self-service message deletion. A room
link grants access to its history; do not treat it as a confidential vault.

## Responsible disclosure

Do not post exploitable details, credentials, private room URLs, user messages,
or uploads in a public issue. If GitHub's **Report a vulnerability** option is
available for this repository, use that private channel. This file does not
claim that private vulnerability reporting is enabled. Otherwise open a minimal
issue requesting a private contact route without including the sensitive details.
There is no response-time SLA or paid bounty program.

Reports should use synthetic data and minimal reproduction steps. Do not probe
or disrupt live users, enumerate invite links, or upload harmful content. Test
locally or on a deployment you control.

## Maintainer release checks

Run tests and the local smoke check; verify room isolation, upload validation,
metadata removal, rate limits, and crawler `noindex` headers. Keep secrets out
of source and logs. CI does not deploy or access production content. Review
dependencies and deployment settings before a public release; passing tests are
not a security certification.
