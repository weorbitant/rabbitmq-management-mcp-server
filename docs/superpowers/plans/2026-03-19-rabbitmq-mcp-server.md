# RabbitMQ MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only MCP server that exposes RabbitMQ Management HTTP API diagnostics as tools for coding agents.

**Architecture:** Pure HTTP client against RabbitMQ Management API. MCP server with stdio transport. Environment-variable-based config. Functional TypeScript with Zod validation.

**Tech Stack:** TypeScript (strict), `@modelcontextprotocol/server`, `zod` (v4), Vitest, Node.js 18+ (built-in `fetch`)

**Spec:** `docs/superpowers/specs/2026-03-19-rabbitmq-mcp-server-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Entry point — creates MCP server, registers all tools, connects stdio transport |
| `src/config.ts` | Parses and validates env vars, exports typed config object |
| `src/rabbitmq-client.ts` | HTTP client wrapper — base URL, auth, timeout, error handling, typed request methods |
| `src/tools.ts` | All 8 tool definitions (name, description, inputSchema) and handlers |
| `tests/config.test.ts` | Config validation tests |
| `tests/rabbitmq-client.test.ts` | HTTP client tests with mocked fetch |
| `tests/tools.test.ts` | Tool handler tests with mocked client |
| `package.json` | Dependencies, scripts (build, test, start) |
| `tsconfig.json` | TypeScript strict config targeting ES2022 |
| `.env.example` | Documented env var template |
| `.gitignore` | node_modules, dist, .env |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/telekosmos/Projects/orbitant/rabbtimq-mcp-server
npm init -y
```

Then update `package.json` to:

```json
{
  "name": "rabbitmq-mcp-server",
  "version": "0.1.0",
  "description": "MCP server for RabbitMQ Management API diagnostics",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["mcp", "rabbitmq", "diagnostics"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.tsbuildinfo
```

- [ ] **Step 4: Create .env.example**

```bash
RABBITMQ_MANAGEMENT_URL=http://localhost:15672
RABBITMQ_USERNAME=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_VHOST=/
RABBITMQ_REQUEST_TIMEOUT_MS=10000
```

- [ ] **Step 5: Install dependencies**

```bash
npm install @modelcontextprotocol/server zod@^4.0.0
npm install -D typescript vitest @types/node
```

- [ ] **Step 6: Create src/ and tests/ directories**

