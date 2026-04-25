// 供 planner/writer/storyboarder 使用:当 LLM raw response 无法解析/校验时抛出,
// 把 raw 文本挂在错误上,让 pipeline 层落盘到 workspace/debug/ 供人工诊断。
//
// 光 retry 不够 —— 如果 prompt/模型组合稳定产生同类错误,重试只是多烧钱。拿到
// raw 才能决定是调 prompt 还是降 temperature。

export class StageParseError extends Error {
  readonly rawResponse: string;
  constructor(message: string, rawResponse: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StageParseError';
    this.rawResponse = rawResponse;
  }
}

/** Narrow helper: wrap a SyntaxError (or any error) into a StageParseError with raw. */
export function wrapParseError(e: unknown, rawResponse: string): StageParseError {
  if (e instanceof StageParseError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new StageParseError(msg, rawResponse, { cause: e });
}
