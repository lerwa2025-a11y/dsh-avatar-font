/**
 * 验证「正文字色」功能。
 *   ① 只作用于 AI 侧的行，用户消息不变
 *   ② 代码 / 思考区 / 工具调用一律不参与变字色
 *   ③ 留空 = 跟随主题（变量不存在时那条 color 规则不生效）
 *   ④ v2.0：字色归「字体」开关管，关掉头像后仍然生效
 *
 * 用法：node 验证_正文字色.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const HOST = join(here, '..', 'lib', 'index.js');

const src = readFileSync(CLIENT, 'utf8');
const host = readFileSync(HOST, 'utf8');

function stylesBlock(text) {
  const start = text.indexOf('const STYLES = `');
  const from = text.indexOf('`', start) + 1;
  const end = text.indexOf('\n`;', from);
  return text.slice(from, end)
    .replace(/\$\{AVATAR_NODE_CLASS\}/g, 'cav-avatar')
    .replace(/\$\{AVATAR_ATTR\}/g, 'data-cav-on')
    .replace(/\$\{AVATAR_ROW_ATTR\}/g, 'data-cav-row')
    .replace(/\$\{VAR_SIZE\}/g, '--cav-size')
    .replace(/\$\{VAR_ROUND\}/g, '--cav-round');
}
const css = stylesBlock(src);
// 剥掉注释做声明级判断，避免注释里的示例被误匹配
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 只管 AI 回复，用户消息不动');
{
  const mainRule = decls.match(/body \[data-chat-flow-kind="assistant-step"\][^{]*\{([^}]*)\}/);
  check('变字色的规则限定 assistant-step', Boolean(mainRule), '没找到限定 ai 的规则');
  check('规则里用了 --cav-text-color', mainRule ? mainRule[1].includes('--cav-text-color') : false);
  /*
   * 「不误伤用户消息」要按**颜色声明 + 变量**判断，不能只看选择器：
   *  · `[data-cav-row] > :not(.cav-avatar)` 是布局规则（flex/min-width），无害；
   *  · 用户侧**故意**也有颜色规则，但它用的是 --cav-user-text-color，
   *    和 AI 侧的 --cav-text-color 是两个独立变量，不会串色。
   * 所以判据是：凡是用了 --cav-text-color（AI 变量）的规则，必须限定 ai。
   */
  const allColorRules = [...decls.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /(^|[\s;])color\s*:/.test(m[2]));
  const aiVarRules = allColorRules.filter(
    (m) => m[2].includes('--cav-text-color') && !m[2].includes('--cav-user-text-color'),
  );
  const badColorRule = aiVarRules.filter((m) => !/assistant-step/.test(m[1]));
  check(
    '所有使用 AI 字色变量的规则都限定了 assistant-step',
    badColorRule.length === 0,
    badColorRule.map((m) => m[1].trim().replace(/\s+/g, ' ')).join(' | '),
  );
  check('确实存在限定 ai 的颜色规则', aiVarRules.length > 0);
  // 用户侧的颜色规则用独立变量，不会串色
  const userVarRules = allColorRules.filter((m) => m[2].includes('--cav-user-text-color'));
  check('用户侧颜色规则用的是独立变量 --cav-user-text-color',
    userVarRules.length > 0
    && userVarRules.every((m) => /data-chat-flow-kind="(user|steering)"/.test(m[1])),
    userVarRules.map((m) => m[1].trim().replace(/\s+/g, ' ')).join(' | '));
  // 与 JS 侧判定保持一致
  check('assistant-step 在 AVATAR_FLOW_SIDES 里映射为 ai',
    /'assistant-step':\s*'ai'/.test(src));
}

