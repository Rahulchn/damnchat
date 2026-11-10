# Contributing to Damn Chat

Small, reproducible improvements are welcome. Explain the problem first in a
GitHub issue, or open a focused pull request with a regression test. Do not
manufacture issues, stars, forks, or deployments to improve an application.

## Development checks

Use Node.js 24 and Python 3.13, matching CI:

```powershell
npm ci
python -m pip install -r requirements-dev.txt
npm test
npm run check:cloud
python -m pytest -q -p no:cacheprovider
```

On Windows, use `.venv\Scripts\python.exe` after creating your virtual
environment. If the OS temporary folder is inaccessible, pass a **new, unused**
`.pytest-tmp-<unique-name>` as `--basetemp`; pytest clears that target.

The `Tests` workflow runs the JavaScript and Python suites on pull requests and
pushes. It has read-only repository permissions and no deployment or AI secrets.
The Cloudflare end-to-end smoke test remains a separate local check:
start `npm run dev:cloud -- --port 8787` with a local test `RATE_SALT`, then run
`npm run smoke:cloud` in a second terminal. Never run smoke against production:
it posts test messages and images.

## Review checklist

- Keep FastAPI and Cloudflare room behavior in sync. Test validation, room
  isolation, reconnects, and compatibility with stored messages.
- Preserve link-based privacy warnings. Do not fetch arbitrary pasted URLs from
  the server or expose room IDs through public analytics.
- Test phone/desktop layouts and both themes for visual changes.
- Use synthetic data, never production histories, credentials, or user uploads.
- Add only assets with clear provenance and suitable redistribution permission.
  Read `THIRD_PARTY_NOTICES.md`; do not restore the retired meme/photo avatars.
- Document verification honestly. A local test result is not a passing hosted CI
  run, and a live website is not proof of adoption.

Your original contributions are provided under the project's MIT license. Keep
third-party notices intact and disclose external code or asset sources.

## Reporting and conduct

Be respectful. Bug reports should include expected/actual behavior, browser,
steps to reproduce, and a redacted screenshot only when useful. Public GitHub
issues are not a private security-reporting channel; see `SECURITY.md`.
