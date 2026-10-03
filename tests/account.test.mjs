/**
 * 账号页解析测试
 *
 * 样本是照着真实页面结构写的脱敏版本（真实页面含姓名/电话/邮箱，不适合入库）。
 * 另外用 .tools/verify-account-parse.mjs 对真实页面跑一次，确保解析器真的能用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMyProjects, parseMyOrgs, parseMyHours, login,
  SITE_PUBKEY, ACCOUNT_PATHS, createSession, checkNeedCaptcha,
} from '../src/core/account.mjs';

/* ------------------------------------------------ 我的项目（真实结构） */

const PROJECTS_HTML = `
<table class="table1">
  <tr><th>项目名称</th><th width="80">加入日期</th>
  <th width="60">状态</th><th width="90">岗位</th><th width="80">服务时长</th><th width="80">操作</th></tr>
  <tr>
    <td>
    <a class="f14" href="/app/opp/view.php?id=AAA111">20260928-30游园会志愿服务</a> <br>
      项目团体：某志愿者服务队 <br>
    联系人：<a href="mailto:x@example.com" title="给他发送邮件">张三</a>
    手机：13800000000　                    电话：0854-0000000　                    </td>
    <td>
    2026-09-27                    </td>

    <td>
    <font color="green">已录用</font>                    </td>
    <td>巡查</td>
    <td>
    <a href="/app/user/hour.php?opp_id=9710047" target="_blank" title="点击查看详细服务时长记录"><span style="font-size:14px;">3.0</span></a>
    </td>
    <td>
            <a href="javascript:void(0);" onclick="show_add_score(9710047,0);">评价</a>
                                        </td>
  </tr>
  <tr>
    <td>
    <a class="f14" href="/app/opp/view.php?id=BBB222">20260502州图书馆志愿服务</a> <br>
      项目团体：某志愿者服务队 <br>
                    </td>
    <td>2026-04-28</td>
    <td><font color="green">已录用</font></td>
    <td>守书</td>
    <td><a href="/app/user/hour.php?opp_id=9603365"><span>6.0</span></a></td>
    <td><a href="javascript:void(0);">评价</a></td>
  </tr>
</table>`;

test('parseMyProjects: 解析出全部项目', () => {
  const r = parseMyProjects(PROJECTS_HTML);
  assert.equal(r.items.length, 2);
});

test('parseMyProjects: 字段都对', () => {
  const [a] = parseMyProjects(PROJECTS_HTML).items;
  assert.equal(a.name, '20260928-30游园会志愿服务');
  assert.equal(a.url, '/app/opp/view.php?id=AAA111');
  assert.equal(a.org, '某志愿者服务队');
  assert.equal(a.joinedAt, '2026-09-27');
  assert.equal(a.status, '已录用');
  assert.equal(a.post, '巡查');
  assert.equal(a.hours, '3.0');
});

test('parseMyProjects: 表头不会被当成数据', () => {
  const r = parseMyProjects(PROJECTS_HTML);
  assert.ok(!r.items.some((i) => i.name.includes('项目名称')));
});

test('parseMyProjects: 空页面不崩', () => {
  assert.deepEqual(parseMyProjects('<html></html>').items, []);
});

/* ------------------------------------------------ 我的团体（真实结构） */

const ORGS_HTML = `
<table class="table1">
  <tr><th>团体名称</th><th width="180">联系方式</th><th width="100">加入时间</th><th width="70">状态</th><th width="70">操作</th></tr>
  <tr>
    <td>
    <a class="f14" href="/app/org/view.php?id=CCC333">某市图书馆志愿服务</a> <br>
      区域：黔南布依族苗族自治州                            &nbsp;&nbsp;分组：                    </td>
    <td>
    联系人：<a href="mailto:y@example.com">李四</a><br>
    手机：18600000000<br>                    电话：0854-1111111<br>                    </td>
    <td>2026-10-03</td>
    <td><font color="">申请审核中</font></td>
    <td><a href="javascript:void(0);" onclick="del_org_vol(228839132,1);">删除</a></td>
  </tr>
  <tr>
    <td>
    <a class="f14" href="/app/org/view.php?id=DDD444">都匀三中青年志愿者服务队</a> <br>
      区域：黔南布依族苗族自治州                            &nbsp;&nbsp;分组：                    </td>
    <td>联系人：<a href="mailto:z@example.com">王五</a><br></td>
    <td>2026-01-20</td>
    <td><font color="green">已加入</font></td>
    <td><a href="javascript:void(0);">脱离</a></td>
  </tr>
</table>`;

