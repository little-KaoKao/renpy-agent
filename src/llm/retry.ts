// 轻量 retry helper:供 pipeline 三阶段(planner / writer / storyboarder)复用。
//
// v0.7 起,三阶段已切到 tool_use,LLM 输出是 SDK 反序列化好的结构化对象,不再有
// "字符串 JSON parse 出错"这种场景。本 helper 现在只治:
//   - LLM 没调指定 tool(漏了 emit_*_output 就 bail)
//   - 调了 tool 但输入缺字段 / 结构不合法(assert 抛的校验错)
// 重试一次换一次随机性;重试 >1 次意义不大(prompt 不变,模型大概率还是漏同一字段)。
//
// 网络错误 / 5xx 不归这里管 —— SDK 自己带 maxRetries。
//
// 名字:旧版叫 retryJsonParse(治 JSON 字符串 parse 失败)。v0.7 tool_use 把文本 JSON
// 这条路径整个删了,保留的责任从"字符串 parse"变成"结构校验",所以改名。

export interface RetryOnStageValidationErrorParams<T> {
  readonly attempt: () => Promise<T>;
  readonly maxAttempts?: number;
  readonly onRetry?: (error: Error, attempt: number) => void;
}

export async function retryOnStageValidationError<T>(
  params: RetryOnStageValidationErrorParams<T>,
): Promise<T> {
  const maxAttempts = params.maxAttempts ?? 2;
  let lastError: Error | undefined;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await params.attempt();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!isRetriableLlmOutputError(err)) throw err;
      lastError = err;
      if (i < maxAttempts) {
        params.onRetry?.(err, i);
      }
    }
  }
  throw lastError ?? new Error('retryOnStageValidationError: exhausted without error');
}

function isRetriableLlmOutputError(err: Error): boolean {
  const msg = err.message;
  // StageParseError always wraps a retriable schema-validation error by construction.
  if (err.name === 'StageParseError') return true;
  if (msg.startsWith('LLM did not call tool ')) return true;
  if (msg.startsWith('Planner output ')) return true;
  if (msg.startsWith('Writer output ')) return true;
  if (msg.startsWith('Storyboarder output ')) return true;
  if (msg.startsWith('scene[')) return true;
  if (msg.startsWith('shot[')) return true;
  return false;
}

