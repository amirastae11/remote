# Chayi Laptop Remote

Independent remote MCP bridge, separate from Desktop Commander.

**Current status:** the private ChatGPT plugin `chayi-laptop-remote` v1.0.0 has been created; local MCP code was syntax-checked and smoke-tested. The Cloudflare edge relay source in `worker/index.js` is a **deployment candidate only**: deployment was blocked and this is **not** an active public endpoint. No remote laptop is paired or online through this independent bridge.

[Open private plugin](https://chatgpt.com/plugins/plugins_6ad155e7f62c8191bf395dcbc92d2064)

The plugin package contains a local stdio MCP server and scoped Python agent. By default, it can only access `~/ChayiRemote`, and does not allow writing unless the local process sets `CHAYI_ALLOW_WRITE=1`. Account installation by itself does not enable remote access from ChatGPT iOS/web. Do not infer an internet endpoint from the source.

Repository is intended for future secure laptop pairing. Never commit bearer credentials or unrestricted remote shell access.

## Astae Remote CLI v0.1.0 (experimental)

The source of the **separate one-command Astae device agent prototype** is in [`cli/`](./cli/). Includes colorful CMD output, reconnect/session scaffolding, the current-Agent compatibility check, and six passing unit tests. **It is not connected to the existing Railway Relay yet**: production does not implement the proposed `/device/*` pairing API. Do not treat local process status as authorization of the ChatGPT account. No existing Railway, Windows Agent, or pairing data was modified by this code upload.
