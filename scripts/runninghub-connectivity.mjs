// RunningHub 连通性 smoke —— 不提交真任务,不花钱。
//
// 目的:验证 `.env` 里的 `RUNNINGHUB_API_KEY` 真实可用(鉴权通、网络通、
// JSON envelope 能正常解析),以便在真正跑 `runninghub-smoke.mjs` /
// `v5-real-key-smoke.mjs` 前提前发现配置问题。
//
// 手法:调 `/task/openapi/status` 查一个伪造 taskId。
//   - 鉴权失败(key 错/空)→ envelope `code` != 0,msg 类似 "user not exist"
//   - 鉴权成功 + taskId 不存在 → envelope `code` != 0,msg 类似 "TASK_NOT_FOUND"
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

const apiKey = process.env.RUNNINGHUB_API_KEY;
if (!apiKey) {
  console.error('[FAIL] RUNNINGHUB_API_KEY is not set in environment.');
  process.exit(1);
}

const url = BASE_URL + ENDPOINT_PATH;
console.log(`[probe] POST ${url}  taskId=${FAKE_TASK_ID}  keyLen=${apiKey.length}`);

let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, taskId: FAKE_TASK_ID }),
  });
} catch (e) {
  console.error(`[FAIL] network error: ${e.message}`);
  process.exit(1);
}

if (!res.ok) {
  console.error(`[FAIL] HTTP ${res.status} ${res.statusText}`);
  try {
    console.error(await res.text());
  } catch {}
  process.exit(1);
}

let envelope;
try {
  envelope = await res.json();
} catch (e) {
  console.error(`[FAIL] response was not JSON: ${e.message}`);
  process.exit(1);
}

console.log('[probe] envelope:', JSON.stringify(envelope));

const msg = String(envelope?.msg ?? '').toLowerCase();

// 认证失败信号(已知:301 "user not exist" / APIKEY_INVALID_NODE_INFO)
const authFailedPatterns = [
  'user not exist',
  'apikey',
  'api key',
  'authentication',
  'unauthorized',
];
const looksAuthFailed = authFailedPatterns.some((p) => msg.includes(p));

if (looksAuthFailed) {
  console.error(
    `[FAIL] authentication rejected by RunningHub: msg="${envelope.msg}" (code=${envelope.code}). ` +
      `Check RUNNINGHUB_API_KEY in .env.`,
  );
  process.exit(1);
}

// 其它非 0 code(task not found / webapp not exists / etc.)都算握手通过:
// 鉴权层过了,我们只是用了无效 taskId。
console.log(`[PASS] auth + JSON envelope handshake OK (envelope.code=${envelope.code}).`);
console.log(
  '[PASS] If you planned to run runninghub-smoke.mjs or v5-real-key-smoke.mjs, your key is reachable.',
);
process.exit(0);
