// RunningHub OpenAPI 客户端(v0.5+:真 webappId + /openapi/v2 协议)。
//
// 端点:
//   POST /openapi/v2/run/ai-app/{webappId}  —— 提交一次 AI-App 任务
//   POST /task/openapi/status               —— 查询任务状态
//   POST /task/openapi/outputs              —— 拉取任务产物(成功后)
//
// 认证:Header `Authorization: Bearer <RUNNINGHUB_API_KEY>`(不再放 body.apiKey)。
//
// Schema:每个 AI-App 的 node 布局用 `AiAppSchema.fields[]` 描述,caller 传
// `{role, value}[]`,客户端按 schema 查 (nodeId, fieldName) 并拼 nodeInfoList。
// role 是语义层 key(例如 `prompt` / `first_frame`),schema 决定它落在哪个 node
// 哪个 field 上。下拉字段需要 `fieldData`(枚举字符串),客户端从 schema 读取默认
// 值或 caller 覆盖。

export type RunningHubTaskStatus = 'pending' | 'running' | 'done' | 'error';

/** 一个 AI-App 节点字段的角色语义 —— 用于把 caller 的 inputs 和 schema 对齐。 */
export type AiAppFieldRole =
  | 'prompt'
  | 'negative_prompt'
  | 'reference_image_1'
  | 'reference_image_2'
  | 'reference_image_3'
  | 'first_frame'
  | 'last_frame'
  | 'reference_video'
  | 'voice_text'
  | 'line_text'
  | 'aspect'
  | 'resolution'
  | 'duration'
  | 'ratio'
  | 'model_select'
  | 'title'
  | 'style'
  | 'version'
  | 'option';

/** 单个 node × fieldName 的 schema。一个 node 可以挂多个 fieldName,每个各起一行。 */
export interface AiAppNodeFieldSchema {
  readonly nodeId: string;
  readonly fieldName: string;
  readonly role: AiAppFieldRole;
  /** 下拉字段的枚举白名单(空表示自由文本)。RunningHub 要求把它作为 `fieldData` 传回。 */
  readonly fieldData?: string;
  /** 默认值。caller 不覆盖时客户端用这个填。 */
  readonly defaultValue?: string;
  /** 可选字段(例如 last_frame / reference_image_2):caller 不传就跳过。 */
  readonly optional?: boolean;
}

export interface AiAppSchema {
  /** RunningHub 控制台 → AI-App → "API 调用"面板里看到的 19 位数字 webappId。 */
  readonly webappId: string;
  readonly displayName: string;
  readonly fields: ReadonlyArray<AiAppNodeFieldSchema>;
}

/** caller 侧的单项输入:按 role 对齐到 schema 的 field。 */
export interface AiAppNodeInput {
  readonly role: AiAppFieldRole;
  readonly value: string;
  /**
   * 当 schema 里同一个 role 挂了多个 field(例如 `option` 在 VOICE_LINE 里挂在
   * nodeId=7 和 nodeId=6 上),用这个精确指定其中一条。不传时匹配 role 的第一条。
   */
  readonly nodeId?: string;
  readonly fieldName?: string;
}

export interface RunningHubSubmitParams {
  /**
   * 语义 key。客户端按这个在 `appSchemas` 里查 `AiAppSchema`。
   * 不再传裸 webappId —— 上层用 `RunningHubAppKey` 语义。
   */
  readonly appKey: string;
  readonly inputs: ReadonlyArray<AiAppNodeInput>;
  readonly instanceType?: 'default' | 'plus';
  readonly usePersonalQueue?: boolean;
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

/**
 * `/openapi/v2/run/ai-app/{webappId}` 的响应 —— 不带 code/data 包装,taskId 直接在顶层。
 * 成功:`errorCode === ''` 且 `taskId` 非空。
 * 失败:`errorCode` 非空(例如 "APIKEY_INVALID_NODE_INFO")+ `errorMessage` 文本。
 */
interface RhV2SubmitResponse {
  readonly taskId?: string;
  readonly status?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly clientId?: string;
}

interface RhStatusData {
  readonly status?: string;
  readonly taskStatus?: string;
  readonly reason?: string;
  readonly failReason?: string;
}

interface RhOutputItem {
  readonly fileUrl?: string;
  readonly fileType?: string;
  readonly url?: string;
}

/**
 * `/task/openapi/outputs` 在 code=805 时的结构化失败信息(官方集成文档 doc-8287340 定义)。
 * 我们尽量把这些字段透传出去,方便上层日志打到 workspace 日志里。
 */
interface RhFailedReason {
  readonly node_name?: string;
  readonly exception_message?: string;
  readonly traceback?: string;
}

interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldData?: string;
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
    const schema = this.appSchemas[params.appKey];
    if (!schema) {
      throw new Error(
        `RunningHubClient: no AiAppSchema registered for appKey="${params.appKey}". ` +
          `Add it to the client constructor's appSchemas map (check the RunningHub console's "API 调用" panel for webappId and node fields).`,
      );
    }

    const nodeInfoList = this.buildNodeInfoList(params.appKey, schema, params.inputs);

