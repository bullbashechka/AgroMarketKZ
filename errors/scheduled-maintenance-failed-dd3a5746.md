# Production error: scheduled maintenance failed

- Error name/type/code: Worker log error; no explicit application error code
- Stable fingerprint: `sha256:dd3a574689051f2cada9c38969956714bf2651595dea805cf3f821428a844c8d`
- Source/service: Cloudflare Workers Observability / `agromarketkz-backend`
- First seen: `2026-08-25T15:20:47.476Z`
- Last seen: `2026-08-25T15:40:47.474Z`
- Occurrence count known to this monitor: `3`
- Message: `scheduled maintenance failed`
- HTTP status: Not provided by source
- Request method/path: Not provided by source; scheduled event (`*/5 * * * *`)
- Request ID: See recent occurrences below
- Worker script/version/outcome: `agromarketkz-backend`; version `2494cd6d-407a-4296-b1f9-ecb993330a1f`; outcome not provided by source
- SQLSTATE: Not provided by source
- Postgres severity: Not provided by source
- Other metadata: dataset `cloudflare-workers`; origin `scheduled`; event type `scheduled`; execution model `stateless`; Cloudflare fingerprint `2ae677d999d9aa5c2735b95073c1b781`; source event reported `truncated: false`

## Stack trace

```text
at EventEmitter.write (worker.js:18124:16)
at nextWrite (worker.js:19003:22)
at worker.js:18164:7
at cachedError (worker.js:18314:23)
at new Query (worker.js:18208:75)
at sql2 (worker.js:20092:61)
at Object.apply (worker.js:20535:30)
```

## Recent occurrences

- `2026-08-25T15:40:47.474Z` — request ID `5468057f7a0cf1ba71278d3bd094a736`; trace ID `0f120618905bc6d3de2edd0daba935c5`; span ID `3e879dc905ea609e`; scheduled time `2026-08-25T15:40:47Z`
- `2026-08-25T15:30:47.476Z` — request ID `c890463a243b89624c2f975b2a3942b6`; trace ID `063ae370d6965c97e231d30be94a0399`; span ID `8dfcf3c20d8acccc`; scheduled time `2026-08-25T15:30:47Z`
- `2026-08-25T15:20:47.476Z` — request ID `0675878b6f56d325beb31df5a4a93d5f`; trace ID `6dae4770d8448db24e568a4c7c8f132a`; span ID `083d60ba63a6f5ae`; scheduled time `2026-08-25T15:20:47Z`
