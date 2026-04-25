import { describe, expect, it, vi } from 'vitest';
import {
  HttpRunningHubClient,
  RunningHubError,
  type AiAppSchema,
  type FetchLike,
} from './runninghub-client.js';
import { RUNNINGHUB_APP_SCHEMAS } from './runninghub-schemas.js';

const FAKE_KEY = 'fake-key';

const TEST_SCHEMAS: Record<string, AiAppSchema> = {
  // 最小 schema:只有 prompt。
  TEXT_TO_IMAGE: {
    webappId: '1234567890123456789',
    displayName: 'test text-to-image',
    fields: [{ nodeId: '6', fieldName: 'text', role: 'prompt' }],
  },
  // 带首帧图参考 + 默认 option。
  IMAGE_TO_VIDEO: {
    webappId: '2234567890123456789',
    displayName: 'test image-to-video',
    fields: [
      { nodeId: '2', fieldName: 'image', role: 'first_frame' },
      { nodeId: '3', fieldName: 'image', role: 'last_frame', optional: true },
      { nodeId: '1', fieldName: 'real_person_mode', role: 'option', defaultValue: 'false' },
      { nodeId: '1', fieldName: 'prompt', role: 'prompt' },
    ],
  },
  // 带下拉 fieldData。
  WITH_FIELDDATA: {
    webappId: '3234567890123456789',
    displayName: 'test with fieldData enum',
    fields: [
      {
        nodeId: '4',
        fieldName: 'model_selected',
        role: 'model_select',
        defaultValue: 'Midjourney V7',
        fieldData: '["Midjourney V7","Midjourney V6"]',
      },
      { nodeId: '6', fieldName: 'text', role: 'prompt' },
    ],
  },
};

function makeFetch(
  handlers: Record<string, (body: any, headers: Headers) => { status?: number; json?: unknown; text?: string }>,
): {
  fetchFn: FetchLike;
  calls: Array<{ url: string; body: any; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const rawHeaders = new Headers(init?.headers);
    const headerObj: Record<string, string> = {};
    rawHeaders.forEach((v, k) => {
      headerObj[k.toLowerCase()] = v;
    });
    calls.push({ url, body, headers: headerObj });
    const path = new URL(url).pathname;
    const handler = Object.entries(handlers).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`unexpected path: ${path}`);
    const result = handler(body, rawHeaders);
    const text = result.text ?? JSON.stringify(result.json ?? {});
    return new Response(text, {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchFn: fetchFn as unknown as FetchLike, calls };
}

describe('HttpRunningHubClient.submitTask', () => {
  it('posts to /openapi/v2/run/ai-app/{webappId} with Bearer auth and body without apiKey', async () => {
    const { fetchFn, calls } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: 'task-xyz', status: 'RUNNING', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    const result = await client.submitTask({
      appKey: 'TEXT_TO_IMAGE',
      inputs: [{ role: 'prompt', value: 'a cat on the moon' }],
    });

    expect(result.taskId).toBe('task-xyz');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/openapi/v2/run/ai-app/1234567890123456789');
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(calls[0]!.body).toEqual({
      nodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: 'a cat on the moon' }],
      instanceType: 'default',
      usePersonalQueue: 'false',
    });
    expect(calls[0]!.body.apiKey).toBeUndefined();
  });

  it('fills in schema defaults for fields the caller does not provide', async () => {
    const { fetchFn, calls } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: 't1', status: 'RUNNING', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await client.submitTask({
      appKey: 'IMAGE_TO_VIDEO',
      inputs: [
        { role: 'first_frame', value: 'https://cdn/first.jpg' },
        { role: 'prompt', value: 'dolly in' },
      ],
    });

    // last_frame is optional + not provided → skipped.
    // real_person_mode has defaultValue 'false' → included.
    expect(calls[0]!.body.nodeInfoList).toEqual([
      { nodeId: '2', fieldName: 'image', fieldValue: 'https://cdn/first.jpg' },
      { nodeId: '1', fieldName: 'real_person_mode', fieldValue: 'false' },
      { nodeId: '1', fieldName: 'prompt', fieldValue: 'dolly in' },
    ]);
  });

  it('wires real RUNNINGHUB_APP_SCHEMAS fieldData through to nodeInfoList (Midjourney v7 end-to-end)', async () => {
    // 用真 schema 做一次端到端:caller 只提供 prompt,Midjourney v7 的
    // model_selected / aspect_rate 两个下拉字段应当带回官方枚举 fieldData。
    const { fetchFn, calls } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: 'mj-1', status: 'RUNNING', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: RUNNINGHUB_APP_SCHEMAS as unknown as Record<string, AiAppSchema>,
      fetchFn,
    });

    await client.submitTask({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: [{ role: 'prompt', value: 'a cat on the moon' }],
    });

    const body = calls[0]!.body;
    const modelField = body.nodeInfoList.find(
      (n: any) => n.nodeId === '4' && n.fieldName === 'model_selected',
    );
    const aspectField = body.nodeInfoList.find(
      (n: any) => n.nodeId === '4' && n.fieldName === 'aspect_rate',
    );
    expect(modelField.fieldData).toMatch(/Midjourney V7/);
    expect(modelField.fieldValue).toBe('Midjourney V7');
    expect(aspectField.fieldData).toMatch(/9:16/);
    expect(aspectField.fieldValue).toBe('3:4');
  });

  it('emits fieldData when the schema declares an enum whitelist', async () => {
    const { fetchFn, calls } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: 't2', status: 'RUNNING', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await client.submitTask({
      appKey: 'WITH_FIELDDATA',
      inputs: [{ role: 'prompt', value: 'test' }],
    });

    const nodeInfoList = calls[0]!.body.nodeInfoList;
    expect(nodeInfoList[0]).toEqual({
      nodeId: '4',
      fieldName: 'model_selected',
      fieldValue: 'Midjourney V7',
      fieldData: '["Midjourney V7","Midjourney V6"]',
    });
  });

  it('passes through instanceType and usePersonalQueue', async () => {
    const { fetchFn, calls } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: 't3', status: 'RUNNING', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await client.submitTask({
      appKey: 'TEXT_TO_IMAGE',
      inputs: [{ role: 'prompt', value: 'x' }],
      instanceType: 'plus',
      usePersonalQueue: true,
    });

    expect(calls[0]!.body.instanceType).toBe('plus');
    expect(calls[0]!.body.usePersonalQueue).toBe('true');
  });

  it('throws when appKey is not registered', async () => {
    const { fetchFn } = makeFetch({});
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({ appKey: 'UNKNOWN_KEY', inputs: [{ role: 'prompt', value: 'x' }] }),
    ).rejects.toThrow(/no AiAppSchema/);
  });

  it('throws when a required schema field is missing from inputs', async () => {
    const { fetchFn } = makeFetch({});
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({
        appKey: 'IMAGE_TO_VIDEO',
        inputs: [{ role: 'prompt', value: 'missing first frame' }],
      }),
    ).rejects.toThrow(/missing required input for role="first_frame"/);
  });

  it('throws when an input has no matching schema field', async () => {
    const { fetchFn } = makeFetch({});
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({
        appKey: 'TEXT_TO_IMAGE',
        inputs: [
          { role: 'prompt', value: 'ok' },
          { role: 'reference_image_1', value: 'https://x.png' },
        ],
      }),
    ).rejects.toThrow(/no schema field for role="reference_image_1"/);
  });

  it('throws RunningHubError when v2 response has a non-empty errorCode', async () => {
    const { fetchFn } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: {
          taskId: '',
          status: '',
          errorCode: 'WEBAPP_NOT_EXISTS',
          errorMessage: 'webapp not exists',
        },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({ appKey: 'TEXT_TO_IMAGE', inputs: [{ role: 'prompt', value: 'x' }] }),
    ).rejects.toThrow(/webapp not exists/);
  });

  it('throws RunningHubError when v2 response has no taskId even if errorCode is empty', async () => {
    const { fetchFn } = makeFetch({
      '/openapi/v2/run/ai-app/': () => ({
        json: { taskId: '', status: '', errorCode: '', errorMessage: '' },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });

    await expect(
      client.submitTask({ appKey: 'TEXT_TO_IMAGE', inputs: [{ role: 'prompt', value: 'x' }] }),
    ).rejects.toBeInstanceOf(RunningHubError);
  });
});

