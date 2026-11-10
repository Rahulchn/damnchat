# Damn Chat: maintainer evidence and application draft

Prepared 2026-11-10. This is a factual working document, not an eligibility
decision, testimonial, application submission, or claim of ecosystem importance.

## Public baseline

- Repository: https://github.com/Rahulchn/damnchat
- Live demonstration: https://damnchat.me
- Public GitHub API checked on 2026-11-10: **0 stars, 0 forks, 0 open issues**.
- Before this update GitHub detected no license. This working tree adds MIT for
  the original project work and an asset provenance inventory. Verify the
  published repository after the update; do not treat a local file as proof that
  GitHub has recognized the license.
- Production active users, returning people, independent deployments, and
  downstream dependents: **not measured / not established**. No claims of
  adoption are made from the demo or local QA.
- January 2026 is an owner-supplied founding date in site copy. The visible Git
  history begins on 2026-09-23; do not represent the founding date as a commit
  history date, incorporation evidence, or proof of adoption.

## Concrete maintenance responsibility

The repository records work on both the FastAPI and Cloudflare implementations:

- [Secure media sharing and video previews](https://github.com/Rahulchn/damnchat/commit/d167350): upload validation and media handling.
- [Cloudflare hosting option](https://github.com/Rahulchn/damnchat/commit/a991569): hosted backend and local smoke-check workflow.
- [Hangouts, theater layout, and typed media](https://github.com/Rahulchn/damnchat/commit/769fb49): room isolation, synchronization, invitations, and regression tests.
- [Safe pasted-image previews](https://github.com/Rahulchn/damnchat/commit/9185091): explicit send flow, validation, and tests.
- [Public crawler discovery](https://github.com/Rahulchn/damnchat/commit/3d3b872): public company pages and room/API indexing directives.

These show development and maintenance work, not issue-response performance or
third-party adoption. The new `Tests` workflow is configured for pushes/PRs; link
an actual successful run after it executes. No hosted CI result is assumed here.

## Proposed Codex workflows

These are plans for maintainer work, not an existing automated API integration:

1. Review changes affecting WebSocket reconnects, sender binding, room isolation,
   and watch-host ownership across the two backends.
2. Turn reproducible bugs into regression tests before implementing fixes, using
   synthetic data rather than user histories or private room links.
3. Review media/clipboard validation, dependency updates, and untrusted-link
   handling; keep human review and local smoke checks before deployment.
4. Draft release notes from actual merged changes and test results, including
   limitations and migration risks.

There is no scheduled paid API workflow in this change. Existing Codex plan/API
usage can still consume credits; no funding or approval is promised.

## Short application draft

> I maintain Damn Chat, a browser-based chat and watch-party project with a
> FastAPI backend and a Cloudflare Workers version. I work on room isolation,
> WebSocket reliability, uploads, and the shared frontend, and maintain regression
> tests for those behaviors. The project has a live demo, but it is still early
> and I cannot yet demonstrate broad adoption or downstream dependency.
>
> I would use Codex for reviewing backend changes, reproducing bugs, expanding
> regression coverage, and preparing accurate release notes. My aim is to make
> the project easier for others to run and contribute to, rather than claim that
> it is already widely used.

Review before submitting; verify repository write access, the published license,
test run links, and any newer adoption evidence. The maintainer should personally
review the program terms and submit the application. No form is submitted here.

Official criteria: https://developers.openai.com/community/codex-for-oss

The official page allows core maintainers to apply and says to explain a genuine
ecosystem role if the project does not fit the usual profile. That is not a
guarantee of admission, credits, Pro access, or Codex Security access.
