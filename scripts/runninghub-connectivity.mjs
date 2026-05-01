// RunningHub 连通性 smoke —— 不提交真任务,不花钱。
//
// 目的:验证 `.env` 里的 `RUNNINGHUB_API_KEY` 真实可用(鉴权通、网络通、
// JSON envelope 能正常解析),以便在真正跑 `runninghub-smoke.mjs` /
// `v5-real-key-smoke.mjs` 前提前发现配置问题。
//
// 手法:调 `/task/openapi/status` 查一个伪造 taskId。
//   - 鉴权失败(key 错/空)→ envelope `code` != 0,msg 类似 "user not exist"
//   - 鉴权成功 + taskId 不存在 → envelope `code` != 0,msg 类似
//     "taskId must be positive" / "TASK_NOT_FOUND"
//
// 前者是"配置没跑通",后者是"配置跑通,API 握手正常"。只有后者判 PASS。
//
// 用法:
//   node --env-file=.env scripts/runninghub-connectivity.mjs
//
// 退出码:0 = 握手通过;1 = 握手失败(鉴权/网络/响应格式)。

const FAKE_TASK_ID = 'connectivity-probe-00000000';
const ENDPOINT_PATH = '/task/openapi/status';
const BASE_URL = 'https://www.runninghub.cn';

async function main() {
  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) {
    console.error('[FAIL] RUNNINGHUB_API_KEY is not set in environment.');
    return 1;
  }

  const url = BASE_URL + ENDPOINT_PATH;
  console.log(`[probe] POST ${url}  taskId=${FAKE_TASK_ID}  keyLen=${apiKey.length}`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // Connection: close avoids a libuv UV_HANDLE_CLOSING assertion on Node 24 +
      // Windows when process exits while undici's keep-alive socket is still
      // pending cleanup. Harmless for a one-shot probe.
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ apiKey, taskId: FAKE_TASK_ID }),
    });
  } catch (e) {
    console.error(`[FAIL] network error: ${e.message}`);
    return 1;
  }

  if (!res.ok) {
    console.error(`[FAIL] HTTP ${res.status} ${res.statusText}`);
    try {
      console.error(await res.text());
    } catch {}
    return 1;
  }

  let envelope;
  try {
    envelope = await res.json();
  } catch (e) {
    console.error(`[FAIL] response was not JSON: ${e.message}`);
    return 1;
  }

  console.log('[probe] envelope:', JSON.stringify(envelope));

  const msg = String(envelope?.msg ?? '').toLowerCase();

  // 认证失败信号(已知:301 "user not exist" / APIKEY_INVALID_NODE_INFO)。
  // "taskId must be positive" 不在此列 —— 那是我们故意喂假 taskId 触发的校验错误,
  // 恰恰说明鉴权已经过了、走到了业务校验层。
  const authFailedPatterns = [
    'user not exist',
    'apikey invalid',
    'api key invalid',
    'authentication',
    'unauthorized',
  ];
  const looksAuthFailed = authFailedPatterns.some((p) => msg.includes(p));

  if (looksAuthFailed) {
    console.error(
      `[FAIL] authentication rejected by RunningHub: msg="${envelope.msg}" (code=${envelope.code}). ` +
        `Check RUNNINGHUB_API_KEY in .env.`,
    );
    return 1;
  }

  console.log(`[PASS] auth + JSON envelope handshake OK (envelope.code=${envelope.code}).`);
  console.log(
    '[PASS] If you planned to run runninghub-smoke.mjs or v5-real-key-smoke.mjs, your key is reachable.',
  );
  return 0;
}

// Use process.exitCode + natural loop drain (don't call process.exit) to let
// Node's pending handles clean up on Windows. Avoids the known Node 24 /
// libuv UV_HANDLE_CLOSING assertion that can fire on forced exit.
process.exitCode = await main();
