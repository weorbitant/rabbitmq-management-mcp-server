# RabbitMQ MCP Server

## Quick Reference

- **Build:** `npm run build`
- **Test:** `npm test`
- **Dev:** `npm run dev` (watch mode)
- **Run:** `RABBITMQ_MANAGEMENT_URL=http://localhost:15672 RABBITMQ_USERNAME=guest RABBITMQ_PASSWORD=guest node dist/index.js`

## Architecture

MCP server exposing RabbitMQ Management HTTP API as diagnostic tools via stdio transport.

- `src/config.ts` — env var parsing
- `src/rabbitmq-client.ts` — HTTP client for Management API
- `src/tools.ts` — tool handler functions (pure logic, no MCP wiring)
- `src/index.ts` — MCP server setup, tool registration, entry point

## Conventions

- Functional style, no classes
- All tool handlers are pure functions: `(client, params) => Promise<result>`
- Tests mock the RabbitMQ client, not fetch directly (except in client tests)
- Errors returned as MCP error responses, never thrown to crash the server
