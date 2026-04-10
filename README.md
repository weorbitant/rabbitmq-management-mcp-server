# RabbitMQ MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes RabbitMQ Management HTTP API as diagnostic tools. Connect it to any MCP-compatible coding agent (Claude Code, Cursor, Kilo Code, OpenCode, etc.) to inspect queue health, diagnose slow consumers, and monitor broker state — directly from your AI assistant.

## Why

Diagnosing slow message consumption in RabbitMQ requires correlating several metrics: `consumer_utilisation`, prefetch counts, unacknowledged message backlogs, and flow control status. Doing this in the Management UI is tedious during a debugging session. This server puts those diagnostics a natural-language prompt away.

## Features

- **8 diagnostic tools** covering queues, connections, channels, and broker overview
- **Read-only** — no mutations to broker state (message peek uses `ack_requeue_true`)
- **Zero native dependencies** — uses Node.js built-in `fetch`, no AMQP client needed
- **Stdio transport** — compatible with all MCP clients out of the box
- **Paginated responses** — handles large RabbitMQ deployments cleanly

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- RabbitMQ with the Management Plugin enabled (`rabbitmq-plugins enable rabbitmq_management`)

## Installation

```bash
git clone https://github.com/orbitant/rabbitmq-management-mcp-server.git
cd rabbitmq-management-mcp-server
npm install
npm run build
```

## Configuration

The server is configured via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `RABBITMQ_MANAGEMENT_URL` | Yes | — | Management API base URL (e.g. `http://localhost:15672`) |
| `RABBITMQ_USERNAME` | Yes | — | Management API username |
| `RABBITMQ_PASSWORD` | Yes | — | Management API password |
| `RABBITMQ_VHOST` | No | `/` | Target vhost |
| `RABBITMQ_REQUEST_TIMEOUT_MS` | No | `10000` | HTTP request timeout in milliseconds |

Missing required variables are reported at startup with a clear error message.

## Running

```bash
RABBITMQ_MANAGEMENT_URL=http://localhost:15672 \
RABBITMQ_USERNAME=guest \
RABBITMQ_PASSWORD=guest \
node dist/index.js
```

All server logs go to `stderr`. `stdout` is reserved for the MCP transport.

## Connecting to Claude Code

