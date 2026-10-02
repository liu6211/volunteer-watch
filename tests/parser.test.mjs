/**
 * 核心逻辑单元测试
 * 运行：npm run test:offline
 *
 * 使用真实抓取到的页面样本（tests/fixtures/org_page.html）做回归测试。
 * 样本来源：都匀三中青年志愿者服务队
 *   https://gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeOrgInput, orgViewUrl, oppViewUrl, siteLabel, DEFAULT_HOST,
} from '../src/core/url.mjs';
import {
  parseOrgPage, parseProjects, parseOrgName, parseOrgId, validateOrgPage,
  detectCharset, decodeEntities, findNewProjects, parseLooseDate,
  buildNotificationText,
} from '../src/core/parser.mjs';
import { fingerprintOf, toCounts, findNewByCounts } from '../src/core/fingerprint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'org_page.html'), 'utf8');
const REAL_ID = 'Vl6t7DSgAHI3O';

/** 一个假的「登录页」样本，用来验证无效链接能被识别 */
const LOGIN_PAGE = `
<html><head><title>志愿贵州</title></head><body>
  <a href="javascript:void(0);">亲，请登录</a>
  <a href="//gz.zhiyuanyun.com/app/user/login.php">登录</a>
  <a href="//gz.zhiyuanyun.com/app/user/login.php">登录</a>
  <a href="//gz.zhiyuanyun.com/app/user/login.php">登录</a>
  <a href="//gz.zhiyuanyun.com/app/user/register.php">志愿者注册</a>
  <a href="//gz.zhiyuanyun.com/app/user/register.php">注册</a>
  <a href="//gz.zhiyuanyun.com/app/user/register.php">注册</a>
</body></html>`;

// ============================================================ url.mjs

test('normalizeOrgInput: 完整 https 链接', () => {
  const r = normalizeOrgInput(`https://gz.zhiyuanyun.com/app/org/view.php?id=${REAL_ID}`);
  assert.equal(r.id, REAL_ID);
  assert.equal(r.host, 'gz.zhiyuanyun.com');
});

test('normalizeOrgInput: 不带协议的链接', () => {
  const r = normalizeOrgInput(`gz.zhiyuanyun.com/app/org/view.php?id=${REAL_ID}`);
  assert.equal(r.id, REAL_ID);
  assert.equal(r.host, 'gz.zhiyuanyun.com');
});

test('normalizeOrgInput: 裸 id 走默认站点', () => {
  const r = normalizeOrgInput(REAL_ID);
  assert.equal(r.id, REAL_ID);
  assert.equal(r.host, DEFAULT_HOST);
});

test('normalizeOrgInput: 其他省份分站也能识别', () => {
  const r = normalizeOrgInput(`https://gd.zhiyuanyun.com/app/org/view.php?id=${REAL_ID}`);
  assert.equal(r.host, 'gd.zhiyuanyun.com');
  assert.equal(siteLabel(r.host), '志愿广东');
});

test('normalizeOrgInput: 链接前后有空格/换行也能处理', () => {
  const r = normalizeOrgInput(`   https://gz.zhiyuanyun.com/app/org/view.php?id=${REAL_ID}\n`);
  assert.equal(r.id, REAL_ID);
});

test('normalizeOrgInput: 空输入报错', () => {
  assert.throws(() => normalizeOrgInput(''), /请填写/);
});

test('normalizeOrgInput: 非志愿云域名报错', () => {
  assert.throws(() => normalizeOrgInput('https://example.com/app/org/view.php?id=abc12345'), /不是志愿云/);
});

test('normalizeOrgInput: 缺少 id 参数报错', () => {
  assert.throws(() => normalizeOrgInput('https://gz.zhiyuanyun.com/app/org/list.php'), /没有找到团体 id/);
});

test('orgViewUrl / oppViewUrl 拼接正确', () => {
  assert.equal(orgViewUrl('gz.zhiyuanyun.com', 'ABC123'), 'https://gz.zhiyuanyun.com/app/org/view.php?id=ABC123');
  assert.equal(oppViewUrl('gz.zhiyuanyun.com', 'xyz'), 'https://gz.zhiyuanyun.com/app/opp/view.php?id=xyz');
});