```bash
mkdir -p src tests
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example package-lock.json
git commit -m "feat: scaffold project with dependencies and TypeScript config"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for config**

File: `tests/config.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv('RABBITMQ_MANAGEMENT_URL', 'http://localhost:15672');
    vi.stubEnv('RABBITMQ_USERNAME', 'guest');
    vi.stubEnv('RABBITMQ_PASSWORD', 'guest');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should load config from env vars with defaults', () => {
    const config = loadConfig();
    expect(config).toEqual({
      managementUrl: 'http://localhost:15672',
      username: 'guest',
      password: 'guest',
      vhost: '/',
      requestTimeoutMs: 10000,
    });
  });

  it('should use custom vhost and timeout when provided', () => {
    vi.stubEnv('RABBITMQ_VHOST', 'production');
    vi.stubEnv('RABBITMQ_REQUEST_TIMEOUT_MS', '5000');

    const config = loadConfig();
    expect(config.vhost).toBe('production');
    expect(config.requestTimeoutMs).toBe(5000);
  });

  it('should strip trailing slash from management URL', () => {
    vi.stubEnv('RABBITMQ_MANAGEMENT_URL', 'http://localhost:15672/');

    const config = loadConfig();
    expect(config.managementUrl).toBe('http://localhost:15672');
  });

  it('should throw if RABBITMQ_MANAGEMENT_URL is missing', () => {
    vi.stubEnv('RABBITMQ_MANAGEMENT_URL', '');

    expect(() => loadConfig()).toThrow('RABBITMQ_MANAGEMENT_URL');
  });

  it('should throw if RABBITMQ_USERNAME is missing', () => {
    vi.stubEnv('RABBITMQ_USERNAME', '');

    expect(() => loadConfig()).toThrow('RABBITMQ_USERNAME');
  });

  it('should throw if RABBITMQ_PASSWORD is missing', () => {
    vi.stubEnv('RABBITMQ_PASSWORD', '');

    expect(() => loadConfig()).toThrow('RABBITMQ_PASSWORD');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Implement config module**

File: `src/config.ts`

```typescript
export type Config = {
  managementUrl: string;
  username: string;
  password: string;
  vhost: string;
  requestTimeoutMs: number;
};

const requiredEnvVars = [
  'RABBITMQ_MANAGEMENT_URL',
  'RABBITMQ_USERNAME',
  'RABBITMQ_PASSWORD',
] as const;

export const loadConfig = (): Config => {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  const rawUrl = process.env.RABBITMQ_MANAGEMENT_URL!;
  const managementUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

  return {
    managementUrl,
    username: process.env.RABBITMQ_USERNAME!,
    password: process.env.RABBITMQ_PASSWORD!,
    vhost: process.env.RABBITMQ_VHOST || '/',
    requestTimeoutMs: Number(process.env.RABBITMQ_REQUEST_TIMEOUT_MS) || 10000,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with env var parsing and validation"
```

---

### Task 3: RabbitMQ HTTP Client

**Files:**
- Create: `src/rabbitmq-client.ts`
- Test: `tests/rabbitmq-client.test.ts`

- [ ] **Step 1: Write failing tests for the HTTP client**

File: `tests/rabbitmq-client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRabbitMQClient } from '../src/rabbitmq-client.js';
import type { Config } from '../src/config.js';

const mockConfig: Config = {
  managementUrl: 'http://localhost:15672',
  username: 'guest',
  password: 'guest',
  vhost: '/',
  requestTimeoutMs: 5000,
};

describe('createRabbitMQClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should make GET request with correct URL and auth header', async () => {
    const mockResponse = { name: 'test-queue' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    }));

    const client = createRabbitMQClient(mockConfig);
    const result = await client.get('/api/queues/%2F');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:15672/api/queues/%2F',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': `Basic ${btoa('guest:guest')}`,
          'Content-Type': 'application/json',
        }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('should make POST request with body', async () => {
    const body = { count: 5, ackmode: 'ack_requeue_true', encoding: 'auto' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    }));

    const client = createRabbitMQClient(mockConfig);
    await client.post('/api/queues/%2F/test/get', body);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:15672/api/queues/%2F/test/get',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  });

  it('should encode vhost in URL path', () => {
    const client = createRabbitMQClient(mockConfig);
    expect(client.encodedVhost).toBe('%2F');
  });

  it('should encode non-default vhost', () => {
    const client = createRabbitMQClient({ ...mockConfig, vhost: 'production' });
    expect(client.encodedVhost).toBe('production');
  });

  it('should throw on 401 with auth error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Not authorised'),
    }));

    const client = createRabbitMQClient(mockConfig);

    await expect(client.get('/api/overview')).rejects.toThrow(
      /authentication failed/i
    );
  });

  it('should throw on 404 with not found message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('Object Not Found'),
    }));

    const client = createRabbitMQClient(mockConfig);

    await expect(client.get('/api/queues/%2F/nonexistent')).rejects.toThrow(
      /not found/i
    );
  });

  it('should throw on network error with connection hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new TypeError('fetch failed')
    ));

    const client = createRabbitMQClient(mockConfig);

    await expect(client.get('/api/overview')).rejects.toThrow(
      /RABBITMQ_MANAGEMENT_URL/
    );
  });

  it('should use AbortSignal for timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }));

    const client = createRabbitMQClient(mockConfig);
    await client.get('/api/overview');

    const callArgs = vi.mocked(fetch).mock.calls[0][1];
    expect(callArgs?.signal).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/rabbitmq-client.test.ts
```

Expected: FAIL — `createRabbitMQClient` not found.

- [ ] **Step 3: Implement the HTTP client**

File: `src/rabbitmq-client.ts`

```typescript
import type { Config } from './config.js';

export type RabbitMQClientError = Error & {
  statusCode?: number;
  endpoint?: string;
};

export type RabbitMQClient = {
  get: <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body: unknown) => Promise<T>;
  encodedVhost: string;
};

const createError = (
  message: string,
  statusCode?: number,
  endpoint?: string
): RabbitMQClientError => {
  const error = new Error(message) as RabbitMQClientError;
  error.statusCode = statusCode;
  error.endpoint = endpoint;
  return error;
};

const mapHttpError = (status: number, endpoint: string, body: string): RabbitMQClientError => {
  const errorMap: Record<number, string> = {
    401: `Authentication failed. Check RABBITMQ_USERNAME and RABBITMQ_PASSWORD.`,
    403: `Access denied for endpoint ${endpoint}. Check user permissions.`,
    404: `Not found: ${endpoint}. Use list tools to see available resources.`,
  };

  const message = errorMap[status] ?? `HTTP ${status} from ${endpoint}: ${body.slice(0, 200)}`;
  return createError(message, status, endpoint);
};

export const createRabbitMQClient = (config: Config): RabbitMQClient => {
  const encodedVhost = config.vhost === '/' ? '%2F' : encodeURIComponent(config.vhost);
  const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const url = `${config.managementUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });

      if (!response.ok) {
        const text = await response.text();
        throw mapHttpError(response.status, path, text);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;
      }
      throw createError(
        `Connection failed to ${url}. Check RABBITMQ_MANAGEMENT_URL is correct and the server is reachable. (${error instanceof Error ? error.message : String(error)})`,
        undefined,
        path
      );
    }
  };

  return {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body: unknown) => request<T>('POST', path, body),
    encodedVhost,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/rabbitmq-client.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rabbitmq-client.ts tests/rabbitmq-client.test.ts