Add the server to your Claude Code MCP configuration (`~/.claude/mcp.json` or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "rabbitmq": {
      "command": "node",
      "args": ["/absolute/path/to/rabbitmq-management-mcp-server/dist/index.js"],
      "env": {
        "RABBITMQ_MANAGEMENT_URL": "http://localhost:15672",
        "RABBITMQ_USERNAME": "guest",
        "RABBITMQ_PASSWORD": "guest",
        "RABBITMQ_VHOST": "/"
      }
    }
  }
}
```

## Available Tools

### `get-overview`

Broker-level summary: cluster name, RabbitMQ version, aggregate message rates, object counts (queues, connections, channels, consumers, exchanges), and listener info.

**Parameters:** none

---

### `list-queues`

List all queues with summary stats including message counts, consumer count, rates, and `consumer_utilisation`.

| Parameter | Type | Description |
|---|---|---|
| `sort_by` | `name \| messages \| consumers` | Sort field (numeric fields sort descending) |
| `filter_name` | string | Filter queues by name substring (case-insensitive) |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Items per page (default: 100, max: 500) |

---

### `get-queue-details`

Deep-dive on a single queue: message stats, rates, `consumer_utilisation`, memory, arguments, policy, and `backing_queue_status`.

| Parameter | Type | Description |
|---|---|---|
| `queue_name` | string | Exact queue name (required) |

Key diagnostic fields:
- `consumer_utilisation` — 0.0–1.0; below 1.0 means consumers cannot keep up with the inflow rate
- `messages_ready` vs `messages_unacknowledged` — split between messages waiting to be delivered vs held by consumers

---

### `list-queue-consumers`

List consumers attached to a queue with `prefetch_count`, `ack_required`, `active` status, and channel details.

| Parameter | Type | Description |
|---|---|---|
| `queue_name` | string | Exact queue name (required) |

A `prefetch_count` of 1 is a common cause of slow throughput — the consumer fetches one message, waits for acknowledgement, then fetches the next.

---

### `get-queue-messages`

Peek at messages in a queue without consuming them. Uses `ack_requeue_true` — messages are fetched then immediately requeued. Returns payload, properties, headers, and routing key.

| Parameter | Type | Description |
|---|---|---|
| `queue_name` | string | Exact queue name (required) |
| `count` | number | Messages to peek (default: 1, max: 10) |
| `encoding` | `auto \| base64` | Payload encoding (default: `auto`) |

---

### `list-connections`

List broker connections with `state`, channel count, send/recv rates, and flow control status.

| Parameter | Type | Description |
|---|---|---|
| `filter_name` | string | Filter by connection name substring |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Items per page (default: 100, max: 500) |

`flow: true` means the broker is applying backpressure to that connection.

---

### `get-connection-details`

Full details for a specific connection including `client_properties`, `channel_max`, `frame_max`, and timeout settings.

| Parameter | Type | Description |
|---|---|---|
| `connection_name` | string | Connection name from `list-connections` (required) |

---

### `list-channels`

List channels with `prefetch_count`, `messages_unacknowledged`, and `consumer_count`. High unacked count combined with low prefetch is a strong signal of a slow consumer.

| Parameter | Type | Description |
|---|---|---|
| `connection_name` | string | Filter by parent connection name |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Items per page (default: 100, max: 500) |

---

## Diagnosing Slow Consumption

The following metrics are the most useful for diagnosing why messages are consumed slowly:

| Metric | Tool | What it tells you |
|---|---|---|
| `consumer_utilisation` | `get-queue-details` | < 1.0 means the consumer cannot keep up with the publish rate |
| `prefetch_count` | `list-queue-consumers`, `list-channels` | Low value (e.g. 1) throttles throughput per consumer |
| `messages_unacknowledged` | `get-queue-details`, `list-channels` | High count = consumer holds messages without acking |
| `messages_ready` | `get-queue-details` | High count = broker has messages but consumers aren't fetching |
| `deliver_get.rate` vs `publish.rate` | `get-queue-details` | Compares consumption speed to ingestion speed |
| `ack.rate` | `get-queue-details` | How fast consumers acknowledge messages |
| `flow` | `list-connections` | `true` = broker is throttling this connection |

**Typical workflow:**

1. `get-overview` — check aggregate queue and rate totals
2. `list-queues` with `sort_by: messages` — find the worst queues
3. `get-queue-details` on the problematic queue — check `consumer_utilisation` and rates
4. `list-queue-consumers` — check `prefetch_count` and `active` status
5. `list-channels` filtered by the relevant connection — confirm unacked backlog

## Development

```bash
# Watch mode (recompiles on save)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Project Structure

```
src/
├── index.ts            # MCP server setup and tool registration
├── config.ts           # Environment variable parsing and validation
├── rabbitmq-client.ts  # HTTP client for the Management API
└── tools.ts            # Tool handler functions (pure logic, no MCP wiring)
tests/
├── rabbitmq-client.test.ts
└── tools.test.ts
```

All tool handlers follow the signature `(client, params) => Promise<result>` and are pure functions — MCP wiring is handled separately in `index.ts`.

## Error Handling

All errors are returned as MCP tool error responses — the server never crashes on a bad response from RabbitMQ. Error messages are actionable:

- **401** — "Authentication failed. Check RABBITMQ_USERNAME and RABBITMQ_PASSWORD."
- **403** — "Access denied. Check user permissions."
- **404** — "Not found. Use list tools to see available resources."
- **Connection refused / timeout** — Includes the URL attempted and a suggestion to verify `RABBITMQ_MANAGEMENT_URL`.

Credentials are never included in error output.

## Roadmap

V1 covers read-only diagnostics via the Management HTTP API. Planned for a future phase:

- AMQP connection (via `amqplib` or `rascal`) for message publishing and latency measurement
- Non-destructive message peek via AMQP `basic.get`
- Round-trip latency measurement tool
- Multiple vhost support per tool call
- Docker Compose integration tests against a real broker

## License

MIT
