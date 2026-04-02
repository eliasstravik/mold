# Security

## Security model

Mold is a webhook bridge that forwards payloads between two Clay tables. Here's how it handles security:

**Authentication:**
- The `/bridge` endpoint requires a Bearer token (`API_TOKEN` env var)
- Hono's bearer auth middleware uses timing-safe comparison to prevent side-channel attacks

**Callback security:**
- The `/callback/:id` endpoint requires the same Bearer token as `/bridge`
- Callback UUIDs provide an additional layer of unguessability (122 bits of randomness)
- Callback UUIDs are never logged to prevent leakage
- Callback entries are short-lived (cleaned up after timeout or 30 seconds post-resolution)

**Request limits:**
- 1MB body size limit on all endpoints
- Configurable maximum concurrent pending requests (default 100)
- 30-second timeout on the forward request to Table B
- Configurable overall timeout (default 5 minutes)

**Known limitations:**
- Single-process only. In-memory state is lost on restart
- No request body validation beyond JSON parsing. Mold is a transparent bridge
- The `_mold_callback_url` is injected into the forwarded payload and visible to Table B and any intermediaries

## Reporting vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include steps to reproduce and potential impact

We aim to respond within 48 hours and will credit reporters in the fix.
