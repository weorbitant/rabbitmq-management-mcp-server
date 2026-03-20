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

const stripTrailingSlash = (url: string): string =>
  url.endsWith('/') ? url.slice(0, -1) : url;

export const loadConfig = (): Config => {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return {
    managementUrl: stripTrailingSlash(process.env.RABBITMQ_MANAGEMENT_URL!),
    username: process.env.RABBITMQ_USERNAME!,
    password: process.env.RABBITMQ_PASSWORD!,
    vhost: process.env.RABBITMQ_VHOST ?? '/',
    requestTimeoutMs: Number(process.env.RABBITMQ_REQUEST_TIMEOUT_MS) || 10000,
  };
};
