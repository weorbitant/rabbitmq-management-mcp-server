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
