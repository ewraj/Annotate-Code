# Security

## Reporting a vulnerability

**Please do not open a public issue.** A public report tells everyone about the problem at
the same moment it tells me, including the people who would misuse it.

Report it privately through GitHub:

1. Go to the [Security Advisories page](https://github.com/ewraj/Annotate-Code/security/advisories/new).
2. Click **Report a vulnerability**.

That is a private channel between you and the maintainer.

Useful things to include: what an attacker can do, the steps to reproduce it, and the
browser and version you saw it on. A proof of concept helps, but a clear description of the
weakness is worth more than a working exploit.

You can expect an acknowledgement within a few days. This is a small project maintained by
one person, so please be patient — and please give me a chance to ship a fix before
disclosing publicly.

## Where the risk actually is

AnnotateCode has no backend and no accounts today. Everything lives in the browser. So the
interesting surface is smaller than it looks, and mostly this:

- **Your data never leaves your machine.** Files and annotations are held in IndexedDB in
  your own browser. There is no server to send them to.
- **Code is rendered, never executed.** Source is syntax-highlighted as text. There is no
  "Run" button and nothing evaluates what you open — that is a product decision, and also a
  security one.
- **The GitHub integration is unauthenticated and read-only.** Public repository metadata
  comes from the GitHub API and file contents from `raw.githubusercontent.com`. The
  application never asks for a token, so there is no token to leak.
- **Untrusted input worth thinking about:** the contents of any repository someone opens,
  file paths in a tree, and repository URLs. Anything that could turn one of those into
  script execution, or reach outside the intended origin, is a real vulnerability — please
  report it.

## Scope

In scope: this repository, and the site at <https://annotatecode.com>.

Out of scope: findings against GitHub, GitHub Pages, or `raw.githubusercontent.com`
themselves — report those to GitHub. Also out of scope: reports with no demonstrated
impact, such as missing headers on a static page with nothing to protect.
