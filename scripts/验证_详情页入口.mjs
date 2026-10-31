/**
 * 验证设置卡片确实挂到了「插件详情页」，而不是「设置」页独立一节；
 * 并守住 v2.0 的面板结构：头像 / 字体两个分组，各带独立开关，没有总开关。
 *
 * 用法：node 验证_详情页入口.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, '..', 'lib', 'client.js');
const PKG = join(here, '..', 'package.json');

const src = readFileSync(PLUGIN, 'utf8');
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

/** 取出一段代码的实际内容（去注释），用于区分「真的注册了」和「只在注释里提到」。 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = codeOnly(src);

console.log('\n[1] 注册到了插件详情页槽位');
{
  check("有 ctx.slots.inject('plugins.bundle.config')", code.includes("ctx.slots.inject('plugins.bundle.config'"));
  check('name 是 plugins.bundle.config', /name:\s*'plugins\.bundle\.config'/.test(code));
  const keyMatch = code.match(/plugins\.bundle\.config[\s\S]{0,300}?key:\s*'([^']+)'/);
  check('声明了 key', Boolean(keyMatch), '没找到 key 字段');
  check('key 等于包名（详情页靠它认领，必须一致）',
    keyMatch && keyMatch[1] === pkg.name,
    `key=${keyMatch?.[1]} 包名=${pkg.name}`);
}

console.log('\n[2] 不再注册到设置页');
{
  check('代码里没有 settings.section 注册', !code.includes("ctx.slots.inject('settings.section'"));
  check('代码里没有 name: settings.section', !/name:\s*'settings\.section'/.test(code));
}

console.log('\n[3] 面板结构：两个分组 + 两个独立开关');
{
  check('AvatarPanel 仍存在', src.includes('function AvatarPanel'));

  // 头像分组
  check('有「头像」开关行', /label: '头像',/.test(src));
  check('头像开关写回 plugin.avatar',
    src.includes('saveSettings({ plugin: { ...st.plugin, avatar: v } })'));

  // 字体分组
  check('有「字体」开关行', /label: '字体',/.test(src));
  check('字体开关写回 plugin.font',
    src.includes('saveSettings({ plugin: { ...st.plugin, font: v } })'));

  // 各自的控件
  check('头像大小滑杆在', src.includes('avatarSize'));
  check('圆角强度在', src.includes('avatarRadius'));
  check('吸顶下移在', src.includes('stickOffset'));
  check('界面字体在', src.includes('fontFamily'));
  check('正文字色在', src.includes('textColor'));
  check('我的消息字色在', src.includes('userTextColor'));

  // 两个头像卡片
  check('两个头像卡片都在（AI / 我的）',
    src.includes("side: 'ai'") && src.includes("side: 'user'"));
}

console.log('\n[4] 总开关已去掉，气泡框控件已去掉');
{
  /*
   * 用户原话：「去掉启停插件的选项，插件启停本来就包含在插件管理中，这一步多余。」
   * 以及「把气泡框功能去掉」。
   */
  check('没有「启用插件」这一行', !src.includes("label: '启用插件'"));
  check('代码里没有 plugin.enabled 判断', !/plugin\.enabled/.test(code));
  check('没有气泡框开关', !src.includes('aiBubble'));
  check('没有气泡背景色', !src.includes('bubbleBg'));
  check('没有气泡边框色', !src.includes('bubbleBorder'));
  check('没有气泡圆角', !src.includes('bubbleRadius'));
  check('没有气泡不透明度', !src.includes('bubbleAlpha'));
  check('没有气泡磨砂', !src.includes('bubbleBlur'));
}

console.log('\n[5] 开关关掉时对应控件整组隐藏');
{
  /*
   * 「可以单独启停其中一种」在界面上的体现：关掉头像，头像那一组控件就不显示
   * （不显示调了也不会生效的东西）；字体同理。
   * 断言 aOn / fOn 两个局部变量确实被用于条件渲染。
   */
  check('面板里取了 avatarOn()', src.includes('const aOn = avatarOn()'));
  check('面板里取了 fontOn()', src.includes('const fOn = fontOn()'));
  check('头像控件按 aOn 条件渲染', /aOn \? react\.createElement/.test(src));
  check('字体控件按 fOn 条件渲染', /fOn \? react\.createElement/.test(src));
  check('头像开关本身不隐藏（否则关了就再也开不回来）',
    !/aOn \? react\.createElement\(Row, \{ label: '头像'/.test(src));
  check('字体开关本身不隐藏',
    !/fOn \? react\.createElement\(Row, \{ label: '字体'/.test(src));
}

console.log('\n[6] 设置读写不依赖挂载位置（搬走后仍然工作）');
{
  check('组件通过 useSettings 自取数据', src.includes('useSettings'));
  check('仍有 saveSettings', src.includes('saveSettings'));
  /*
   * 数据路由是 `const API = '/dsh-avatar-font'` 加 `fetchJson('/settings')`
   * 拼出来的，不是一整串字面量，所以分开断言。
   */
  const hasApiBase = /const API = '\/dsh-avatar-font'/.test(src);
  const hasSettingsPath = src.includes("fetchJson('/settings'") || src.includes("'/settings'");
  check('API 前缀仍是自己的包名', hasApiBase);
  check('仍走 /settings 读写', hasSettingsPath);
  check('包名已是 dsh-avatar-font', pkg.name === 'dsh-avatar-font', pkg.name);
}

console.log('\n[7] 不写不存在的 locale 命名空间');
{
  const block = code.slice(
    code.indexOf("ctx.slots.inject('plugins.bundle.config'"),
    code.indexOf("ctx.slots.inject('plugins.bundle.config'") + 400,
  );
  check('注册块内没有 locale 字段', !/locale:/.test(block), block);
}

console.log('\n[8] 版本号已升到 2.x');
{
  /*
   * 断言「不低于 2.0.0」而不是写死具体版本：
   * 写死会让每次升版本都误报，而这条测试关心的是
   * 「已经做过这次功能删除的版本跃迁」，不是某个精确值。
   */
  const [major] = pkg.version.split('.').map(Number);
  check('版本不低于 2.0.0', major >= 2, pkg.version);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
