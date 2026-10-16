# Astae Remote Device Pairing (staging)

This is a **working device-pairing prototype** built with Node.js 20+ and no external npm packages. It **does not yet implement remote MCP OAuth or remote commands**. Do not market it as production-ready.

## Start local relay

From the \`cli/\` directory:

    ASTAE_PAIR_BASE_URL=http://127.0.0.1:9011 node server/server.mjs

On Windows PowerShell:

    $env:ASTAE_PAIR_BASE_URL='http://127.0.0.1:9011'; node server/server.mjs

## On a second terminal

    node bin/astae-remote.mjs remote --relay http://127.0.0.1:9011

1. The CMD/terminal displays an eight-character device code.
2. Open the printed verification page and enter the code. The server creates a browser owner session and an approved device grant.
3. When the agent receives its grant, it sends a credentialed heartbeat and prints green Connected.
4. The dashboard at /devices shows current, owner-scoped device status.

Stop with Ctrl+C. Re-running with a saved agent token reconnects without asking for the code again.

## Test

    npm test

## Public use: not yet safe

This is a STAGING backend. Initial account ownership is inferred from the browser that entered the device code, not from Google/email/OIDC login; this requires hardening for a shared service. Before accepting real remote jobs or deploying as a multi-tenant service, add real user authentication (Google/email/OIDC), account recovery, quotas and distributed rate limiting, audit logs, revocation UI, HTTPS, durable storage and an OAuth 2.1-compliant protected MCP endpoint.

No shell execution is exposed. No existing Railway Relay, paired Windows Agent, or ChatGPT Site is changed by this package.