test('parseMyOrgs: 解析出全部团体', () => {
  const r = parseMyOrgs(ORGS_HTML);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[1].name, '都匀三中青年志愿者服务队');
  assert.equal(r.items[1].url, '/app/org/view.php?id=DDD444');
  assert.equal(r.items[1].status, '已加入');
  assert.equal(r.items[1].joinedAt, '2026-01-20');
  assert.equal(r.items[1].area, '黔南布依族苗族自治州');
});

test('parseMyOrgs: 待审核状态也能读出来', () => {
  const r = parseMyOrgs(ORGS_HTML);
  assert.equal(r.items[0].status, '申请审核中');
});

/* ------------------------------------------------ 服务时长（真实结构） */

const HOURS_HTML = `
<table class="table1">
  <tr><th>服务时长/备注</th><th width="50">状态/添加方式</th><th width="300">服务项目/服务团体</th><th width="120">日期</th></tr>
  <tr>
    <td><b>6.0小时</b><font color="#888">【在29号下午和30号上午我都去了】</font></td>
    <td><font color="#888888">未生效</font><br><font color="green">个人申请</font></td>
    <td><a href="/app/opp/view.php?id=EEE555">20260928-30游园会志愿服务</a><br><a href="/app/org/view.php?id=FFF666">都匀三中青年志愿者服务队</a></td>
    <td>2026-10-03 14:46:13</td>
  </tr>
  <tr>
    <td><b>3.0小时</b><font color="#888">【20260929】</font></td>
    <td><font color="#227700">已生效</font><br><font color="red">团体录入</font></td>
    <td><a href="/app/opp/view.php?id=GGG777">20260928-30游园会志愿服务</a><br><a href="/app/org/view.php?id=HHH888">都匀三中青年志愿者服务队</a></td>
    <td>2026-10-01 19:07:51</td>
  </tr>
</table>`;

test('parseMyHours: 解析出全部时长记录', () => {
  const r = parseMyHours(HOURS_HTML);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].hours, 6);
  assert.equal(r.items[1].hours, 3);
});

test('parseMyHours: 项目与团体分别取到', () => {
  const [a, b] = parseMyHours(HOURS_HTML).items;
  assert.equal(a.project, '20260928-30游园会志愿服务');
  assert.equal(a.projectUrl, '/app/opp/view.php?id=EEE555');
  assert.equal(a.org, '都匀三中青年志愿者服务队');
  assert.equal(b.org, '都匀三中青年志愿者服务队');
});

test('parseMyHours: 状态与添加方式分开', () => {
  const [a, b] = parseMyHours(HOURS_HTML).items;
  assert.equal(a.status, '未生效');
  assert.equal(a.addedBy, '个人申请');
  assert.equal(b.status, '已生效');
  assert.equal(b.addedBy, '团体录入');
  assert.equal(a.note, '在29号下午和30号上午我都去了');
});

test('parseMyHours: 汇总总时长与已生效时长', () => {
  const r = parseMyHours(HOURS_HTML);
  assert.equal(r.total, 9);
  assert.equal(r.effective, 3, '只有「已生效」的才算数');
});

test('parseMyHours: 注释掉的旧记录不会被算进去', () => {
  const html = `<table class="table1">
    <tr><th>a</th><th>b</th><th>c</th><th>d</th></tr>
    <!--
    <tr><td><b>9.9小时</b></td><td>未生效</td><td>x</td><td>y</td></tr>
    -->
    <tr><td><b>1.0小时</b></td><td>已生效</td><td>x</td><td>y</td></tr>
  </table>`;
  const r = parseMyHours(html);
  assert.equal(r.items.length, 1, '被注释掉的行不应计入');
  assert.equal(r.total, 1);
});

/* ------------------------------------------------ 登录结果分类 */

/** 造一个假的登录环境：GET 返回登录页，POST 返回指定结果 */
function fakeLoginEnv(postBody) {
  return async (url, opts = {}) => {
    const isPost = (opts.method || 'GET').toUpperCase() === 'POST';
    const text = isPost
      ? postBody
      : '<html><input type="hidden" id="seid" value="TESTSEID"></html>';
    return {
      ok: true,
      status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => text,
    };
  };
}