// ========================================================= 真实页面解析

test('parseOrgName: 从真实页面拿到团体名（不用 title，因为无效页 title 是站点名）', () => {
  assert.equal(parseOrgName(FIXTURE), '都匀三中青年志愿者服务队');
});

test('parseOrgId: 拿到 org_join 里的数字编号', () => {
  assert.equal(parseOrgId(FIXTURE), '6385777');
});

test('parseProjects: 真实页面解析出 20 个项目', () => {
  assert.equal(parseProjects(FIXTURE).length, 20);
});

test('parseProjects: 字段完整（名称/日期/状态/链接/指纹）', () => {
  const [first] = parseProjects(FIXTURE);
  assert.equal(first.name, '20261006万达广场一号门宠物领养志愿服务');
  assert.equal(first.date, '2026-10-01');
  assert.equal(first.status, '运行中');
  assert.match(first.url, /^https:\/\/gz\.zhiyuanyun\.com\/app\/opp\/view\.php\?id=/);
  assert.ok(first.fingerprint.includes('20261006万达广场一号门宠物领养志愿服务'));
  assert.ok(first.id.length > 0);
});

test('parseOrgPage: 返回结构完整', () => {
  const snap = parseOrgPage(FIXTURE, { host: 'gz.zhiyuanyun.com' });
  assert.equal(snap.orgName, '都匀三中青年志愿者服务队');
  assert.equal(snap.orgId, '6385777');
  assert.equal(snap.projects.length, 20);
  assert.equal(snap.projectIds.length, 20);
  assert.ok(Object.keys(snap.counts).length > 0);
  assert.ok(snap.fetchedAt);
});

// ======================================= 关键回归：项目 id 会变，指纹不变

test('指纹不依赖项目 id —— 这是踩过的坑的回归测试', () => {
  // 同一个项目，两次请求拿到完全不同的 id（站点做了会话级加密）
  const a = {
    id: '3zCRrcYEqNnOt',
    name: '20261006万达广场一号门宠物领养志愿服务',
    date: '2026-10-01',
    status: '运行中',
  };
  const b = {
    id: '8kp0qtXjsa66i', // 同一个项目，id 完全不同
    name: '20261006万达广场一号门宠物领养志愿服务',
    date: '2026-10-01',
    status: '运行中',
  };
  assert.equal(fingerprintOf(a), fingerprintOf(b), '同一项目的指纹必须一致，与 id 无关');

  const c = { ...a, name: '另一个项目' };
  assert.notEqual(fingerprintOf(a), fingerprintOf(c), '不同项目的指纹必须不同');
});

test('同一页面抓两次（id 全变）不应识别出新项目', () => {
  const first = parseOrgPage(FIXTURE, { host: 'gz.zhiyuanyun.com' });

  // 模拟第二次抓取：项目名称/日期/状态完全一样，但所有 id 都变了
  const secondProjects = first.projects.map((p, i) => ({
    ...p,
    id: `RANDOM_${i}_${Math.random().toString(36).slice(2)}`,
    url: `https://gz.zhiyuanyun.com/app/opp/view.php?id=RANDOM_${i}`,
  }));

  const detected = findNewProjects(secondProjects, first.counts);
  assert.equal(detected.length, 0, 'id 变了但项目没变，不应报新项目');
});

test('真实新增一个项目时能识别出来', () => {
  const first = parseOrgPage(FIXTURE, { host: 'gz.zhiyuanyun.com' });

  const brandNew = {
    id: 'RANDOMNEW',
    fingerprint: fingerprintOf({
      name: '20261020全新的志愿服务项目', date: '2026-10-20', status: '运行中',
    }),
    name: '20261020全新的志愿服务项目',
    date: '2026-10-20',
    status: '运行中',
    url: 'https://gz.zhiyuanyun.com/app/opp/view.php?id=RANDOMNEW',
  };

  const detected = findNewProjects([brandNew, ...first.projects], first.counts);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].item.name, '20261020全新的志愿服务项目');
  assert.equal(detected[0].reason, 'new-id', '基线里没有这个指纹');
});

