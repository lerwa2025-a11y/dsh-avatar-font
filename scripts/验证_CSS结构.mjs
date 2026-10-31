/**
 * CSS 结构自检（v2.0：气泡框已整体移除，这里只校验剩下的头像层 + 字色层）。
 *
 * 不连浏览器：用 Node 里做「括号/引号配平 + 关键声明存在 + 规则清单」的结构检查。
 *
 * 用法：node 验证_CSS结构.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

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
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

function parseRules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() });
  }
  return out;
}
const rules = parseRules(decls);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[A] 结构配平');
{
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  check(`花括号配平（{ ${open} / } ${close}）`, open === close);
  const parenOpen = (css.match(/\(/g) ?? []).length;
  const parenClose = (css.match(/\)/g) ?? []).length;
  check(`圆括号配平（( ${parenOpen} / ) ${parenClose}）`, parenOpen === parenClose);
  check('没有未闭合的注释', (css.match(/\/\*/g) ?? []).length === (css.match(/\*\//g) ?? []).length);
  check('没有残留的模板占位符（${...}）', !css.includes('${'));
}

console.log('\n[B] 规则清单');
{
  console.log(`  共 ${rules.length} 条规则`);
  for (const r of rules) console.log(`  · ${r.sel}`);
  // 41 条：8 头像 + 4 字色 + 29 面板控件。只做粗筛，不是精确断言。
  check('规则数量在预期范围内（35–50 条）', rules.length >= 35 && rules.length <= 50, String(rules.length));
  check('没有空选择器的规则', rules.every((r) => r.sel.length > 0));
  check('没有空规则体', rules.every((r) => r.body.length > 0));
}

console.log('\n[C] 气泡框已彻底移除');
{
  /*
   * v2.0 用户明确要求「去掉气泡框功能，就要最干净」。
   * 连带着为气泡服务的超宽内容约束（md-table-wide 归位、子元素限宽、
   * 会滚的块、媒体限宽、长词断行）也一并删掉 —— 它们全部挂在 .cav-bubbled 下，
   * 气泡没了就是死代码。这条断言防止以后有人「顺手」把它们加回来。
   */
  check('没有 .cav-bubbled 规则', !decls.includes('cav-bubbled'));
  check('没有 --cav-bubble-* 变量', !decls.includes('--cav-bubble'));
  check('没有 backdrop-filter（磨砂随气泡一起删了）', !decls.includes('backdrop-filter'));
  check('没有 md-table-wide 归位规则', !decls.includes('md-table-wide'));
  check('没有 overflow-wrap: anywhere', !decls.includes('overflow-wrap'));
  check('没有 isolation: isolate', !decls.includes('isolation'));
  check('源码里没有 BUBBLE_CLASS 常量', !src.includes('BUBBLE_CLASS'));
  check('源码里没有 syncBubbles', !src.includes('syncBubbles'));
}

console.log('\n[D] 头像层规则齐全');
{
  const rowRule = rules.find((r) => r.sel === 'body[data-cav-on="on"] [data-cav-row]');
  check('行改成 flex', Boolean(rowRule) && /display:\s*flex/.test(rowRule.body));
  check('行内间距 8px', Boolean(rowRule) && /gap:\s*8px/.test(rowRule.body));

  const userRow = rules.find((r) => r.sel === 'body[data-cav-on="on"] [data-cav-row="user"]');
  check('用户行反向（消息在右）', Boolean(userRow) && /row-reverse/.test(userRow.body));

  const avatar = rules.find((r) => r.sel === '.cav-avatar');
  check('头像本体规则在', Boolean(avatar));
  check('头像宽高都走 var(--cav-size)', Boolean(avatar)
    && /width:\s*var\(--cav-size/.test(avatar.body)
    && /height:\s*var\(--cav-size/.test(avatar.body));
  check('头像用 position: relative（跟随滚动要写 style.top）',
    Boolean(avatar) && /position:\s*relative/.test(avatar.body));
}

console.log('\n[E] 字色层规则齐全');
{
  const aiRule = rules.find((r) => r.sel.includes('data-chat-flow-kind="assistant-step"') && r.sel.includes('*:not('));
  check('AI 侧有后代通配字色规则', Boolean(aiRule));
  check('AI 侧用 --cav-text-color', Boolean(aiRule) && aiRule.body.includes('--cav-text-color'));

  const userRule = rules.find((r) => r.sel.includes('data-chat-flow-kind="user"') && r.sel.includes('*:not('));
  check('用户侧有后代通配字色规则', Boolean(userRule));
  check('用户侧用 --cav-user-text-color', Boolean(userRule) && userRule.body.includes('--cav-user-text-color'));

  // 字色必须与头像层解耦：不能依赖本插件自己打的 data-cav-row 标记
  check('字色规则不依赖 data-cav-row（关头像后仍生效）',
    [aiRule, userRule].every((r) => Boolean(r) && !r.sel.includes('data-cav-row')));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