test('login: 密码错误时必须报错，【不能】要求验证码', async () => {
  const r = await login(
    createSession(), 'gz.zhiyuanyun.com', 'someone', 'wrong-pass', undefined,
    { fetchImpl: fakeLoginEnv('{"code":"1","msg":"用户名或密码错误"}') }
  );
  assert.equal(r.ok, false);
  assert.equal(r.needCaptcha, false, '密码错不是验证码问题，不能弹验证码框');
  assert.match(r.message, /密码错误/);
});

test('login: 提示里带「验证码」时才要求填验证码', async () => {
  const r = await login(
    createSession(), 'gz.zhiyuanyun.com', 'someone', 'pw', undefined,
    { fetchImpl: fakeLoginEnv('{"code":"1","show":"为了防止暴力登录，系统增加登录验证码"}') }
  );
  assert.equal(r.ok, false);
  assert.equal(r.needCaptcha, true);
  assert.match(r.message, /验证码/);
});

test('login: 成功时 ok=true', async () => {
  const r = await login(
    createSession(), 'gz.zhiyuanyun.com', 'someone', 'pw', undefined,
    { fetchImpl: fakeLoginEnv('{"code":"0","msg":"登录成功","referer":"/app/user/home.php"}') }
  );
  assert.equal(r.ok, true);
});

test('login: 服务器把登录页返回回来时，明确指出会话没建立', async () => {
  const r = await login(
    createSession(), 'gz.zhiyuanyun.com', 'someone', 'pw', undefined,
    { fetchImpl: fakeLoginEnv('<html><div id="ulogin">登录志愿贵州</div></html>') }
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /会话没有建立|登录页/);
  assert.ok(r.diag, '应带上诊断信息');
});

test('login: 第一次「授权失败」会自动换 Cookie 模式重试并成功', async () => {
  // 模拟 iOS：平台自己管的 Cookie 是旧会话 → 授权失败；
  // 换成手动带 Cookie 后成功。
  const calls = [];
  const fake = async (url, opts = {}) => {
    const isPost = (opts.method || 'GET').toUpperCase() === 'POST';
    const manual = !!opts.headers?.Cookie;
    calls.push(`${isPost ? 'POST' : 'GET'}:${manual ? 'manual' : 'platform'}`);

    if (!isPost) {
      return {
        ok: true, status: 200,
        headers: {
          get: (k) => (String(k).toLowerCase() === 'set-cookie' ? 'PHPSESSID=abc; path=/' : null),
          getSetCookie: () => [],
        },
        text: async () => '<html><input type="hidden" id="seid" value="S1"></html>',
      };
    }
    const body = manual
      ? '{"code":"0","msg":"登录成功"}'
      : '{"code":"1","msg":"授权失败，请按Ctrl+F5键刷新网页试试！"}';
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => body,
    };
  };

  const session = createSession();
  const r = await login(session, 'gz.zhiyuanyun.com', 'someone', 'pw', undefined, { fetchImpl: fake });

  assert.equal(r.ok, true, '重试后应该成功');
  assert.equal(session.cookieMode, 'manual', '应记住最终生效的模式');
  // 第 3 次是重试时的 GET：此刻新会话还没有 cookie，所以仍是 platform 形态；
  // 关键在第 4 次 POST 带上了 Cookie 头
  assert.deepEqual(calls, ['GET:platform', 'POST:platform', 'GET:platform', 'POST:manual']);
});

test('login: 站点让按 Ctrl+F5 的提示会翻译成人话（手机没这个键）', async () => {
  // 两次都失败，且都返回授权失败
  const fake = async (url, opts = {}) => {
    const isPost = (opts.method || 'GET').toUpperCase() === 'POST';
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => (isPost
        ? '{"code":"1","msg":"授权失败，请按Ctrl+F5键刷新网页试试！"}'
        : '<html><input type="hidden" id="seid" value="S1"></html>'),
    };
  };
  const r = await login(createSession(), 'gz.zhiyuanyun.com', 'u', 'p', undefined, { fetchImpl: fake });
  assert.equal(r.ok, false);
  assert.ok(!/Ctrl\+F5/i.test(r.message), '不应把 Ctrl+F5 这种电脑术语丢给手机用户');
  assert.match(r.message, /网络|会话/);
});

test('login: 请求超时会翻译成中文提示，而不是一直转圈', async () => {
  const hang = async () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    throw e;
  };
  await assert.rejects(
    () => login(createSession(), 'gz.zhiyuanyun.com', 'u', 'p', undefined, { fetchImpl: hang }),
    /超时/
  );
});

