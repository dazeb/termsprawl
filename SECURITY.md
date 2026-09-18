# Security policy

termsprawl is a pre-1.0 Linux desktop application (Electron + React + tmux)
with an optional browser-based Server Edition and a standalone relay service.
It is maintained by one person. This policy describes what is covered, how to
report a vulnerability privately, and what to realistically expect.

## Supported versions

Only the current release line receives security fixes. At the time of writing
that is **0.28.x** (pre-1.0). Older releases are not backported; a fix ships in
a new release on the current line. There is no bug bounty and no response-time
guarantee — see [What to expect](#what-to-expect).

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting:

**https://github.com/dazeb/termsprawl/security/advisories/new**

If you cannot use GitHub advisories, email **daz@dazeb.dev** with the subject
`termsprawl security` and a description of the issue.

Please do **not** open a public issue for a suspected vulnerability.

**Never include secrets in a report.** Do not send API keys, OAuth or GitHub
tokens, relay invite codes, JWT secrets, vault contents, or personal data. The
maintainer will never ask you for them. If a credential may have been exposed,
revoke or rotate it first, and describe *where* it leaked without pasting the
value.

### What a useful report contains

- affected version (the app shows it in the title bar; `package.json` has it)
- how the component was run (packaged AppImage/.deb, `pnpm run dev`, Server
  Edition, container image, self-hosted relay)
- steps to reproduce, or a minimal proof of concept
- impact — what an attacker gains, and what access they need first
- any suggested fix or mitigation (optional)

## What is covered

- the desktop application: Electron main/preload/renderer, the Electron-free
  core services, PTY/tmux session handling, scrollback handling, the workspace
  store and project files
- the Server Edition (`src/server/`) — the HTTP/WebSocket surface, token and
  bind guards, path boundaries
- the standalone relay service (`relay/`), including its invite, admin, and
  encryption code as shipped in this repository
- the cloud integration code in this repository: the cloud client, snapshot
  sync, and the GitHub import broker client. The hosted preview services are
  operated privately; their code paths reachable from this repository are in
  scope, and issues in deployed infrastructure can be reported here too.
- the embedded browser node's hardening: sandbox flags, navigation policy, and
  the opt-in localhost-only CDP surface

## Out of scope

- **Third-party agent CLIs and their services.** Claude Code, Codex CLI,
  Antigravity, Grok, OpenClaude, and OpenCode are separate products with their
  own security processes. Report vulnerabilities in those tools to their
  vendors. The same applies to their APIs and hosted services.
- **Third-party dependencies.** If the issue is in an upstream package (for
  example Electron, node-pty, or `ws`), report it upstream — but a heads-up is
  welcome so the pinned version can be bumped here.
- **The platforms and hosts underneath.** GitHub, Gitea, Docker, Proxmox, the
  Linux kernel, desktop environments, and tmux have their own processes; a
  report that only reproduces in one of those belongs there.
- **Hosted preview services as production.** The optional hosted services are
  preview-stage with test-mode billing and explicit quotas; they are not sold
  or advertised as hardened multi-tenant infrastructure for arbitrary use.
  Still, report anything you find — it will be triaged.
- Social engineering, physical access, and denial-of-service by traffic volume
  against privately operated hosts.

## Disclosure process

1. You report privately (GitHub advisory preferred).
2. The maintainer acknowledges, on a best-effort basis, typically within five
   working days. This is a personal target, not a contractual SLA.
3. The report is triaged: affected versions, severity, and whether it is in
   scope. Clarifying questions may follow.
4. A fix is developed and released on the current line. You are asked to keep
   the details private until a fix has shipped.
5. An advisory is published through GitHub Security Advisories when a fix is
   available, crediting the reporter unless anonymity is requested. If a report
   is out of scope or will not be fixed, that outcome is stated in the advisory
   thread.

The maintainer may make an exception to the normal release flow for security
fixes — for example, releasing a fix without the usual feature content, or
coordinating with a downstream distributor before publication.

## What to expect

This project is maintained by one person, and there is no on-call rotation.
Response and fix times are best-effort and depend on severity and complexity.
The project operates no production service with uptime commitments; hosted
preview services may be restarted, rotated, or suspended. If you receive no
acknowledgement within ten working days, a polite follow-up is appropriate.

Good-faith security research conducted under this policy is welcome. Do not
access other users' data, do not degrade the service for others, and do not
publish exploitation details before a fix has shipped or 90 days have passed,
whichever comes first.

## Hardening notes for self-hosters

- The Server Edition binds to loopback by default. Do not expose it directly to
  the internet; put TLS and access control in front of it if you must reach it
  remotely, and keep its boot token private.
- The relay service sees ciphertext only by design; still, deploy it behind TLS
  and treat invite codes as credentials.
- Run releases from the official GitHub Releases page and verify you are on a
  version that is still the current line. Releases from the next version onward
  publish `SHA256SUMS` alongside the artifacts; check a download with
  `sha256sum -c SHA256SUMS` after saving the artifacts and the checksum file
  into the same directory. (This is download-integrity checking only — there is
  no code signing or provenance attestation.)
