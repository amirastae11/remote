# Chayi Laptop Remote

Independent remote MCP bridge, separate from Desktop Commander.

**Current status:** the private ChatGPT plugin `chayi-laptop-remote` v1.0.0 has been created; local MCP code was syntax-checked and smoke-tested. The Cloudflare edge relay source in `worker/index.js` is a **deployment candidate only**: deployment was blocked and this is **not** an active public endpoint. No remote laptop is paired or online through this independent bridge.

[Open private plugin](https://chatgpt.com/plugins/plugins_6ad155e7f62c8191bf395dcbc92d2064)

The plugin package contains a local stdio MCP server and scoped Python agent. By default, it can only access `~/ChayiRemote`, and does not allow writing unless the local process sets `CHAYI_ALLOW_WRITE=1`. Account installation by itself does not enable remote access from ChatGPT iOS/web. Do not infer an internet endpoint from the source.

Repository is intended for future secure laptop pairing. Never commit bearer credentials or unrestricted remote shell access.

## Astae Remote CLI v0.1.0 (experimental)

The source of the **separate one-command Astae device agent prototype** is in [`cli/`](./cli/). Includes colorful CMD output, reconnect/session scaffolding, the current-Agent compatibility check, and six passing unit tests. **It is not connected to the existing Railway Relay yet**: production does not implement the proposed `/device/*` pairing API. Do not treat local process status as authorization of the ChatGPT account. No existing Railway, Windows Agent, or pairing data was modified by this code upload.

## Astae Device Pairing v0.2 — staging

- [Pairing backend and owner verification page](cli/server/README.md)
- [Colorful Windows CLI](cli/bin/astae-remote.mjs) and [CMD launcher](cli/astae-remote.cmd)
- Device authorization: terminal prints an 8-character code, user confirms it in a browser, token is saved and the agent reconnects automatically. Green **Connected** appears only after an accepted heartbeat.
- Tested on the owner's Windows laptop: 9 tests passed, including a real CLI-to-local-relay pairing roundtrip.

**Important:** This is a staging pair service, not yet a publicly deployable authenticated multi-user remote-control platform. It does not yet link an account to ChatGPT MCP OAuth; only device-pairing and read-only/empty job-polling work. Existing production Relay and paired Agent were not modified.

After a trusted production pairing Relay and real account sign-in are added, users with Node.js and Git can start with a GitHub package via `npx --yes github:amirastae11/remote remote --relay https://PAIR-RELAY-HOST` (preview only). For local status on Windows run `cli\\astae-remote.cmd status`.
