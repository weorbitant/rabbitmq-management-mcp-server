import { describe, it, expect, vi } from 'vitest';
import type { RabbitMQClient } from '../src/rabbitmq-client.js';
import {
  handleListQueues,
  handleGetQueueDetails,
  handleListQueueConsumers,
  handleGetQueueMessages,
  handleListConnections,
  handleGetConnectionDetails,
  handleListChannels,
  handleGetOverview,
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