// ==================================================== 计数表 diff 逻辑

test('toCounts: 统计同指纹的重复条数', () => {
  const items = [
    { name: 'A', date: '2026-01-01', status: '运行中' },
    { name: 'A', date: '2026-01-01', status: '运行中' },
    { name: 'B', date: '2026-01-02', status: '运行中' },
  ];
  const c = toCounts(items);
  assert.equal(c[fingerprintOf(items[0])], 2);
  assert.equal(c[fingerprintOf(items[2])], 1);
});

test('findNewByCounts: 首次运行不发通知（基线为空）', () => {
  const items = [{ name: 'A', date: '2026-01-01', status: '运行中' }];
  assert.deepEqual(findNewByCounts(items, {}), []);
});

test('findNewByCounts: 条数没变则不报', () => {
  const items = [{ name: 'A', date: '2026-01-01', status: '运行中' }];
  const counts = toCounts(items);
  assert.deepEqual(findNewByCounts(items, counts), []);
});

test('findNewByCounts: 同名同日期但多办了一次 -> 报 1 个（new-count）', () => {
  const one = { name: '宠物领养', date: '2026-10-01', status: '运行中' };
  const baseline = toCounts([one]);           // 之前有 1 条
  const now = [one, { ...one }];              // 现在有 2 条（又办了一次）
  const hits = findNewByCounts(now, baseline);
  assert.equal(hits.length, 1, '多出来的那 1 条应被识别');
  assert.equal(hits[0].reason, 'new-count');
});

test('findNewByCounts: 条数减少不报（项目被下架）', () => {
  const one = { name: 'A', date: '2026-01-01', status: '运行中' };
  const two = { name: 'B', date: '2026-01-02', status: '运行中' };
  const baseline = toCounts([one, two]);
  const hits = findNewByCounts([one], baseline);
  assert.equal(hits.length, 0);
});

test('findNewByCounts: 全新的指纹 -> not-in-baseline', () => {
  const base = toCounts([{ name: 'A', date: '2026-01-01', status: '运行中' }]);
  const hits = findNewByCounts(
    [{ name: 'A', date: '2026-01-01', status: '运行中' },
     { name: 'NEW', date: '2026-05-05', status: '运行中' }],
    base
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'not-in-baseline');
});

test('findNewByCounts: 空输入安全', () => {
  assert.deepEqual(findNewByCounts([], { a: 1 }), []);
  assert.deepEqual(findNewByCounts(null, { a: 1 }), []);
});

test('findNewProjects: 多个新增项目都能识别出来', () => {
  const base = toCounts([{ name: 'X', date: '2026-01-01', status: 's' }]);
  const hits = findNewProjects([
    { name: 'X', date: '2026-01-01', status: 's' },
    { name: 'OLD', date: '2026-02-01', status: 's' },
    { name: 'NEW', date: '2026-12-01', status: 's' },
  ], base);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.item.name).sort(), ['NEW', 'OLD']);
});

// ==================================================== 无效链接识别

test('validateOrgPage: 正常团体页通过', () => {
  assert.equal(validateOrgPage(FIXTURE).ok, true);
});

test('validateOrgPage: 登录页被识别为无效（实测中错误 id 会返回登录页）', () => {
  const r = validateOrgPage(LOGIN_PAGE);
  assert.equal(r.ok, false);
  assert.match(r.reason, /登录页|无效/);
});

