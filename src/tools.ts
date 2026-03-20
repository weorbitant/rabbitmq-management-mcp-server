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
  const pageSize = Math.min(params.page_size ?? 100, 500);

  const response = await client.get<PaginatedResponse<Record<string, unknown>>>(
    `/api/queues/${client.encodedVhost}?page=${page}&page_size=${pageSize}`
  );

  const filtered = params.filter_name
    ? response.items.filter((q) =>
        (q.name as string).toLowerCase().includes(params.filter_name!.toLowerCase())
      )
    : response.items;

  const sorted = params.sort_by ? sortItems(filtered, params.sort_by) : filtered;

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
  return Array.isArray(queue.consumer_details) ? queue.consumer_details : [];
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
  const pageSize = Math.min(params.page_size ?? 100, 500);

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
  const pageSize = Math.min(params.page_size ?? 100, 500);

  const response = await client.get<PaginatedResponse<Record<string, unknown>>>(
    `/api/channels?page=${page}&page_size=${pageSize}`
  );

  const filtered = params.connection_name
    ? response.items.filter((ch) => {
        const connDetails = ch.connection_details as { name?: string } | undefined;
        return connDetails?.name?.toLowerCase().includes(params.connection_name!.toLowerCase());
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
