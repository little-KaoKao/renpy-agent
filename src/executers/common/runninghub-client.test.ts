import { describe, expect, it, vi } from 'vitest';
import {
  HttpRunningHubClient,
  RunningHubError,
  type AiAppSchema,
  type FetchLike,
} from './runninghub-client.js';

const FAKE_KEY = 'fake-key';

const BASIC_SCHEMAS: Record<string, AiAppSchema> = {
  'api-425766740': {
    webappId: '425766740',
    promptNodeId: '6',
    promptFieldName: 'text',
  },
  'api-437377723': {
    webappId: '437377723',
    promptNodeId: '6',
    promptFieldName: 'text',
    referenceImageNodeId: '10',
    referenceImageFieldName: 'image',
  },
};

function makeFetch(
  handlers: Record<string, (body: any) => { status?: number; json?: unknown; text?: string }>,
): { fetchFn: FetchLike; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected path: ${path}`);
    const result = handler(body);
    const text = result.text ?? JSON.stringify(result.json ?? {});
    return new Response(text, {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchFn: fetchFn as unknown as FetchLike, calls };
}

describe('HttpRunningHubClient.submitTask', () => {
  it('translates apiId to webappId and posts prompt nodeInfoList', async () => {
    const { fetchFn, calls } = makeFetch({
      '/task/openapi/ai-app/run': () => ({
        json: { code: 0, data: { taskId: 'task-xyz' } },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });

    const result = await client.submitTask({
      apiId: 'api-425766740',
      prompt: 'a cat on the moon',
    });

    expect(result.taskId).toBe('task-xyz');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      apiKey: FAKE_KEY,
      webappId: '425766740',
      nodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: 'a cat on the moon' }],
    });
  });

  it('appends reference image node when schema supports it', async () => {
    const { fetchFn, calls } = makeFetch({
      '/task/openapi/ai-app/run': () => ({
        json: { code: 0, data: { taskId: 't1' } },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });

    await client.submitTask({
      apiId: 'api-437377723',
      prompt: 'kiss scene',
      referenceImageUri: 'https://example.com/ref.png',
    });

    expect(calls[0]!.body.nodeInfoList).toEqual([
      { nodeId: '6', fieldName: 'text', fieldValue: 'kiss scene' },
      { nodeId: '10', fieldName: 'image', fieldValue: 'https://example.com/ref.png' },
    ]);
  });

  it('throws when apiId is not registered in appSchemas', async () => {
    const { fetchFn } = makeFetch({});
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({ apiId: 'api-unknown', prompt: 'x' }),
    ).rejects.toThrow(/no AiAppSchema/);
  });

  it('throws RunningHubError on non-zero code', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/ai-app/run': () => ({
        json: { code: 1, msg: 'webapp not exists' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({ apiId: 'api-425766740', prompt: 'x' }),
    ).rejects.toBeInstanceOf(RunningHubError);
  });

  it('throws when reference image given but schema does not declare it', async () => {
    const { fetchFn } = makeFetch({});
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({
        apiId: 'api-425766740',
        prompt: 'x',
        referenceImageUri: 'https://x.png',
      }),
    ).rejects.toThrow(/does not support referenceImageUri/);
  });
});

describe('HttpRunningHubClient.pollTask', () => {
  it('returns pending for QUEUED string status', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'QUEUED' } }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res).toEqual({ status: 'pending' });
  });

  it('returns running for RUNNING', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'RUNNING' } }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    expect((await client.pollTask('t1')).status).toBe('running');
  });

  it('returns done with first fileUrl on SUCCESS', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({
        json: {
          code: 0,
          data: [
            { fileUrl: 'https://cdn.rh.example/out1.png' },
            { fileUrl: 'https://cdn.rh.example/out2.png' },
          ],
        },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('done');
    expect(res.outputUri).toBe('https://cdn.rh.example/out1.png');
  });

  it('returns error with reason on FAILED', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({
        json: { code: 0, data: { status: 'FAILED', reason: 'prompt blocked' } },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('error');
    expect(res.errorMessage).toBe('prompt blocked');
  });

  it('returns error when SUCCESS but outputs envelope has no fileUrl', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({ json: { code: 0, data: [] } }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('error');
    expect(res.errorMessage).toMatch(/no fileUrl/);
  });

  it('accepts outputs with url field as fallback', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({
        json: { code: 0, data: [{ url: 'https://cdn.rh.example/fallback.png' }] },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    expect((await client.pollTask('t1')).outputUri).toBe('https://cdn.rh.example/fallback.png');
  });

  it('bubbles up HTTP errors as RunningHubError', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ status: 500, text: 'server down' }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: BASIC_SCHEMAS,
      fetchFn,
    });
    await expect(client.pollTask('t1')).rejects.toBeInstanceOf(RunningHubError);
  });
});

describe('HttpRunningHubClient constructor', () => {
  it('throws when apiKey is empty', () => {
    expect(
      () =>
        new HttpRunningHubClient({
          apiKey: '',
          appSchemas: {},
          fetchFn: (async () => new Response('{}')) as FetchLike,
        }),
    ).toThrow(/apiKey is required/);
  });
});
