/**
 * 团体搜索解析测试
 * 用真实抓取的搜索页做样本（tests/fixtures/search_list.html）
 * 来源：https://gz.zhiyuanyun.com/app/org/list.php?name=都匀三中
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseOrgList, searchUrl, searchOrgs, resolveStableOrgId,
} from '../src/core/search.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'search_list.html'), 'utf8');

/* ------------------------------------------------------------ 拼接地址 */

test('searchUrl: 第一页不带 p 参数', () => {
  const u = searchUrl('gz.zhiyuanyun.com', '都匀三中');
  assert.match(u, /^https:\/\/gz\.zhiyuanyun\.com\/app\/org\/list\.php\?name=/);
  assert.ok(!u.includes('&p='));
});

test('searchUrl: 第二页带 p=2', () => {
  const u = searchUrl('gz.zhiyuanyun.com', '测试', 2);
  assert.match(u, /[?&]p=2/);
});

test('searchUrl: 关键词做了 URL 编码', () => {
  const u = searchUrl('gz.zhiyuanyun.com', '都匀 三中');
  assert.ok(!u.includes(' '), '空格必须被编码');
  assert.ok(u.includes('%E9%83%BD%E5%8C%80'), '中文应被编码');
});

/* ------------------------------------------------------------ 解析样本 */

test('parseOrgList: 从真实搜索页解析出结果', () => {
  const r = parseOrgList(FIXTURE, 'gz.zhiyuanyun.com');
  assert.ok(r.items.length >= 2, `至少 2 条，实际 ${r.items.length}`);
  // 每条都要有 id 和名称
  for (const it of r.items) {
    assert.ok(it.linkId, 'linkId 不能为空');
    assert.ok(it.name, 'name 不能为空');
    assert.match(it.url, /^https:\/\/gz\.zhiyuanyun\.com\/app\/org\/view\.php\?id=/);
  }
});

test('parseOrgList: 能找到目标团体', () => {
  const r = parseOrgList(FIXTURE, 'gz.zhiyuanyun.com');
  const target = r.items.find((i) => i.name.includes('都匀三中青年志愿者服务队'));
  assert.ok(target, `结果里应包含目标团体，实际：${r.items.map((i) => i.name).join(' | ')}`);
});

test('parseOrgList: 读取到总数与页数', () => {
  const r = parseOrgList(FIXTURE, 'gz.zhiyuanyun.com');
  assert.equal(typeof r.total, 'number');
  assert.ok(r.total >= 1);
  assert.equal(typeof r.totalPages, 'number');
});

test('parseOrgList: 结果里不重复', () => {
  const r = parseOrgList(FIXTURE, 'gz.zhiyuanyun.com');
  const ids = r.items.map((i) => i.linkId);
  assert.equal(new Set(ids).size, ids.length);
});

test('parseOrgList: 空页面不崩', () => {
  const r = parseOrgList('<html><body>没有结果</body></html>');
  assert.deepEqual(r.items, []);
});

test('parseOrgList: 无结果页返回空数组', () => {
  const html = '<ul class="list1 clearfix"></ul><div class="pagebar"> 1 页 / 0 记录</div>';
  const r = parseOrgList(html);
  assert.deepEqual(r.items, []);
  assert.equal(r.total, 0);
});

test('parseOrgList: 人数能解析出来', () => {
  const html = `<ul class="list1">
    <li class="clearfix">
      <div class="listtxt">
        <p class="ptitle"><a href="/app/org/view.php?id=ABC123" title="某服务队">某服务队</a></p>
        <p class="prens"><span class="l">团体人数：123</span></p>
      </div>
    </li></ul>`;
  const r = parseOrgList(html);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, '某服务队');
  assert.equal(r.items[0].members, 123);
});

/* ------------------------------------------------------------ 联网测试 */

async function online() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch('https://gz.zhiyuanyun.com/app/org/list.php', { signal: ac.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
const isOnline = await online();
const skip = isOnline ? false : '网络不可用，跳过';

test('真实搜索：能搜到目标团体', { skip }, async () => {
  const r = await searchOrgs('gz.zhiyuanyun.com', '都匀三中');
  console.log(`   找到 ${r.items.length} 条，总数 ${r.total}`);
  r.items.slice(0, 4).forEach((i) => console.log(`     ${i.name}  (${i.linkId})`));
  assert.ok(r.items.length > 0);
});

test('真实搜索：能把链接 id 解析成稳定的数字团号', { skip }, async () => {
  const r = await searchOrgs('gz.zhiyuanyun.com', '都匀三中');
  const target = r.items.find((i) => i.name.includes('都匀三中青年志愿者服务队'));
  assert.ok(target, '应搜到目标团体');

  const stable = await resolveStableOrgId('gz.zhiyuanyun.com', target.linkId);
  console.log(`   linkId=${target.linkId} -> stableId=${stable.stableId}`);
  console.log(`   稳定链接: ${stable.url}`);

  assert.ok(stable.stableId, '应该能解析出数字团号');
  assert.match(stable.stableId, /^\d+$/, '数字团号应全为数字');

  // 关键：用数字团号拼出的链接要真的能打开同一个团体
  const res = await fetch(stable.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
  });
  const html = await res.text();
  assert.match(html, /都匀三中青年志愿者服务队/, '稳定链接应能打开同一团体');
});

test('真实搜索：不存在的关键词返回空结果', { skip }, async () => {
  const r = await searchOrgs('gz.zhiyuanyun.com', 'zzz不存在的团体名字zzz');
  assert.equal(r.items.length, 0);
});

test('真实搜索：空关键词报错', { skip }, async () => {
  await assert.rejects(() => searchOrgs('gz.zhiyuanyun.com', '   '), /请输入/);
});
