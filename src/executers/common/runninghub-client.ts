// RunningHub OpenAPI 客户端。
//
// 端点:
//   POST /task/openapi/ai-app/run   —— 提交一次 AI-App 任务
//   POST /task/openapi/status       —— 查询任务状态
//   POST /task/openapi/outputs      —— 拉取任务产物(成功后)
//
// 认证:所有请求体都带 `apiKey`(从 `.env` 里的 `RUNNINGHUB_API_KEY` 注入)。
//
// 身份映射:上层调用者传 `apiId`(形如 "api-425766740"),客户端根据构造时注入的
// `appSchemas` 把它翻译成 `webappId` + 该 AI-App 的 prompt / 参考图 node 配置。
// 不同 AI-App 的节点 ID / fieldName 不一样,必须登录 RunningHub 控制台的"API 调用"
// 面板查到之后再在 `appSchemas` 里登记。

export type RunningHubTaskStatus = 'pending' | 'running' | 'done' | 'error';

/** 每个 AI-App 的节点布局。登录 RunningHub 控制台 → 打开该 AI-App → "API 调用"面板可以看到。 */
export interface AiAppSchema {
  readonly webappId: string;
  readonly promptNodeId: string;
  readonly promptFieldName: string;
  readonly referenceImageNodeId?: string;
  readonly referenceImageFieldName?: string;
}

export interface RunningHubSubmitParams {
  readonly apiId: string;
  readonly prompt: string;
  readonly referenceImageUri?: string;
}

export interface RunningHubTaskResult {
  readonly status: RunningHubTaskStatus;
  readonly outputUri?: string;
  readonly errorMessage?: string;
}

export interface RunningHubClient {
  submitTask(params: RunningHubSubmitParams): Promise<{ readonly taskId: string }>;
  pollTask(taskId: string): Promise<RunningHubTaskResult>;
}

export const RUNNINGHUB_DEFAULT_BASE_URL = 'https://www.runninghub.cn';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpRunningHubClientOptions {
  readonly apiKey: string;
  readonly appSchemas: Readonly<Record<string, AiAppSchema>>;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchLike;
}

export class RunningHubError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'RunningHubError';
  }
}

interface RhEnvelope<T> {
  readonly code?: number;
  readonly msg?: string;
  readonly data?: T;
}

interface RhSubmitData {
  readonly taskId?: string;
}

interface RhStatusData {
  readonly status?: string;
  readonly taskStatus?: string;
  readonly reason?: string;
  readonly failReason?: string;
}

interface RhOutputItem {
  readonly fileUrl?: string;
  readonly url?: string;
}

export class HttpRunningHubClient implements RunningHubClient {
  private readonly apiKey: string;
  private readonly appSchemas: Readonly<Record<string, AiAppSchema>>;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: HttpRunningHubClientOptions) {
    if (!options.apiKey) {
      throw new Error('RunningHubClient: apiKey is required');
    }
    this.apiKey = options.apiKey;
    this.appSchemas = options.appSchemas;
    this.baseUrl = (options.baseUrl ?? RUNNINGHUB_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as FetchLike);
    if (!this.fetchFn) {
      throw new Error('RunningHubClient: no fetch implementation available (Node 18+ required)');
    }
  }

  async submitTask(
    params: RunningHubSubmitParams,
  ): Promise<{ readonly taskId: string }> {
    const schema = this.appSchemas[params.apiId];
    if (!schema) {
      throw new Error(
        `RunningHubClient: no AiAppSchema registered for apiId="${params.apiId}". ` +
          `Add it to the client constructor's appSchemas map (check the RunningHub console's "API 调用" panel for webappId and node IDs).`,
      );
    }

    const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [
      {
        nodeId: schema.promptNodeId,
        fieldName: schema.promptFieldName,
        fieldValue: params.prompt,
      },
    ];
    if (params.referenceImageUri) {
      if (!schema.referenceImageNodeId || !schema.referenceImageFieldName) {
        throw new Error(
          `RunningHubClient: apiId="${params.apiId}" does not support referenceImageUri (no referenceImageNodeId/fieldName in schema).`,
        );
      }
      nodeInfoList.push({
        nodeId: schema.referenceImageNodeId,
        fieldName: schema.referenceImageFieldName,
        fieldValue: params.referenceImageUri,
      });
    }

    const envelope = await this.postJson<RhEnvelope<RhSubmitData>>(
      '/task/openapi/ai-app/run',
      { apiKey: this.apiKey, webappId: schema.webappId, nodeInfoList },
    );
    if (envelope.code !== 0 || !envelope.data?.taskId) {
      throw new RunningHubError(
        `submit failed: ${envelope.msg ?? 'unknown error'}`,
        envelope.code,
        envelope,
      );
    }
    return { taskId: envelope.data.taskId };
  }

  async pollTask(taskId: string): Promise<RunningHubTaskResult> {
    const statusEnv = await this.postJson<RhEnvelope<RhStatusData | string>>(
      '/task/openapi/status',
      { apiKey: this.apiKey, taskId },
    );
    if (statusEnv.code !== 0) {
      return {
        status: 'error',
        errorMessage: `status query failed: ${statusEnv.msg ?? 'unknown error'} (code=${statusEnv.code})`,
      };
    }
    const rawStatus = extractRawStatus(statusEnv.data);
    const mapped = mapStatus(rawStatus);

    if (mapped === 'error') {
      const reason =
        typeof statusEnv.data === 'object' && statusEnv.data !== null
          ? (statusEnv.data.reason ?? statusEnv.data.failReason)
          : undefined;
      return { status: 'error', errorMessage: reason ?? `task reported ${rawStatus}` };
    }

    if (mapped !== 'done') {
      return { status: mapped };
    }

    const outputsEnv = await this.postJson<RhEnvelope<ReadonlyArray<RhOutputItem>>>(
      '/task/openapi/outputs',
      { apiKey: this.apiKey, taskId },
    );
    if (outputsEnv.code !== 0) {
      return {
        status: 'error',
        errorMessage: `outputs query failed: ${outputsEnv.msg ?? 'unknown error'} (code=${outputsEnv.code})`,
      };
    }
    const first = outputsEnv.data?.[0];
    const outputUri = first?.fileUrl ?? first?.url;
    if (!outputUri) {
      return {
        status: 'error',
        errorMessage: 'task succeeded but outputs envelope had no fileUrl',
      };
    }
    return { status: 'done', outputUri };
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new RunningHubError(
        `HTTP ${res.status} from ${path}: ${text.slice(0, 200)}`,
        res.status,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RunningHubError(
        `non-JSON response from ${path}: ${text.slice(0, 200)}`,
      );
    }
  }
}

function extractRawStatus(data: RhStatusData | string | undefined): string {
  if (typeof data === 'string') return data;
  if (!data) return '';
  return data.status ?? data.taskStatus ?? '';
}

function mapStatus(raw: string): RunningHubTaskStatus {
  const s = raw.toUpperCase();
  if (s === 'SUCCESS' || s === 'DONE' || s === 'FINISHED' || s === 'COMPLETED') return 'done';
  if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED' || s === 'CANCELLED') return 'error';
  if (s === 'RUNNING' || s === 'PROCESSING') return 'running';
  return 'pending';
}
