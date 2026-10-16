# Astae Remote CLI — experimental one-command agent

> ⚠️ **Prototype, not a working drop-in replacement for the live Railway Relay.** The current Relay `v1.3.3-lock1` does not implement the proposed `/device/*` endpoints. This code never claims that an unpaired device is connected.

## Quick start / شروع سریع

Install Node.js 20+, then from the `cli/` directory run:

```powershell
.\astae-remote.cmd
```

On Windows CMD, use `astae-remote.cmd`; on Linux/macOS:

```sh
node bin/astae-remote.mjs status
node bin/astae-remote.mjs remote
```

Run the automated tests:

```sh
npm test
```

**Important:** `remote` currently displays the status of an existing running Astae agent if a recent local heartbeat is found, but does not reuse its private credentials, grant ChatGPT OAuth, or create a duplicate Agent. With no existing Agent, it needs the still-unimplemented Device Authorization API on the Relay. Do not try this as a live remote installer yet.

## Included files

- `bin/astae-remote.mjs`: colored terminal status, device pairing client, reconnect/backoff.
- `lib/core.mjs`: HTTP client, session storage, legacy status check, read-only job allowlist.
- `astae-remote.cmd`: Windows entrypoint.
- `test/core.test.mjs`: six Node.js tests.
- `package.json`: package metadata (`private: true`, not yet on npm).

## Next steps (required before public use)

1. Implement owner-authenticated Device Authorization endpoints on a separate staging Relay (`/device/authorization`, `/device/token`, `/device/heartbeat`, `/device/jobs`, result submit, and `/device/verify`). A user code alone must **not** authorize device access.
2. Bind tokens to owner+device+scopes; enforce rate limits, rotation/revocation, expiry, audit logging, and account isolation.
3. Connect ChatGPT using a standards-compliant remote MCP OAuth flow separately from device pairing. No auto-approval or per-request Windows MessageBox.
4. Test end-to-end on Windows/macOS/Linux, then migrate production with backups and rollback. Do **not** replace the running Railway service or existing paired Agent with this prototype.
5. Confirm npm name availability and complete security review before changing `private: true` or advertising an `npx` one-liner.

## Safety

Only `ping`, `system_info`, and `read_file` (within `~/AstaeRemote`, 64 KiB max) are allowed by this prototype. No shell or writes. Device credentials are stored locally in `~/.astae-remote-cli/session.json` and **must never be committed**. Exclude `agent_auth.json`, `relay_agent.json`, tokens, secrets, credentials, and `.env` files. Do not use wildcard OAuth callback allowlists.

References: [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OpenAI MCP Auth](https://developers.openai.com/plugins/build/auth), [Desktop Commander Remote reference](https://github.com/wonderwhy-er/DesktopCommanderMCP).
