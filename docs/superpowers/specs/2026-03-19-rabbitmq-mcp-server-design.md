# RabbitMQ MCP Server — Design Spec

## Overview

An MCP (Model Context Protocol) server that exposes read-only diagnostic tools for inspecting a RabbitMQ broker. Built to help diagnose slow consumption, stalled consumers, and queue health issues through any MCP-compatible coding agent (Claude Code, Cursor, Kilo Code, OpenCode, etc.).

### Motivation

- No working RabbitMQ MCP server exists in the ecosystem
- Need to diagnose why messages in certain queues are consumed slowly (~60k messages taking ~24h)
- Want diagnostic data accessible directly from coding agents during development/debugging sessions

### Scope

**V1 (this spec):** Read-only inspection via RabbitMQ Management HTTP API only.
**Phase 2 (future):** AMQP connection for message publishing, peek, and latency measurement. See [Phase 2 Roadmap](#phase-2-roadmap-future).

## Architecture

### Approach

Pure Management HTTP API — all tools issue HTTP requests to the RabbitMQ Management API (`/api/...`). No AMQP dependency in v1.

**Rationale:** The Management API provides all diagnostic metrics needed (consumer utilization, message rates, prefetch, flow control). Keeping the server HTTP-only means zero native dependencies and a minimal footprint.

### Transport

stdio — the universal MCP transport. The server communicates over stdin/stdout, compatible with all MCP clients.

### Configuration

Environment variables only:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RABBITMQ_MANAGEMENT_URL` | Yes | — | Management API base URL (e.g. `http://localhost:15672`) |
| `RABBITMQ_USERNAME` | Yes | — | Management API username |
| `RABBITMQ_PASSWORD` | Yes | — | Management API password |
| `RABBITMQ_VHOST` | No | `/` | Target vhost |
| `RABBITMQ_REQUEST_TIMEOUT_MS` | No | `10000` | HTTP request timeout in milliseconds |

The server validates all required env vars at startup and fails with a clear message listing any missing variables.

### Project Structure

```
rabbitmq-mcp-server/
├── src/
│   ├── index.ts              # Entry point — MCP server setup, tool registration
│   ├── config.ts             # Env var parsing and validation
│   ├── rabbitmq-client.ts    # Management API HTTP client
│   └── tools.ts              # All tool handlers and definitions
├── tests/
│   ├── rabbitmq-client.test.ts
│   └── tools.test.ts
├── dist/                     # Compiled output (gitignored)
├── package.json
├── tsconfig.json
└── .env.example
```

**Build:** `tsc` compiles to `dist/`. The MCP server entry point for clients is `node dist/index.js`.

### Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — input schema validation (peer dependency of the SDK)
- `vitest` — test framework (dev dependency)
- `typescript` — (dev dependency)

No other runtime dependencies. Uses Node.js built-in `fetch` (Node 18+).

### HTTP Client Resilience

- **Request timeout:** 10 seconds per request (configurable via `RABBITMQ_REQUEST_TIMEOUT_MS` env var, default `10000`)
- **No automatic retries in v1** — errors surface immediately to the agent, which can retry at its discretion
- **Logging:** Structured JSON logs to stderr (stdout is reserved for MCP transport). Log levels: `error` (failed requests, startup failures), `warn` (slow responses > 5s), `info` (startup config summary — URL and vhost, never credentials)

### Pagination Strategy

The RabbitMQ Management API paginates list endpoints (default 100 items). The MCP server handles this transparently:

- List tools (`list-queues`, `list-connections`, `list-channels`) accept an optional `page` and `page_size` parameter (default: `page=1`, `page_size=100`, max `500`)
- Responses include `total_count`, `page`, `page_size`, and `filtered_count` alongside the items array
- The agent can paginate by requesting subsequent pages if `total_count > page * page_size`

## MCP Tools

All tools are read-only (semantically — see note on `get-queue-messages`). They return structured JSON responses.

### `list-queues`

List all queues with summary stats.

**Parameters:**
- `sort_by?: string` — Sort field: `name`, `messages`, `consumers`, `message_rate` (default: `name`)
- `filter_name?: string` — Filter queues by name substring match

**Returns:** Array of queue summaries: name, vhost, messages (ready/unacked/total), consumers, message rates (publish/deliver/ack per second), state, consumer_utilisation.

**Sorting** is performed client-side on the returned page of results.

**Management API:** `GET /api/queues/{vhost}?page={page}&page_size={page_size}`

### `get-queue-details`

Deep-dive on a single queue.

**Parameters:**
- `queue_name: string` (required)

**Returns:** Full queue details: all fields from `list-queues` plus memory usage, queue arguments (x-max-priority, x-queue-type, etc.), idle_since, policy, backing_queue_status, detailed message_stats with rate breakdowns.

**Management API:** `GET /api/queues/{vhost}/{queue_name}`

### `list-queue-consumers`

List consumers attached to a queue.

**Parameters:**
- `queue_name: string` (required)

**Returns:** Array of consumers: consumer_tag, channel_details (connection name, peer address, channel number), prefetch_count, ack_required, active, activity_status.

**Management API:** `GET /api/queues/{vhost}/{queue_name}` — extracts the `consumer_details` field from the queue detail response, which is more efficient than fetching all vhost consumers and filtering client-side.

### `get-queue-messages`

Peek at messages in a queue. Uses `ack_requeue_true` mode — the message is fetched, then immediately requeued so it remains in the queue and is not consumed. **Note:** This tool uses HTTP POST (required by the Management API), but is semantically read-only since messages are always requeued.

**Parameters:**
- `queue_name: string` (required)
- `count?: number` — Number of messages to peek (default: 1, max: 10)
- `encoding?: string` — `auto` or `base64` (default: `auto`)

**Returns:** Array of messages: payload, payload_encoding, properties (headers, content_type, delivery_mode, etc.), exchange, routing_key, redelivered, message_count.

**Management API:** `POST /api/queues/{vhost}/{queue_name}/get`

### `list-connections`

List broker connections.

**Parameters:**
- `filter_name?: string` — Filter by connection name substring

**Returns:** Array of connections: name, state, peer_host, peer_port, ssl, protocol, user, vhost, channels, connected_at, send/recv rates, flow (backpressure indicator).

**Management API:** `GET /api/connections`

### `get-connection-details`

Details on a specific connection.

**Parameters:**
- `connection_name: string` (required)

**Returns:** Full connection details including channel_max, frame_max, timeout, client_properties, and all fields from `list-connections`.

**Management API:** `GET /api/connections/{connection_name}`

### `list-channels`

List channels with diagnostic data.

**Parameters:**
- `connection_name?: string` — Filter by parent connection

**Returns:** Array of channels: name, connection_details, number, state, prefetch_count, messages_unacknowledged, messages_unconfirmed, consumer_count, confirm, transactional.

**Management API:** `GET /api/channels`

### `get-overview`

Broker-level overview.

**Parameters:** None.

**Returns:** Cluster name, RabbitMQ version, Erlang version, message totals (ready/unacked/total with rates), queue/connection/channel/consumer/exchange totals, node health, listeners.

**Management API:** `GET /api/overview`

## Diagnostic Value

For the primary use case (diagnosing slow consumption), the key metrics surfaced:

| Metric | Source Tool | What It Tells You |
|--------|-------------|-------------------|
| `consumer_utilisation` | `get-queue-details` | 0.0–1.0 — if < 1.0, consumer can't keep up |
| `prefetch_count` | `list-queue-consumers`, `list-channels` | Low prefetch (e.g. 1) throttles throughput |
| `messages_unacknowledged` | `get-queue-details`, `list-channels` | High = consumer holds messages without acking |
| `messages_ready` | `get-queue-details` | High = broker has messages but no consumer fetching |
| `deliver_get.rate` vs `publish.rate` | `get-queue-details` | Consumption vs ingestion speed |
| `ack.rate` | `get-queue-details` | How fast consumer acknowledges |
| `flow` | `list-connections` | `true` = broker applying backpressure |

## Error Handling

- **Missing config:** Fail at startup with a message listing missing env vars
- **Connection errors** (ECONNREFUSED, timeout): Return error with URL attempted + suggestion to verify `RABBITMQ_MANAGEMENT_URL`
- **Auth errors** (401/403): Clear message about credentials — never leak password in error output
- **Not found** (404): Return `"Queue 'X' not found. Use list-queues to see available queues."`
- **Malformed responses:** Return status code + raw body hint
- **All errors:** Returned as MCP tool error responses, never thrown as uncaught exceptions

## Testing

- **Unit tests for `rabbitmq-client.ts`:** Mock `fetch`, verify URL construction, auth headers, vhost encoding, error mapping
- **Unit tests for tool handlers:** Mock the client, verify response shaping, parameter validation, edge cases
- **Framework:** Vitest
- **No integration tests in v1.** Phase 2 can add Docker Compose-based integration tests with a real RabbitMQ instance.

## Phase 2 Roadmap (Future)

Evolve from Approach A (HTTP-only) to Approach B (HTTP + AMQP hybrid):

- **Add AMQP dependency** — `amqplib` or `rascal` (team is familiar with rascal)
- **`publish-message` tool** — Send a message to an exchange/queue with configurable properties
- **`peek-messages` tool (enhanced)** — Non-destructive message peek via AMQP `basic.get` with requeue (more reliable than Management API's `/get` endpoint)
- **`measure-latency` tool** — Publish a timestamped message, consume it, report round-trip time
- **Subscribe & stream** — Temporarily subscribe to a queue and stream messages back to the agent
- **Docker Compose integration tests** — Real RabbitMQ instance for end-to-end testing
- **Multiple vhost support** — Allow specifying vhost per tool call
- **Config profiles** — Support multiple broker configurations (dev/staging/prod)