    const response = await this.postJson<RhV2SubmitResponse>(
      `/openapi/v2/run/ai-app/${encodeURIComponent(schema.webappId)}`,
      {
        nodeInfoList,
        instanceType: params.instanceType ?? 'default',
        usePersonalQueue: String(params.usePersonalQueue ?? false),
      },
      { Authorization: `Bearer ${this.apiKey}` },
    );
    // v2 协议:errorCode=""(空串)+ taskId 非空 = 成功;任一不满足都算失败。
    if (response.errorCode || !response.taskId) {
      throw new RunningHubError(
        `submit failed: ${response.errorMessage || response.errorCode || 'unknown error'}`,
        undefined,
        response,
      );
    }
    return { taskId: response.taskId };
  }

  async pollTask(taskId: string): Promise<RunningHubTaskResult> {
    // /task/openapi/status 和 /task/openapi/outputs 是 v1 端点,RunningHub 官方集成
    // 文档(doc-8287340.md,2026-04-25 核对)仍只有这两个路径,没有 v2 版本 ——
    // 用 body.apiKey 鉴权,envelope 为 { code, msg, data }。v2 迁移前保持不变。
    //
    // outputs 端点的数字 code 语义(doc-8287340):
    //   0   → 成功,data 是 [{fileUrl, fileType}]
    //   804 → 任务运行中(理论上 status 已拦截,兜底)
    //   805 → 任务失败,data.failedReason = {node_name, exception_message, traceback}
    //   813 → 任务排队中(同上,兜底)
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

    // outputs 的 data 形状随 code 变化:成功 = ReadonlyArray<RhOutputItem>,
    // 失败(code=805) = { failedReason: RhFailedReason }。用 unknown 收口,本地再窄化。
    const outputsEnv = await this.postJson<RhEnvelope<unknown>>(
      '/task/openapi/outputs',
      { apiKey: this.apiKey, taskId },
    );
    if (outputsEnv.code !== 0) {
      // code=805 → 结构化 failedReason。把 node 和异常消息拼进 errorMessage,
      // 让上层日志一眼看到是哪个 node 炸的;原 envelope 也透出去便于 debug。
      const failedReason = extractFailedReason(outputsEnv.data);
      const reasonText = failedReason
        ? `${failedReason.node_name ?? 'unknown node'}: ${failedReason.exception_message ?? ''}`.trim()
        : '';
      return {
        status: 'error',
        errorMessage:
          reasonText ||
          `outputs query failed: ${outputsEnv.msg ?? 'unknown error'} (code=${outputsEnv.code})`,
      };
    }
    if (!Array.isArray(outputsEnv.data)) {
      return {
        status: 'error',
        errorMessage: 'outputs succeeded but data was not an array of files',
      };
    }
    const first = outputsEnv.data[0] as RhOutputItem | undefined;
    const outputUri = first?.fileUrl ?? first?.url;
    if (!outputUri) {
      return {
        status: 'error',
        errorMessage: 'task succeeded but outputs envelope had no fileUrl',
      };
    }
    return { status: 'done', outputUri };
  }

  private buildNodeInfoList(
    appKey: string,
    schema: AiAppSchema,
    inputs: ReadonlyArray<AiAppNodeInput>,
  ): NodeInfo[] {
    const inputMap = new Map<string, AiAppNodeInput>();
    for (const input of inputs) {
      const key = nodeInputKey(input.role, input.nodeId, input.fieldName);
      inputMap.set(key, input);
    }

    const list: NodeInfo[] = [];
    const consumedInputKeys = new Set<string>();

    for (const field of schema.fields) {
      const preciseKey = nodeInputKey(field.role, field.nodeId, field.fieldName);
      const roleOnlyKey = nodeInputKey(field.role);
      const input = inputMap.get(preciseKey) ?? inputMap.get(roleOnlyKey);
      if (input) {
        consumedInputKeys.add(preciseKey);
        consumedInputKeys.add(roleOnlyKey);
      }

      const value = input?.value ?? field.defaultValue;
      if (value === undefined) {
        if (field.optional) continue;
        throw new Error(
          `RunningHubClient: appKey="${appKey}" missing required input for role="${field.role}" ` +
            `(nodeId=${field.nodeId}, fieldName=${field.fieldName}). ` +
            `Provide it via RunningHubSubmitParams.inputs or set a defaultValue in the schema.`,
        );
      }

      const entry: NodeInfo = {
        nodeId: field.nodeId,
        fieldName: field.fieldName,
        fieldValue: value,
      };
      if (field.fieldData !== undefined) {
        entry.fieldData = field.fieldData;
      }
      list.push(entry);
    }

    for (const input of inputs) {
      const preciseKey = nodeInputKey(input.role, input.nodeId, input.fieldName);
      const roleOnlyKey = nodeInputKey(input.role);
      if (!consumedInputKeys.has(preciseKey) && !consumedInputKeys.has(roleOnlyKey)) {
        throw new Error(
          `RunningHubClient: appKey="${appKey}" has no schema field for role="${input.role}"` +
            (input.nodeId ? ` (nodeId=${input.nodeId}, fieldName=${input.fieldName ?? '?'})` : '') +
            `. Either drop the input or add the field to the schema.`,
        );
      }
    }

    return list;
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const url = this.baseUrl + path;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
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

function nodeInputKey(role: AiAppFieldRole, nodeId?: string, fieldName?: string): string {
  return `${role}|${nodeId ?? ''}|${fieldName ?? ''}`;
}

function extractRawStatus(data: RhStatusData | string | undefined): string {
  if (typeof data === 'string') return data;
  if (!data) return '';
  return data.status ?? data.taskStatus ?? '';
}

function extractFailedReason(data: unknown): RhFailedReason | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const maybe = (data as { failedReason?: unknown }).failedReason;
  if (!maybe || typeof maybe !== 'object') return undefined;
  return maybe as RhFailedReason;
}

function mapStatus(raw: string): RunningHubTaskStatus {
  const s = raw.toUpperCase();
  if (s === 'SUCCESS' || s === 'DONE' || s === 'FINISHED' || s === 'COMPLETED') return 'done';
  if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED' || s === 'CANCELLED') return 'error';
  if (s === 'RUNNING' || s === 'PROCESSING') return 'running';
  return 'pending';
}