test('login: 提交字段完全对齐浏览器（含空的 uyzm）', async () => {
  // 站点用 C.form.get_form('#ulogin') 取值：拿 input 的 id 当键、按 DOM 顺序遍历。
  // 验证码框在页面上一直存在（只是隐藏），所以浏览器即使没有验证码也会提交空串。
  let postBody = '';
  let contentType = '';
  const fake = async (url, opts = {}) => {
    const isPost = (opts.method || 'GET').toUpperCase() === 'POST';
    if (isPost) {
      postBody = opts.body;
      contentType = opts.headers['Content-Type'];
    }
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => (isPost
        ? '{"code":"0","msg":"登录成功"}'
        : '<html><input type="hidden" id="seid" value="SEID123"></html>'),
    };
  };

  await login(createSession(), 'gz.zhiyuanyun.com', 'liu_liuen', 'pw', undefined, { fetchImpl: fake });

  const params = new URLSearchParams(postBody);
  // 字段齐不齐
  assert.deepEqual(
    [...params.keys()],
    ['seid', 'uname', 'upass', 'referer', 'uyzm'],
    '字段名与顺序都要和浏览器一致'
  );
  assert.equal(params.get('seid'), 'SEID123');
  assert.equal(params.get('uname'), 'liu_liuen');
  assert.equal(params.get('referer'), '/app/user/home.php');
  assert.equal(params.get('uyzm'), '', '没有验证码时也必须提交空串');
  assert.ok(params.get('upass').length > 100, '密码必须已加密');
  assert.match(contentType, /x-www-form-urlencoded/);
});

test('login: 手动 Cookie 模式用 credentials=omit，避免新旧 Cookie 混在一起', async () => {
  const seen = [];
  const fake = async (url, opts = {}) => {
    const isPost = (opts.method || 'GET').toUpperCase() === 'POST';
    seen.push({ isPost, credentials: opts.credentials, cookie: opts.headers?.Cookie });
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => (isPost
        ? '{"code":"0","msg":"登录成功"}'
        : '<html><input type="hidden" id="seid" value="S"></html>'),
    };
  };
  await login(createSession(), 'gz.zhiyuanyun.com', 'u', 'p', undefined, { fetchImpl: fake });

  for (const c of seen) {
    // 平台模式靠运行环境带 cookie；手动模式必须自己带且不许运行环境插手
    if (c.cookie) assert.equal(c.credentials, 'omit', '手动带 Cookie 时必须 omit');
    else assert.equal(c.credentials, 'include');
  }
});

/* ------------------------------------------------ 常量与工具 */

test('账号页地址是实测出来的那三个', () => {
  assert.equal(ACCOUNT_PATHS.projects, '/app/opp/opp.my.php');
  assert.equal(ACCOUNT_PATHS.orgs, '/app/org/org.my.php');
  // 注意：不是 servicetime.php（那个是 404）
  assert.equal(ACCOUNT_PATHS.hours, '/app/user/hour.php');
});

test('站点公钥能解析（登录要用它加密密码）', () => {
  assert.match(SITE_PUBKEY, /BEGIN PUBLIC KEY/);
});

test('createSession: 初始会话为空，默认让运行环境管 Cookie', () => {
  assert.deepEqual(createSession(), { cookie: '', seid: '', cookieMode: 'platform' });
});

test('checkNeedCaptcha: 用 GET 请求（POST 会被站点拦成访问超时）', async () => {
  let method = '';
  let url = '';
  const fakeFetch = async (u, o) => {
    url = u; method = o.method;
    return {
      ok: true, status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => '{"code":"0","show":"为了防止暴力登录，系统增加登录验证码"}',
    };
  };
  const r = await checkNeedCaptcha(
    createSession(), 'gz.zhiyuanyun.com', 'someone', { fetchImpl: fakeFetch }
  );
  assert.equal(method, 'GET');
  assert.match(url, /uname\.php\?m=uname/);
  assert.match(url, /uname=someone/);
  assert.equal(r.needCaptcha, false);
  assert.match(r.message, /验证码/);
});

test('checkNeedCaptcha: code=1 时判定为需要验证码', async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [] },
    text: async () => '{"code":"1","show":"<div>请微信关注，回复：登录验证码</div>"}',
  });
  const r = await checkNeedCaptcha(
    createSession(), 'gz.zhiyuanyun.com', 'someone', { fetchImpl: fakeFetch }
  );
  assert.equal(r.needCaptcha, true);
  assert.match(r.message, /微信/);
  assert.ok(!r.message.includes('<div>'), '应该去掉 html 标签');
});