test('validateOrgPage: 「团体不存在」页面被识别', () => {
  const r = validateOrgPage('<html><body>志愿团体不存在 <a href="javascript:void(0);">返 回</a></body></html>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /不存在/);
});

test('parseOrgPage: 登录页抛错而不是当成空项目', () => {
  assert.throws(() => parseOrgPage(LOGIN_PAGE), /登录页|无效/);
});

test('parseOrgPage: 完全无关的页面抛错', () => {
  assert.throws(() => parseOrgPage('<html><body>hello</body></html>'), /没有团体信息|无法识别/);
});

// ==================================================== 其它解析细节

test('parseProjects: 空项目列表不崩', () => {
  const html = '<div class="con10" id="con2"><div id="opps"><table class="table1"><tr><th>项目名称</th></tr></table></div></div>';
  assert.deepEqual(parseProjects(html), []);
});

test('parseProjects: 表格结构变化时回退到链接抓取', () => {
  const html = `<div id="con2"><a href="/app/opp/view.php?id=fallback1">只测名称</a>`;
  const items = parseProjects(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '只测名称');
  assert.equal(items[0].url, 'https://gz.zhiyuanyun.com/app/opp/view.php?id=fallback1');
});

test('detectCharset: utf-8 与 gb2312 识别', () => {
  const utf8 = new TextEncoder().encode('<meta charset="utf-8">');
  assert.equal(detectCharset(null, utf8), 'utf-8');
  const gb = new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=gb2312">');
  assert.equal(detectCharset(null, gb), 'gb18030');
  assert.equal(detectCharset('text/html; charset=GBK', utf8), 'gb18030');
});

test('decodeEntities: 常见实体与数字实体', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &nbsp;d'), 'a & b <c>  d');
  assert.equal(decodeEntities('&#26085;&#x671F;'), '日期');
});

test('parseLooseDate: 多种日期格式', () => {
  assert.ok(Number.isFinite(parseLooseDate('2026-10-01')));
  assert.ok(Number.isFinite(parseLooseDate('2026/10/01')));
  assert.ok(Number.isFinite(parseLooseDate('2026年10月1日')));
  assert.ok(Number.isFinite(parseLooseDate('20261001')));
  assert.ok(!Number.isFinite(parseLooseDate('')));
  assert.ok(!Number.isFinite(parseLooseDate('不知道')));
});

// ==================================================== 通知文案

test('buildNotificationText: 单个新项目', () => {
  const t = buildNotificationText('都匀三中青年志愿者服务队', [{
    name: '宠物领养志愿服务', date: '2026-10-01', status: '运行中',
  }]);
  assert.match(t.title, /新志愿项目：宠物领养志愿服务/);
  assert.match(t.body, /都匀三中青年志愿者服务队/);
  assert.match(t.body, /2026-10-01/);
});

test('buildNotificationText: 多个新项目', () => {
  const t = buildNotificationText('某服务队', [
    { name: 'A', date: '2026-01-01', status: 's' },
    { name: 'B', date: '2026-01-02', status: 's' },
  ]);
  assert.match(t.title, /有 2 个新项目/);
  assert.match(t.body, /A、B/);
});

test('buildNotificationText: 超过 3 个时折叠', () => {
  const items = [1, 2, 3, 4, 5].map((i) => ({ name: '项目' + i, date: '2026-01-01', status: 's' }));
  const t = buildNotificationText('某队', items);
  assert.match(t.title, /有 5 个新项目/);
  assert.match(t.body, /等 5 个/);
});

// ==================================================== 端到端

test('端到端：真实页面建立基线后，模拟新增一个项目能正确识别', () => {
  const snap = parseOrgPage(FIXTURE, { host: 'gz.zhiyuanyun.com' });
  const baseline = snap.counts;

  const extra = {
    name: '20261020新项目测试', date: '2026-10-20', status: '运行中',
    fingerprint: fingerprintOf({ name: '20261020新项目测试', date: '2026-10-20', status: '运行中' }),
  };
  const out = findNewProjects([extra, ...snap.projects], baseline);
  assert.equal(out.length, 1);
  assert.match(buildNotificationText(snap.orgName, out.map((o) => o.item)).title, /新项目测试/);
});

test('端到端：项目全部 id 变化后重复抓取，不会误报', () => {
  const snap = parseOrgPage(FIXTURE, { host: 'gz.zhiyuanyun.com' });
  const shuffledIds = snap.projects.map((p, i) => ({ ...p, id: 'CHANGED' + i }));
  assert.deepEqual(findNewProjects(shuffledIds, snap.counts), []);
});