describe('HttpRunningHubClient.pollTask', () => {
  it('returns pending for QUEUED string status', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'QUEUED' } }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
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
      appSchemas: TEST_SCHEMAS,
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
      appSchemas: TEST_SCHEMAS,
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
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('error');
    expect(res.errorMessage).toBe('prompt blocked');
  });

  it('surfaces structured failedReason (node_name + exception_message) on outputs code=805', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({
        json: {
          code: 805,
          msg: 'failed',
          data: {
            failedReason: {
              node_name: 'KSampler',
              exception_message: 'CUDA out of memory',
              traceback: 'Traceback (most recent call last): ...',
            },
          },
        },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('error');
    expect(res.errorMessage).toContain('KSampler');
    expect(res.errorMessage).toContain('CUDA out of memory');
  });

  it('returns error when SUCCESS but outputs envelope has no fileUrl', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({ json: { code: 0, data: [] } }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
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
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });
    expect((await client.pollTask('t1')).outputUri).toBe('https://cdn.rh.example/fallback.png');
  });

  it('skips metadata txt output and picks the first real audio file (SunoV5 shape)', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ json: { code: 0, data: 'SUCCESS' } }),
      '/task/openapi/outputs': () => ({
        json: {
          code: 0,
          data: [
            { fileUrl: 'https://cdn.rh.example/prompt.txt', fileType: 'txt' },
            { fileUrl: 'https://cdn.rh.example/track1.flac', fileType: 'flac' },
            { fileUrl: 'https://cdn.rh.example/track2.flac', fileType: 'flac' },
          ],
        },
      }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
      fetchFn,
    });
    const res = await client.pollTask('t1');
    expect(res.status).toBe('done');
    expect(res.outputUri).toBe('https://cdn.rh.example/track1.flac');
  });

  it('bubbles up HTTP errors as RunningHubError', async () => {
    const { fetchFn } = makeFetch({
      '/task/openapi/status': () => ({ status: 500, text: 'server down' }),
    });
    const client = new HttpRunningHubClient({
      apiKey: FAKE_KEY,
      appSchemas: TEST_SCHEMAS,
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
