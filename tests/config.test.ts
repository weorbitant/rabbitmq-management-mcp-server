import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
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

  it('should list all missing vars when multiple are missing', () => {
    vi.stubEnv('RABBITMQ_MANAGEMENT_URL', '');
    vi.stubEnv('RABBITMQ_USERNAME', '');

    expect(() => loadConfig()).toThrow('RABBITMQ_MANAGEMENT_URL, RABBITMQ_USERNAME');
  });
});
