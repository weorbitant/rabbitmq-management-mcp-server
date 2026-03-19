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

**Returns:** Array of queue summaries.

**Sorting** is performed client-side on the returned page of results.

**Example output:**
```json
{
  "total_count": 12,
  "page": 1,
  "page_size": 100,
  "items": [
    {
      "name": "orders.processing",
      "vhost": "/",
      "messages": 58342,
      "messages_ready": 58100,
      "messages_unacknowledged": 242,
      "consumers": 2,
      "consumer_utilisation": 0.45,
      "message_stats": {
        "publish_details": { "rate": 12.4 },
        "deliver_get_details": { "rate": 3.1 },
        "ack_details": { "rate": 2.8 }
      },
      "state": "running"
    }
  ]
}
```

**Management API:** `GET /api/queues/{vhost}?page={page}&page_size={page_size}`

### `get-queue-details`

Deep-dive on a single queue.

**Parameters:**
- `queue_name: string` (required)

**Returns:** Full queue details including memory, arguments, policy, and detailed message stats.

**Example output:**
```json
{
  "name": "orders.processing",
  "vhost": "/",
  "messages": 58342,
  "messages_ready": 58100,
  "messages_unacknowledged": 242,
  "consumers": 2,
  "consumer_utilisation": 0.45,
  "memory": 28491776,
  "state": "running",
  "arguments": {
    "x-queue-type": "classic",
    "x-max-priority": 10
  },
  "policy": "ha-all",
  "idle_since": null,
  "message_stats": {
    "publish": 142850,
    "publish_details": { "rate": 12.4 },
    "deliver_get": 84508,
    "deliver_get_details": { "rate": 3.1 },
    "ack": 84266,
    "ack_details": { "rate": 2.8 },
    "redeliver": 120,
    "redeliver_details": { "rate": 0.1 }
  },
  "backing_queue_status": {
    "mode": "default",
    "q1": 0,
    "q2": 0,
    "q3": 58100,
    "q4": 0,
    "len": 58100
  }
}
```

**Management API:** `GET /api/queues/{vhost}/{queue_name}`

### `list-queue-consumers`

List consumers attached to a queue.

**Parameters:**
- `queue_name: string` (required)

**Returns:** Array of consumers extracted from the queue's `consumer_details`.

**Example output:**
```json
[
  {
    "consumer_tag": "amq.ctag-abc123",
    "channel_details": {
      "connection_name": "10.0.1.50:54321 -> 10.0.1.10:5672",
      "name": "10.0.1.50:54321 -> 10.0.1.10:5672 (1)",
      "number": 1,
      "peer_host": "10.0.1.50",
      "peer_port": 54321
    },
    "prefetch_count": 1,
    "ack_required": true,
    "active": true,
    "activity_status": "up"
  }
]
```

**Management API:** `GET /api/queues/{vhost}/{queue_name}` — extracts the `consumer_details` field from the queue detail response, which is more efficient than fetching all vhost consumers and filtering client-side.

### `get-queue-messages`

Peek at messages in a queue. Uses `ack_requeue_true` mode — the message is fetched, then immediately requeued so it remains in the queue and is not consumed. **Note:** This tool uses HTTP POST (required by the Management API), but is semantically read-only since messages are always requeued.

**Parameters:**
- `queue_name: string` (required)
- `count?: number` — Number of messages to peek (default: 1, max: 10)
- `encoding?: string` — `auto` or `base64` (default: `auto`)

**Returns:** Array of messages with payload and metadata.

**Example output:**
```json
[
  {
    "payload": "{\"orderId\":\"ORD-9821\",\"status\":\"pending\"}",
    "payload_encoding": "string",
    "payload_bytes": 43,
    "properties": {
      "headers": { "x-retry-count": 3 },
      "content_type": "application/json",
      "delivery_mode": 2,
      "message_id": "msg-abc-123",
      "timestamp": 1742400000
    },
    "exchange": "orders.exchange",
    "routing_key": "orders.processing",
    "redelivered": true,
    "message_count": 58341
  }
]
```

