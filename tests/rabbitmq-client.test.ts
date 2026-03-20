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