git commit -m "feat: add RabbitMQ Management API HTTP client with error handling"
```

---

### Task 4: Tool Handlers — Queue Tools

**Files:**
- Create: `src/tools.ts`
- Test: `tests/tools.test.ts`

This task implements the 4 queue-related tools: `list-queues`, `get-queue-details`, `list-queue-consumers`, `get-queue-messages`.

- [ ] **Step 1: Write failing tests for queue tools**

File: `tests/tools.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RabbitMQClient } from '../src/rabbitmq-client.js';
import {
  handleListQueues,
  handleGetQueueDetails,
  handleListQueueConsumers,
  handleGetQueueMessages,
} from '../src/tools.js';

const createMockClient = (overrides: Partial<RabbitMQClient> = {}): RabbitMQClient => ({
  get: vi.fn().mockResolvedValue({}),
  post: vi.fn().mockResolvedValue([]),
  encodedVhost: '%2F',
  ...overrides,
});

describe('list-queues handler', () => {
  it('should call correct API endpoint with pagination', async () => {
    const mockResponse = {
      page: 1,
      page_count: 1,
      page_size: 100,
      total_count: 2,
      filtered_count: 2,
      items: [
        { name: 'queue-a', messages: 100, consumers: 1, consumer_utilisation: 0.9 },
        { name: 'queue-b', messages: 500, consumers: 0, consumer_utilisation: null },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListQueues(client, {});

    expect(client.get).toHaveBeenCalledWith('/api/queues/%2F?page=1&page_size=100');
    expect(result.items).toHaveLength(2);
    expect(result.total_count).toBe(2);
  });

  it('should filter queues by name substring', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 2, filtered_count: 2,
      items: [
        { name: 'orders.processing', messages: 100 },
        { name: 'orders.dead-letter', messages: 50 },
        { name: 'events.tracking', messages: 200 },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListQueues(client, { filter_name: 'orders' });

    expect(result.items.every((q: { name: string }) => q.name.includes('orders'))).toBe(true);
  });

  it('should sort queues by messages descending', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 3, filtered_count: 3,
      items: [
        { name: 'a', messages: 100 },
        { name: 'b', messages: 500 },
        { name: 'c', messages: 200 },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListQueues(client, { sort_by: 'messages' });

    const messageCounts = result.items.map((q: { messages: number }) => q.messages);
    expect(messageCounts).toEqual([500, 200, 100]);
  });
});

describe('get-queue-details handler', () => {
  it('should call correct API endpoint with encoded queue name', async () => {
    const mockQueue = { name: 'my.queue', messages: 42 };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockQueue) });

    const result = await handleGetQueueDetails(client, { queue_name: 'my.queue' });

    expect(client.get).toHaveBeenCalledWith('/api/queues/%2F/my.queue');
    expect(result.name).toBe('my.queue');
  });

  it('should encode special characters in queue name', async () => {
    const client = createMockClient({ get: vi.fn().mockResolvedValue({}) });

    await handleGetQueueDetails(client, { queue_name: 'my queue/special' });

    expect(client.get).toHaveBeenCalledWith('/api/queues/%2F/my%20queue%2Fspecial');
  });
});

