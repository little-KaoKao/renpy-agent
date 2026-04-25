// 轻量 retry helper:供 pipeline 三阶段(planner / writer / storyboarder)复用。
//
// 治的不是网络错误 —— 那是 SDK maxRetries 的工作。治的是 temperature>0 下
// LLM 偶发的 JSON 语法/结构错误(引号、逗号、缺字段)。重试一次,换一次随机性。
// 重试 >1 次也没多大意义:如果 prompt 本身产生结构不合法的输出,多试几次也不会
// 变好,只是白烧钱。

export interface RetryJsonParams<T> {
  readonly attempt: () => Promise<T>;
  readonly maxAttempts?: number;
  readonly onRetry?: (error: Error, attempt: number) => void;
}

export async function retryJsonParse<T>(params: RetryJsonParams<T>): Promise<T> {
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
  throw lastError ?? new Error('retryJsonParse: exhausted without error');
}

function isRetriableLlmOutputError(err: Error): boolean {
  const msg = err.message;
  // StageParseError always wraps a retriable parse/shape error by construction.
  if (err.name === 'StageParseError') return true;
  if (err instanceof SyntaxError) return true; // JSON.parse failures
  if (msg.startsWith('LLM response did not contain a JSON block')) return true;
  if (msg.startsWith('Planner output ')) return true;
  if (msg.startsWith('Writer output ')) return true;
  if (msg.startsWith('Storyboarder output ')) return true;
  if (msg.startsWith('scene[')) return true;
  if (msg.startsWith('shot[')) return true;
  return false;
}
