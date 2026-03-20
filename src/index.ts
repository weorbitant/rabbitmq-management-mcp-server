import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