**Management API:** `POST /api/queues/{vhost}/{queue_name}/get`

### `list-connections`

List broker connections.

**Parameters:**
- `filter_name?: string` — Filter by connection name substring

**Returns:** Array of connections with flow control and rate info.

**Example output:**
```json
{
  "total_count": 5,
  "page": 1,
  "page_size": 100,
  "items": [
    {
      "name": "10.0.1.50:54321 -> 10.0.1.10:5672",
      "state": "running",
      "peer_host": "10.0.1.50",
      "peer_port": 54321,
      "ssl": false,
      "protocol": "AMQP 0-9-1",
      "user": "app-service",
      "vhost": "/",
      "channels": 3,
      "connected_at": 1742300000000,
      "recv_oct_details": { "rate": 1024.5 },
      "send_oct_details": { "rate": 8192.3 },
      "flow": false
    }
  ]
}
```

**Management API:** `GET /api/connections`

### `get-connection-details`

Details on a specific connection.

**Parameters:**
- `connection_name: string` (required)

**Returns:** Full connection details including client properties and limits.

**Example output:**
```json
{
  "name": "10.0.1.50:54321 -> 10.0.1.10:5672",
  "state": "running",
  "peer_host": "10.0.1.50",
  "peer_port": 54321,
  "ssl": false,
  "protocol": "AMQP 0-9-1",
  "user": "app-service",
  "vhost": "/",
  "channels": 3,
  "connected_at": 1742300000000,
  "channel_max": 2047,
  "frame_max": 131072,
  "timeout": 60,
  "client_properties": {
    "product": "node-amqp",
    "version": "0.9.1",
    "connection_name": "order-processor"
  },
  "recv_oct_details": { "rate": 1024.5 },
  "send_oct_details": { "rate": 8192.3 },
  "flow": false
}
```

**Management API:** `GET /api/connections/{connection_name}`

### `list-channels`

List channels with diagnostic data.

**Parameters:**
- `connection_name?: string` — Filter by parent connection

**Returns:** Array of channels with prefetch and unacked info.

**Example output:**
```json
{
  "total_count": 8,
  "page": 1,
  "page_size": 100,
  "items": [
    {
      "name": "10.0.1.50:54321 -> 10.0.1.10:5672 (1)",
      "connection_details": {
        "name": "10.0.1.50:54321 -> 10.0.1.10:5672",
        "peer_host": "10.0.1.50",
        "peer_port": 54321
      },
      "number": 1,
      "state": "running",
      "prefetch_count": 1,
      "messages_unacknowledged": 1,
      "messages_unconfirmed": 0,
      "consumer_count": 1,
      "confirm": false,
      "transactional": false
    }
  ]
}
```

**Management API:** `GET /api/channels`

### `get-overview`

Broker-level overview.

**Parameters:** None.

**Returns:** Broker-level summary with totals and rates.

**Example output:**
```json
{
  "cluster_name": "rabbit@prod-01",
  "rabbitmq_version": "3.12.10",
  "erlang_version": "26.1.2",
  "message_stats": {
    "publish": 1542850,
    "publish_details": { "rate": 45.2 },
    "deliver_get": 1484508,
    "deliver_get_details": { "rate": 38.7 },
    "ack": 1484200,
    "ack_details": { "rate": 38.5 }
  },
  "queue_totals": {
    "messages": 62410,
    "messages_ready": 61800,
    "messages_unacknowledged": 610
  },
  "object_totals": {
    "queues": 12,
    "connections": 5,
    "channels": 8,
    "consumers": 6,
    "exchanges": 15
  },
  "node": "rabbit@prod-01",
  "listeners": [
    { "protocol": "amqp", "port": 5672 },
    { "protocol": "http", "port": 15672 }
  ]
}
```

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
