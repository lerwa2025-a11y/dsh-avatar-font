/**
 * 回归验证 2026-10-25 的 bug：正文字色不生效。
 *
 * 根因：宿主的正文根容器（.v5IAXa_root）自己写了
 *   color: var(--dsw-alias-label-primary)
 * 这是一个「显式声明」，会截断继承 —— 只把 color 设在直接子元素上完全没用。
 * 正确做法是把颜色下发到**整棵子树**，并且在源头用 :not() 排除不该碰的节点。
 *
 * ⚠️ v2.0：本文件原来还验证「宽表格必须回到气泡内」。
 *    气泡框功能已按用户要求整体移除，那些约束随气泡一起删了，
 *    所以这一节连同 .cav-bubbled 相关断言全部删除。
 *
 * 用法：node 验证_字色下发.mjs
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

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 字色要下发到整棵子树（穿透宿主写死的 color）');
{
  const wildcardRule = decls.match(
    /body \[data-chat-flow-kind="assistant-step"\]\s*\*:not\(([\s\S]*?)\)\s*\{([^}]*)\}/,
  );
  check('存在「行内所有后代」的字色规则', Boolean(wildcardRule), '没找到 * :not(...) 规则');
  check('该规则设置了 --cav-text-color', wildcardRule ? wildcardRule[2].includes('--cav-text-color') : false);

  // 排除清单必须覆盖会导致误伤的类别
  const excludeList = wildcardRule ? wildcardRule[1] : '';
  check('排除 pre 及其后代', /pre, pre \*/.test(excludeList));
  check('排除 code 及其后代（shiki token）', /code, code \*/.test(excludeList));
  check('排除思考区', excludeList.includes('[data-chat-group-part="reasoning"]'));
  check('排除工具调用', excludeList.includes('[data-chat-flow-kind="turn-process"]'));
  check('排除工具卡片', excludeList.includes('[data-chat-call-id]'));
  check('排除头像自身', excludeList.includes('.cav-avatar'));
  check('排除头像后代（svg 会被染色）', /\.cav-avatar \*/.test(excludeList));
}

console.log('\n[2] 行本身也覆盖一次（裸文本没有元素包裹）');
{
  check('有 body [data-chat-flow-kind="assistant-step"] 的行级规则',
    /body \[data-chat-flow-kind="assistant-step"\]\s*\{[^}]*--cav-text-color/.test(decls));
  check('行级规则只设 color（不碰布局）',
    !/body \[data-chat-flow-kind="assistant-step"\]\s*\{[^}]*(width|display|flex|overflow)\s*:/.test(decls));
}

console.log('\n[3] 不再残留会造成特异性冲突的「事后复原」规则');
{
  // 2026-10-25 之前的写法是改完再复原，会与 :not 版本打架
  check('没有旧的「代码复原」规则',
    !/:where\(pre, code, kbd, samp\)\s*\{[\s\S]{0,120}?--dsw-alias-label-primary/.test(decls));
  check('没有旧的「思考区复原」规则',
    !/:where\(\s*\[data-chat-group-part="reasoning"\][\s\S]{0,300}?\}[\s\S]{0,80}?--dsw-alias-label-primary/.test(decls));
}

console.log('\n[4] 字色与头像层解耦（v2.0）');
{
  /*
   * 字色归「字体」开关管，头像归「头像」开关管。
   * 若字色规则还挂在 [data-cav-row]（本插件自己打的标记）或 body[data-cav-on]
   * 上，那么关掉头像后字色就跟着失效了 —— 这正是必须解耦的原因。
   */
  const colorRules = [...decls.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /--cav-(user-)?text-color/.test(m[2]));
  check('有字色规则', colorRules.length > 0, String(colorRules.length));
  check('字色规则不依赖 [data-cav-row]',
    colorRules.every((m) => !m[1].includes('data-cav-row')),
    colorRules.map((m) => m[1].trim().replace(/\s+/g, ' ')).join(' | '));
  check('字色规则不依赖 body[data-cav-on]',
    colorRules.every((m) => !m[1].includes('data-cav-on')),
    colorRules.map((m) => m[1].trim().replace(/\s+/g, ' ')).join(' | '));
  check('字色规则用的是宿主原生 data-chat-flow-kind',
    colorRules.every((m) => m[1].includes('data-chat-flow-kind')));
}

console.log('\n[5] 服务端 textColor 仍完整');
{
  const host = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8');
  check('默认值有 textColor', /textColor:\s*''/.test(host));
  check('净化逻辑有 textColor', /textColor:[^\n]*hexOrEmpty/.test(host));
  check('客户端取值有 textColorOf', src.includes('textColorOf'));
  check('写入 DOM 变量', src.includes("applyColorVar(b, '--cav-text-color'"));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
