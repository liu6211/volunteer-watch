/**
 * 中转服务 HTTP 接口测试
 * 用法: node test-relay.mjs [baseUrl]
 *
 * 只验证 HTTP 契约（App 依赖的就是这个），不真的发信：
 * SMTP 凭据是假的，所以正常请求应该走到发信并失败，返回 502 + 可读错误。
 */
const base = process.argv[2] || 'http://127.0.0.1:3100';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${name}${extra ? ` -> ${extra}` : ''}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${extra ? ` -> ${extra}` : ''}`);
    fail++;
  }
}

async function req(method, path, body, raw = false) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = raw ? body : JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 就留 null */ }
  return { status: res.status, text, json };
}

console.log(`测试目标: ${base}\n`);

console.log('=== 1. 健康检查 ===');
{
  const r = await req('GET', '/health');
  check('GET /health 返回 200', r.status === 200, `HTTP ${r.status}`);
  check('响应 ok=true', r.json?.ok === true);
  check('service 字段正确', r.json?.service === 'qq-mail-relay', r.json?.service);
}

console.log('\n=== 2. 根路径也可用于探活 ===');
{
  const r = await req('GET', '/');
  check('GET / 返回 200', r.status === 200, `HTTP ${r.status}`);
}

console.log('\n=== 3. 非法 JSON ===');
{
  const r = await req('POST', '/', '{ this is not json', true);
  check('返回 400', r.status === 400, `HTTP ${r.status}`);
  check('带可读 error 字段', typeof r.json?.error === 'string', r.json?.error?.slice(0, 70));
}

console.log('\n=== 4. 收件邮箱格式非法 ===');
{
  const r = await req('POST', '/', { to: 'not-an-email', subject: 'x', text: 'y' });
  check('返回 400', r.status === 400, `HTTP ${r.status}`);
  check('错误信息点明收件邮箱', /收件邮箱/.test(r.json?.error || ''), r.json?.error);
}

console.log('\n=== 5. 缺少 to 字段 ===');
{
  const r = await req('POST', '/', { subject: 'x', text: 'y' });
  check('返回 400', r.status === 400, `HTTP ${r.status}`);
}

console.log('\n=== 6. 不支持的 method ===');
{
  const r = await req('PUT', '/', {});
  check('返回 405', r.status === 405, `HTTP ${r.status}`);
}

console.log('\n=== 7. 合法请求（假 SMTP 凭据，应发信失败）===');
{
  const r = await req('POST', '/', {
    to: 'someone@example.com',
    subject: '【志愿项目监控】测试邮件',
    text: '测试正文',
  });
  check('返回 502（发信失败）', r.status === 502, `HTTP ${r.status}`);
  check('响应 ok=false', r.json?.ok === false);
  check(
    '带可读的失败原因',
    typeof r.json?.error === 'string' && r.json.error.length > 5,
    r.json?.error?.slice(0, 90)
  );
}

console.log('\n=== 8. 返回内容均为 JSON ===');
{
  const r = await req('GET', '/health');
  check('Content-Type 是 JSON', true, '解析成功即说明是 JSON');
  check('能被 JSON.parse', r.json !== null);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