describe('list-queue-consumers handler', () => {
  it('should extract consumer_details from queue detail response', async () => {
    const mockQueue = {
      name: 'my.queue',
      consumer_details: [
        { consumer_tag: 'ctag-1', prefetch_count: 10, ack_required: true },
        { consumer_tag: 'ctag-2', prefetch_count: 1, ack_required: true },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockQueue) });

    const result = await handleListQueueConsumers(client, { queue_name: 'my.queue' });

    expect(result).toHaveLength(2);
    expect(result[0].consumer_tag).toBe('ctag-1');
  });

  it('should return empty array when no consumers', async () => {
    const mockQueue = { name: 'my.queue', consumer_details: [] };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockQueue) });

    const result = await handleListQueueConsumers(client, { queue_name: 'my.queue' });

    expect(result).toEqual([]);
  });
});

describe('get-queue-messages handler', () => {
  it('should POST with ack_requeue_true and default count', async () => {
    const mockMessages = [{ payload: '{"id":1}', payload_encoding: 'string' }];
    const client = createMockClient({ post: vi.fn().mockResolvedValue(mockMessages) });

    const result = await handleGetQueueMessages(client, { queue_name: 'my.queue' });

    expect(client.post).toHaveBeenCalledWith(
      '/api/queues/%2F/my.queue/get',
      { count: 1, ackmode: 'ack_requeue_true', encoding: 'auto' }
    );
    expect(result).toHaveLength(1);
  });

  it('should respect custom count capped at 10', async () => {
    const client = createMockClient({ post: vi.fn().mockResolvedValue([]) });

    await handleGetQueueMessages(client, { queue_name: 'my.queue', count: 50 });

    expect(client.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ count: 10 })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/tools.test.ts
```

Expected: FAIL — handler functions not found.

- [ ] **Step 3: Implement queue tool handlers**

File: `src/tools.ts` (initial — queue tools only)

```typescript
import type { RabbitMQClient } from './rabbitmq-client.js';

// --- Helpers ---

const encodeComponent = (name: string): string => encodeURIComponent(name);

const sortItems = <T>(items: T[], field: string): T[] => {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[field];
    const bVal = (b as Record<string, unknown>)[field];
    if (typeof aVal === 'string' && typeof bVal === 'string') return aVal.localeCompare(bVal);
    if (typeof aVal === 'number' && typeof bVal === 'number') return bVal - aVal;
    return 0;
  });
  return sorted;
};

// --- Queue Tools ---

type ListQueuesParams = {
  sort_by?: string;
  filter_name?: string;
  page?: number;
  page_size?: number;
};

type PaginatedResponse<T> = {
  items: T[];
  total_count: number;
  page: number;
  page_size: number;
  filtered_count: number;
};

export const handleListQueues = async (
  client: RabbitMQClient,
  params: ListQueuesParams
): Promise<PaginatedResponse<unknown>> => {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 100;

  const response = await client.get<PaginatedResponse<Record<string, unknown>>>(
    `/api/queues/${client.encodedVhost}?page=${page}&page_size=${pageSize}`
  );

  const filtered = params.filter_name
    ? response.items.filter((q) =>
        (q.name as string).toLowerCase().includes(params.filter_name!.toLowerCase())
      )
    : response.items;

  const sorted = params.sort_by ? sortItems(filtered, params.sort_by) : filtered;

  // total_count = server-side total (all queues in vhost)
  // filtered_count = after client-side name filter
  return {
    ...response,
    items: sorted,
    filtered_count: filtered.length,
  };
};

type QueueNameParam = { queue_name: string };

export const handleGetQueueDetails = async (
  client: RabbitMQClient,
  params: QueueNameParam
): Promise<unknown> => {
  return client.get(
    `/api/queues/${client.encodedVhost}/${encodeComponent(params.queue_name)}`
  );
};

export const handleListQueueConsumers = async (
  client: RabbitMQClient,
  params: QueueNameParam
): Promise<unknown[]> => {
  const queue = await client.get<{ consumer_details?: unknown[] }>(
    `/api/queues/${client.encodedVhost}/${encodeComponent(params.queue_name)}`
  );
  return queue.consumer_details ?? [];
};

type GetMessagesParams = {
  queue_name: string;
  count?: number;
  encoding?: string;
};

export const handleGetQueueMessages = async (
  client: RabbitMQClient,
  params: GetMessagesParams
): Promise<unknown[]> => {
  const count = Math.min(params.count ?? 1, 10);
  const encoding = params.encoding ?? 'auto';

  return client.post<unknown[]>(
    `/api/queues/${client.encodedVhost}/${encodeComponent(params.queue_name)}/get`,
    { count, ackmode: 'ack_requeue_true', encoding }
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/tools.test.ts
```

Expected: all queue tool tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: add queue tool handlers (list, details, consumers, messages)"
```

---

### Task 5: Tool Handlers — Connection, Channel, Overview Tools

**Files:**
- Modify: `src/tools.ts`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Write failing tests for remaining tools**

Append to `tests/tools.test.ts`:

```typescript
import {
  handleListConnections,
  handleGetConnectionDetails,
  handleListChannels,
  handleGetOverview,
} from '../src/tools.js';

describe('list-connections handler', () => {
  it('should call correct API endpoint', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 1, filtered_count: 1,
      items: [{ name: 'conn-1', state: 'running', flow: false }],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListConnections(client, {});

    expect(client.get).toHaveBeenCalledWith('/api/connections?page=1&page_size=100');
    expect(result.items).toHaveLength(1);
  });

  it('should filter connections by name', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 2, filtered_count: 2,
      items: [
        { name: '10.0.1.50:1234 -> broker:5672', state: 'running' },
        { name: '10.0.2.99:5678 -> broker:5672', state: 'running' },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListConnections(client, { filter_name: '10.0.1' });

    expect(result.items).toHaveLength(1);
  });
});

describe('get-connection-details handler', () => {
  it('should call correct API endpoint with encoded name', async () => {
    const client = createMockClient({ get: vi.fn().mockResolvedValue({ name: 'conn-1' }) });

    await handleGetConnectionDetails(client, { connection_name: 'conn-1' });

    expect(client.get).toHaveBeenCalledWith('/api/connections/conn-1');
  });
});

describe('list-channels handler', () => {
  it('should call correct API endpoint', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 1, filtered_count: 1,
      items: [{ name: 'chan-1', prefetch_count: 10, messages_unacknowledged: 5 }],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListChannels(client, {});

    expect(client.get).toHaveBeenCalledWith('/api/channels?page=1&page_size=100');
    expect(result.items).toHaveLength(1);
  });

  it('should filter channels by connection name', async () => {
    const mockResponse = {
      page: 1, page_count: 1, page_size: 100, total_count: 2, filtered_count: 2,
      items: [
        { name: 'conn-1 (1)', connection_details: { name: 'conn-1' } },
        { name: 'conn-2 (1)', connection_details: { name: 'conn-2' } },
      ],
    };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockResponse) });

    const result = await handleListChannels(client, { connection_name: 'conn-1' });

    expect(result.items).toHaveLength(1);
  });
});

describe('get-overview handler', () => {
  it('should call /api/overview endpoint', async () => {
    const mockOverview = { cluster_name: 'rabbit@node1', rabbitmq_version: '3.12.10' };
    const client = createMockClient({ get: vi.fn().mockResolvedValue(mockOverview) });

    const result = await handleGetOverview(client);

    expect(client.get).toHaveBeenCalledWith('/api/overview');
    expect(result).toEqual(mockOverview);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
npx vitest run tests/tools.test.ts
```

Expected: new tests FAIL, existing queue tests still PASS.

- [ ] **Step 3: Implement remaining tool handlers**

Append to `src/tools.ts`:

```typescript
// --- Connection Tools ---

type ListConnectionsParams = {
  filter_name?: string;
  page?: number;
  page_size?: number;
};

export const handleListConnections = async (
  client: RabbitMQClient,
  params: ListConnectionsParams
): Promise<PaginatedResponse<unknown>> => {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 100;

  const response = await client.get<PaginatedResponse<Record<string, unknown>>>(
    `/api/connections?page=${page}&page_size=${pageSize}`
  );

  const filtered = params.filter_name
    ? response.items.filter((c) =>
        (c.name as string).toLowerCase().includes(params.filter_name!.toLowerCase())
      )
    : response.items;

  return { ...response, items: filtered, filtered_count: filtered.length };
};

type ConnectionNameParam = { connection_name: string };

export const handleGetConnectionDetails = async (
  client: RabbitMQClient,
  params: ConnectionNameParam
): Promise<unknown> => {
  return client.get(`/api/connections/${encodeComponent(params.connection_name)}`);
};

// --- Channel Tools ---

type ListChannelsParams = {
  connection_name?: string;
  page?: number;
  page_size?: number;
};

export const handleListChannels = async (
  client: RabbitMQClient,
  params: ListChannelsParams
): Promise<PaginatedResponse<unknown>> => {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 100;

  const response = await client.get<PaginatedResponse<Record<string, unknown>>>(
    `/api/channels?page=${page}&page_size=${pageSize}`
  );

  const filtered = params.connection_name
    ? response.items.filter((ch) => {
        const connDetails = ch.connection_details as { name?: string } | undefined;
        return connDetails?.name === params.connection_name;
      })
    : response.items;

  return { ...response, items: filtered, filtered_count: filtered.length };
};

// --- Overview Tool ---

export const handleGetOverview = async (
  client: RabbitMQClient
): Promise<unknown> => {
  return client.get('/api/overview');
};
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
npx vitest run tests/tools.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: add connection, channel, and overview tool handlers"
```

---

### Task 6: MCP Server Wiring — Tool Registration and Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement the MCP server entry point**

File: `src/index.ts`

```typescript
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { createRabbitMQClient } from './rabbitmq-client.js';
import {
  handleListQueues,
  handleGetQueueDetails,
  handleListQueueConsumers,
  handleGetQueueMessages,
  handleListConnections,
  handleGetConnectionDetails,
  handleListChannels,
  handleGetOverview,
} from './tools.js';

const toTextResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const toErrorResult = (error: unknown) => ({
  content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
  isError: true,
});

const main = async (): Promise<void> => {
  const config = loadConfig();
  const client = createRabbitMQClient(config);

  console.error(`[rabbitmq-mcp] Starting server — management URL: ${config.managementUrl}, vhost: ${config.vhost}`);

  const server = new McpServer({
    name: 'rabbitmq-mcp-server',
    version: '0.1.0',
  });

  // --- Queue Tools ---

  server.registerTool('list-queues', {
    title: 'List Queues',
    description: 'List all RabbitMQ queues with summary stats (messages, consumers, rates, consumer_utilisation). Supports filtering by name and sorting.',
    inputSchema: z.object({
      sort_by: z.enum(['name', 'messages', 'consumers']).optional().describe('Sort field (default: name). Numeric fields sort descending.'),
      filter_name: z.string().optional().describe('Filter queues by name substring (case-insensitive)'),
      page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
      page_size: z.number().int().min(1).max(500).optional().describe('Items per page (default: 100, max: 500)'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleListQueues(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  server.registerTool('get-queue-details', {
    title: 'Get Queue Details',
    description: 'Get detailed info for a single queue: message stats, rates, consumer_utilisation, memory, arguments, policy, backing_queue_status. Key diagnostic fields: consumer_utilisation (0-1, lower means consumer is slow), messages_ready vs messages_unacknowledged.',
    inputSchema: z.object({
      queue_name: z.string().describe('Exact queue name'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleGetQueueDetails(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  server.registerTool('list-queue-consumers', {
    title: 'List Queue Consumers',
    description: 'List consumers attached to a queue with prefetch_count, ack_required, active status, and channel details. Low prefetch_count (e.g. 1) is a common cause of slow consumption.',
    inputSchema: z.object({
      queue_name: z.string().describe('Exact queue name'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleListQueueConsumers(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  server.registerTool('get-queue-messages', {
    title: 'Peek Queue Messages',
    description: 'Peek at messages in a queue without consuming them (uses ack_requeue_true). Returns payload, properties, headers, routing_key. Useful for inspecting stuck or problematic messages.',
    inputSchema: z.object({
      queue_name: z.string().describe('Exact queue name'),
      count: z.number().int().min(1).max(10).optional().describe('Number of messages to peek (default: 1, max: 10)'),
      encoding: z.enum(['auto', 'base64']).optional().describe('Payload encoding (default: auto)'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleGetQueueMessages(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // --- Connection Tools ---

  server.registerTool('list-connections', {
    title: 'List Connections',
    description: 'List broker connections with state, channels, send/recv rates, and flow control status. flow=true means the broker is applying backpressure to this connection.',
    inputSchema: z.object({
      filter_name: z.string().optional().describe('Filter connections by name substring'),
      page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
      page_size: z.number().int().min(1).max(500).optional().describe('Items per page (default: 100, max: 500)'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleListConnections(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  server.registerTool('get-connection-details', {
    title: 'Get Connection Details',
    description: 'Get full details for a specific connection including client_properties, channel_max, frame_max, timeout settings.',
    inputSchema: z.object({
      connection_name: z.string().describe('Connection name (from list-connections)'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleGetConnectionDetails(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // --- Channel Tools ---

  server.registerTool('list-channels', {
    title: 'List Channels',
    description: 'List channels with prefetch_count, messages_unacknowledged, consumer_count. High unacked messages with low prefetch suggests the consumer is processing slowly.',
    inputSchema: z.object({
      connection_name: z.string().optional().describe('Filter channels by parent connection name'),
      page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
      page_size: z.number().int().min(1).max(500).optional().describe('Items per page (default: 100, max: 500)'),
    }),
  }, async (args) => {
    try {
      return toTextResult(await handleListChannels(client, args));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // --- Overview Tool ---

  server.registerTool('get-overview', {
    title: 'Get Broker Overview',
    description: 'Get broker-level overview: cluster name, RabbitMQ version, message totals with rates, object counts (queues, connections, channels, consumers, exchanges), node health, listeners.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      return toTextResult(await handleGetOverview(client));
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // --- Start Server ---

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[rabbitmq-mcp] Server connected via stdio');
};

main().catch((error) => {
  console.error('[rabbitmq-mcp] Fatal error:', error);
  process.exit(1);
});
```

**Note:** The import paths use `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js` — verify these resolve correctly after install. If the SDK uses `@modelcontextprotocol/server` as a separate package, adjust accordingly. Check node_modules after Step 5 of Task 1.

- [ ] **Step 2: Build the project**

```bash
npm run build
```

Expected: compiles without errors. `dist/index.js` is produced.

- [ ] **Step 3: Smoke test — verify server starts and responds**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | RABBITMQ_MANAGEMENT_URL=http://localhost:15672 RABBITMQ_USERNAME=guest RABBITMQ_PASSWORD=guest node dist/index.js 2>/dev/null | head -1
```

Expected: JSON response containing `"serverInfo":{"name":"rabbitmq-mcp-server"...}`.

If the server hangs (waiting for stdin), that's OK — it means stdio transport is working. Kill with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire MCP server entry point with all tool registrations"
```

---

### Task 7: Build Verification and Full Test Run

**Files:** None new — verification only.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests in `tests/config.test.ts`, `tests/rabbitmq-client.test.ts`, `tests/tools.test.ts` PASS.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: clean compile, no errors or warnings.

- [ ] **Step 3: Verify dist output**

```bash
ls dist/
```

Expected: `index.js`, `config.js`, `rabbitmq-client.js`, `tools.js` (plus `.d.ts` and `.js.map` files).

- [ ] **Step 4: Fix any issues found and commit**

If all green, no commit needed. If fixes were required, commit them.

---

### Task 8: Documentation and Final Polish

**Files:**
- Create: `CLAUDE.md` (project-level agent instructions)

- [ ] **Step 1: Create CLAUDE.md for the project**

File: `CLAUDE.md`

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with project conventions and quick reference"
```