console.log('\n[2] 代码块不参与变字色');
{
  /*
   * 2026-10-25 改法：不再「改完再复原」，而是在 :not() 里从源头排除。
   * 所以这里断言的是排除清单，不是复原规则（旧断言已随实现更新）。
   */
  const wildcard = decls.match(/\[data-chat-flow-kind="assistant-step"\]\s*\*:not\(([\s\S]*?)\)\s*\{/);
  const excludeList = wildcard ? wildcard[1] : '';
  check('找到了后代通配规则', Boolean(wildcard), '没找到 *:not(...)');
  check('排除清单里有 pre 及其后代', /pre, pre \*/.test(excludeList), excludeList.slice(0, 200));
  check('排除清单里有 code 及其后代', /code, code \*/.test(excludeList));
  check('还排除 kbd / samp', /kbd, samp/.test(excludeList));
  check('没有残留的「代码复原」规则（会造成特异性冲突）',
    !/:where\(pre, code, kbd, samp\)\s*\{[\s\S]{0,120}?--dsw-alias-label-primary/.test(decls));
}

console.log('\n[3] 思考区与工具调用不参与');
{
  check('排除 data-chat-group-part="reasoning"', decls.includes('[data-chat-group-part="reasoning"]'));
  check('排除 reasoning 的整棵子树（带 *）', decls.includes('[data-chat-group-part="reasoning"] *'));
  check('排除 data-chat-flow-kind="turn-process"', decls.includes('[data-chat-flow-kind="turn-process"]'));
  check('排除工具卡片 data-chat-call-id', decls.includes('[data-chat-call-id]'));
  // 与 isProcessRow 的判定保持一致
  check('isProcessRow 用的也是 reasoning 标记',
    /function isProcessRow[\s\S]{0,200}'reasoning'/.test(src));
}

console.log('\n[4] 留空 = 跟随主题');
{
  check('CSS 用 var(--cav-text-color, inherit) 回落', /var\(--cav-text-color,\s*inherit\)/.test(decls));
  check('空串在服务端被净化为空串（不是非法值）', /textColor:[^\n]*hexOrEmpty/.test(host));
  check('空串时 JS 移除变量（不是写空值）',
    src.includes("applyColorVar(b, '--cav-text-color', settings.textColor)"));
  check('applyColorVar 对空值走 removeProperty',
    /if \(hex\) el\.style\.setProperty\(name, hex\);\s*\n\s*else el\.style\.removeProperty\(name\)/.test(src));
}

console.log('\n[5] 设置项端到端');
{
  check('服务端默认值 textColor: \'\'', /textColor:\s*''/.test(host));
  check('客户端默认值 textColor: \'\'', /textColor:\s*''/.test(src));
  check('客户端净化 textColor', /textColor:[^\n]*hexOf/.test(src));
  check('有 textColorOf()', src.includes('textColorOf'));
  check('面板有颜色选择器（type: color）', /type: 'color', className: 'cav-color'/.test(src));
  check('面板有「跟随主题」按钮', src.includes("saveSettings({ textColor: '' })"));
}

console.log('\n[6] 字色归「字体」开关管（v2.0）');
{
  /*
   * 关掉「字体」必须连字色变量一起撤掉，否则会出现
   * 「面板显示字体已关闭，但正文还是自定义颜色」的矛盾状态。
   */
  check('字体分支写入 --cav-text-color', /fOn[\s\S]{0,600}--cav-text-color/.test(src));
  check('字体关闭时移除 --cav-text-color',
    /else \{[\s\S]{0,300}removeProperty\('--cav-text-color'\)/.test(src));
  /*
   * 反向：关掉「头像」不能撤掉字色变量 —— 头像层只清理自己的尺寸变量。
   */
  check('stopLayer 不撤字色变量',
    !/function stopLayer[\s\S]{0,1200}removeProperty\('--cav-text-color'\)/.test(src));
}

console.log('\n[7] 不破坏已有功能');
{
  check('头像变量仍在', src.includes('VAR_SIZE') && src.includes('VAR_ROUND'));
  check('气泡框已彻底移除', !src.includes('BUBBLE_CLASS'));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
