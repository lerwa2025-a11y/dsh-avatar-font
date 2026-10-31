/**
 * 集成验证：真的把 client.js 跑起来，用最小假 DOM 驱动 apply()，
 * 断言「头像」和「字体」两个开关**各管各的**（这是 v2.0 的核心需求）。
 *
 * 为什么要有这个：其他脚本都是静态读源码做正则断言 —— 它们能证明
 * 「代码里写了这个分支」，但证明不了「跑起来真的分开生效」。
 * 这里补上那一段：给一份 settings，实际执行一遍，看 DOM 变成什么样。
 *
 * 用法：node 验证_双开关隔离.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const SRC = readFileSync(CLIENT, 'utf8');

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

// ── 最小假 DOM ────────────────────────────────────────────────────────────────
function makeDom() {
  const ALL = [];

  class El {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attrs = Object.create(null);
      this.className = '';
      this.id = '';
      this.textContent = '';
      this.innerHTML = '';
      this.dataset = {};
      this.style = {
        _p: Object.create(null),
        setProperty(k, v) { this._p[k] = String(v); },
        removeProperty(k) { delete this._p[k]; },
        getPropertyValue(k) { return this._p[k] ?? ''; },
      };
      this.classList = {
        _el: this,
        add(...cs) { const s = new Set(this._el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); this._el.className = [...s].join(' '); },
        remove(...cs) { const s = new Set(this._el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.delete(c)); this._el.className = [...s].join(' '); },
        contains(c) { return this._el.className.split(/\s+/).filter(Boolean).includes(c); },
      };
      ALL.push(this);
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'id') this.id = ''; }
    hasAttribute(k) { return k in this.attrs; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get firstElementChild() { return this.children[0] ?? null; }
    get firstChild() { return this.children[0] ?? null; }
    /** findScroller 用的是 parentElement，必须提供（否则它永远走不到祖先）。 */
    get parentElement() { return this.parentNode; }
    get offsetHeight() { return 40; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 40, bottom: 40, right: 100 }; }
    matches(sel) { return matchesSel(this, sel); }
    closest(sel) {
      let n = this;
      while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; }
      return null;
    }
    querySelectorAll(sel) { return findAll(this, sel); }
    querySelector(sel) { return findAll(this, sel)[0] ?? null; }
    addEventListener() {}
    removeEventListener() {}
  }

  /*
   * 只支持本插件真正用到的那几种选择器形态：
   *   [attr]            [attr="value"]        #id
   *   tag               逗号分隔的并列
   * 别的返回空集 —— 测试只关心「注入的节点有没有被摘干净」，
   * 不需要一个完整的 CSS 引擎。
   */
  function parseSimple(sel) {
    const s = sel.trim();
    const m = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (m) return { kind: 'attr', name: m[1], value: m[2] };
    if (s.startsWith('#')) return { kind: 'id', value: s.slice(1) };
    if (/^[a-zA-Z][\w-]*$/.test(s)) return { kind: 'tag', value: s.toLowerCase() };
    return { kind: 'unsupported', value: s };
  }

  function matchesSel(el, sel) {
    for (const part of sel.split(',')) {
      const p = parseSimple(part);
      if (p.kind === 'attr') {
        if (!(p.name in el.attrs)) continue;
        if (p.value === undefined || el.attrs[p.name] === p.value) return true;
      } else if (p.kind === 'id') {
        if (el.id === p.value) return true;
      } else if (p.kind === 'tag') {
        if (el.tagName === p.value.toUpperCase()) return true;
      }
    }
    return false;
  }

  function walk(root, out) {
    for (const c of root.children) { out.push(c); walk(c, out); }
    return out;
  }

  function findAll(root, sel) {
    return walk(root, []).filter((el) => matchesSel(el, sel));
  }

  const body = new El('body');
  const head = new El('head');
  const document = {
    head, body,
    createElement: (t) => new El(t),
    getElementById: (id) => walk({ children: [head, body] }, []).find((e) => e.id === id) ?? null,
    querySelectorAll: (sel) => findAll({ children: [head, body] }, sel),
    querySelector: (sel) => findAll({ children: [head, body] }, sel)[0] ?? null,
    documentElement: new El('html'),
    addEventListener() {},
    removeEventListener() {},
  };

  return { El, document, body, head, ALL };
}

// ── 启动一份「页面」────────────────────────────────────────────────────────────
/**
 * 用给定的 settings 跑一遍 client.js 的 apply()，返回跑完之后的 DOM。
 * 每次都重新求值源码 ⇒ 模块级状态（settings / active / observer）都是全新的，
 * 等价于「用户改完设置后刷新页面」。
 */
async function boot(settings) {
  const dom = makeDom();
  const { document, body } = dom;

  // 让宿主看起来有内容：几条消息行
  for (const kind of ['user', 'assistant-step', 'turn-process']) {
    const row = new dom.El('div');
    row.setAttribute('data-chat-flow-kind', kind);
    const content = new dom.El('div');
    content.className = '_markdown_x';
    row.appendChild(content);
    body.appendChild(row);
  }

  const listeners = [];
  const win = {
    document,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { listeners.push(fn); return listeners.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ overflowY: 'visible' }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    location: { href: 'http://127.0.0.1:59214/' },
    fetch: () => Promise.resolve({
      json: () => Promise.resolve({ ok: true, settings, available: { user: true, ai: true } }),
    }),
    Image: class {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
  win.window = win;
  globalThis.window = win;

  let captured = null;
  const load = (o) => { captured = o; };
  /*
   * ⚠️ 必须把 __ModuleLoader__ 挂在 win 上、并把 **win 本身** 作为参数传进去。
   * 第一版错在传了一个只有 __ModuleLoader__ 的假对象，于是源码里
   * `window.addEventListener(...)` 拿到 undefined —— 因为 `window` 这个名字
   * 在 factory 闭包里指的是那个参数，不是 globalThis.window。
   */
  win.__ModuleLoader__ = { load };
  const fakeWindow = win;
  /*
   * 源码里用的是 `window.__ModuleLoader__.load`，但 factory 内部又直接用
   * document / fetch / MutationObserver 这些**裸全局名**（浏览器里它们本来就在
   * window 上，所以源码不写 window. 前缀）。Node 里没有这层映射，
   * 所以要把它们临时挂到 globalThis 上 —— 而且**必须一直挂到 apply() 跑完**。
   */
  const GLOBALS = ['document', 'fetch', 'MutationObserver', 'requestAnimationFrame',
    'cancelAnimationFrame', 'getComputedStyle', 'Image', 'URL', 'location',
    'setTimeout', 'clearTimeout'];
  const savedGlobals = {};
  for (const k of GLOBALS) {
    savedGlobals[k] = globalThis[k];
    if (k in win) globalThis[k] = win[k];
  }
  globalThis.window = win;

  try {
    // eslint-disable-next-line no-new-func
    new Function('window', SRC)(fakeWindow);

    /*
     * 假 React：createElement 只把 {type, props} 记下来，不渲染。
     * 这样就能拿到面板组件的**真实 props**（包括 Toggle 的 onChange），
     * 从外部触发「用户拨开关」这条真实路径，而不是给生产代码加测试钩子。
     */
    const fakeReact = {
      createElement: (type, props, ...kids) => ({
        type,
        props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids },
      }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
    };
    const mod = captured.factory((n) => {
      if (n === 'react') return fakeReact;
      throw new Error('unexpected require: ' + n);
    });

    const effects = [];
    let Panel = null;
    const ctx = {
      effect: (fn) => { effects.push(fn); },
      slots: {
        /*
         * ⚠️ inject 的第二个参数是个**惰性回调**，宿主在需要渲染时才调用它；
         * register 就在那个回调里。所以假 inject 必须真的把回调执行一次，
         * 否则 register 永远不会被调用，Panel 一直是 null
         * （第一版就是这里错的：inject 写成空函数）。
         */
        inject: (_name, fn) => { if (typeof fn === 'function') fn(); },
        register: (_descriptor, component) => { Panel = component; return {}; },
      },
    };
    mod.apply(ctx);
    // 等 fetch → applyResponse → notify → layerSync 这条链跑完
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // 跑一次 rAF 队列（头像吸顶计算）
    const flushRaf = () => { for (const fn of listeners.splice(0)) { try { fn(0); } catch { /* ignore */ } } };
    flushRaf();

    /** 在面板返回的元素树里按 label 找一个 Row，返回它包着的那个控件元素。 */
    function findControl(tree, label) {
      const seen = new Set();
      const stack = [tree];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object' || seen.has(n)) continue;
        seen.add(n);
        const p = n.props;
        if (!p) continue;
        if (p.label === label) {
          const kids = Array.isArray(p.children) ? p.children : [p.children];
          return kids.find(Boolean) ?? null;
        }
        const kids = p.children;
        if (Array.isArray(kids)) stack.push(...kids);
        else if (kids) stack.push(kids);
      }
      return null;
    }

    /**
     * 模拟「用户在面板里拨某个开关」：走面板组件 → Toggle.onChange →
     * saveSettings → sanitize + notify → setLayerSync。这条正是真实路径。
     */
    const toggle = (label, value) => {
      const el = Panel();
      const control = findControl(el, label);
      if (!control || !control.props || typeof control.props.onChange !== 'function') {
        throw new Error(`面板里找不到「${label}」这个开关`);
      }
      control.props.onChange(value);
      flushRaf();
    };

    return { dom, document, body, win, effects, toggle, panelRenders: () => Panel() };
  } finally {
    /*
     * ⚠️ 这里【不能】还原全局 —— boot() 返回后测试还要调 toggle()，
     * 那条路径（saveSettings → notify → setLayerSync → stopLayer）依然会读
     * document 这些裸全局名。还原早了就报 "document is not defined"
     * （第一版就是这么错的）。
     * 每个 boot() 都会用自己那份 win 覆盖全局，测试又是串行跑的，
     * 所以「不还原」不会互相污染；进程退出时自然结束。
     */
  }
}

// ── 断言用的探针 ──────────────────────────────────────────────────────────────
/*
 * ⚠️ 不能用 dom.ALL 过滤 —— 那是「曾经创建过的所有元素」的登记表，
 * remove() 只是从父节点摘下来，不会从 ALL 里注销。用它数头像会永远数到历史峰值
 * （第一版就这么错了：明明已经清干净，却报「还有 2 个头像节点」）。
 * 正确做法：从 document.body 往下真实遍历，只数**当前挂在树上**的。
 */
function walkTree(root, out = []) {
  for (const c of root.children) { out.push(c); walkTree(c, out); }
  return out;
}
const inTree = (dom) => walkTree({ children: [dom.document.head, dom.document.body] });

const avatarNodes = (dom) => inTree(dom).filter((e) => e.attrs['data-cav-node'] !== undefined);
const avatarRows = (dom) => inTree(dom).filter((e) => e.attrs['data-cav-row'] !== undefined);
const fontStyleNode = (dom) => inTree(dom).find((e) => e.id === 'cav-font-style') ?? null;

function state(dom, body) {
  return {
    bodyOn: body.getAttribute('data-cav-on'),
    sizeVar: body.style.getPropertyValue('--cav-size'),
    roundVar: body.style.getPropertyValue('--cav-round'),
    textColorVar: body.style.getPropertyValue('--cav-text-color'),
    userTextColorVar: body.style.getPropertyValue('--cav-user-text-color'),
    avatarNodes: avatarNodes(dom).length,
    avatarRows: avatarRows(dom).length,
    fontNode: Boolean(fontStyleNode(dom)),
    fontCss: fontStyleNode(dom)?.textContent ?? '',
  };
}

// ── 用例 ─────────────────────────────────────────────────────────────────────
const BASE = {
  plugin: { avatar: true, font: true, stickOffset: 2, stickFollow: true },
  avatarSize: 50,
  avatarRadius: 70,
  textColor: '',
  userTextColor: '',
  fontFamily: '',
  fontMono: '',
  bodyFont: '',
  headingFont: '',
  fontSizeDelta: 0,
  headingSizeDelta: 0,
  lineHeightDelta: 0,
  fontWeight: 0,
};

const FONT_ON = {
  ...BASE,
  fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif',
  fontSizeDelta: 2,
  textColor: '#ff0000',
  userTextColor: '#00ff00',
};

console.log('\n[1] 两个都开：头像 + 字体都生效');
{
  const { dom, body } = await boot(FONT_ON);
  const s = state(dom, body);
  check('body 带 data-cav-on="on"', s.bodyOn === 'on', String(s.bodyOn));
  check('写了 --cav-size', s.sizeVar === '50px', s.sizeVar);
  check('写了 --cav-round', s.roundVar === '70', s.roundVar);
  check('注入了头像节点', s.avatarNodes > 0, String(s.avatarNodes));
  check('给消息行打了标记', s.avatarRows > 0, String(s.avatarRows));
  check('turn-process 行没被装饰（工具调用照常）',
    !inTree(dom).some((e) => e.attrs['data-chat-flow-kind'] === 'turn-process' && e.attrs['data-cav-row']),
    '工具行被误装饰了');
  check('字体 style 节点存在', s.fontNode);
  check('字体 CSS 含界面字体', s.fontCss.includes('--dsw-font-family'));
  check('字体 CSS 含字号偏移', s.fontCss.includes('--dsh-content-font-size'));
  check('写了正文字色变量', s.textColorVar === '#ff0000', s.textColorVar);
  check('写了用户字色变量', s.userTextColorVar === '#00ff00', s.userTextColorVar);
}

console.log('\n[2] 只关头像：字体必须照常生效');
{
  const { dom, body } = await boot({ ...FONT_ON, plugin: { ...FONT_ON.plugin, avatar: false } });
  const s = state(dom, body);
  check('body 没有 data-cav-on', s.bodyOn === null, String(s.bodyOn));
  check('没有头像节点', s.avatarNodes === 0, String(s.avatarNodes));
  check('消息行没有插件标记', s.avatarRows === 0, String(s.avatarRows));
  check('没有残留 --cav-size', s.sizeVar === '', s.sizeVar);
  check('没有残留 --cav-round', s.roundVar === '', s.roundVar);
  check('字体 style 节点仍在', s.fontNode);
  check('字体 CSS 仍含界面字体', s.fontCss.includes('--dsw-font-family'));
  check('字体 CSS 仍含字号偏移', s.fontCss.includes('--dsh-content-font-size'));
  check('正文字色变量仍在（关头像不影响字色）', s.textColorVar === '#ff0000', s.textColorVar);
  check('用户字色变量仍在', s.userTextColorVar === '#00ff00', s.userTextColorVar);
}

console.log('\n[3] 只关字体：头像必须照常生效');
{
  const { dom, body } = await boot({ ...FONT_ON, plugin: { ...FONT_ON.plugin, font: false } });
  const s = state(dom, body);
  check('body 仍带 data-cav-on="on"', s.bodyOn === 'on', String(s.bodyOn));
  check('仍有头像节点', s.avatarNodes > 0, String(s.avatarNodes));
  check('仍有行标记', s.avatarRows > 0, String(s.avatarRows));
  check('仍写了 --cav-size', s.sizeVar === '50px', s.sizeVar);
  check('字体 style 节点已移除', !s.fontNode);
  check('正文字色变量已撤掉', s.textColorVar === '', s.textColorVar);
  check('用户字色变量已撤掉', s.userTextColorVar === '', s.userTextColorVar);
}

console.log('\n[4] 两个都关：逐字节回到原生');
{
  const { dom, body } = await boot({ ...FONT_ON, plugin: { avatar: false, font: false } });
  const s = state(dom, body);
  check('body 没有 data-cav-on', s.bodyOn === null);
  check('没有头像节点', s.avatarNodes === 0);
  check('没有行标记', s.avatarRows === 0);
  check('没有 --cav-size', s.sizeVar === '');
  check('没有 --cav-round', s.roundVar === '');
  check('没有字体 style 节点', !s.fontNode);
  check('没有字色变量', s.textColorVar === '' && s.userTextColorVar === '');
  check('没有其它残留的 --cav-* 变量',
    Object.keys(body.style._p).every((k) => !k.startsWith('--cav-')),
    Object.keys(body.style._p).join(' | '));
}

console.log('\n[5] 旧配置（没有 avatar / font 键）不应把功能关掉');
{
  // 模拟 v1.0 的 settings.json：plugin 里只有 enabled / stickOffset / stickFollow
  const legacy = {
    ...BASE,
    plugin: { enabled: true, aiBubble: false, stickOffset: 0, stickFollow: false },
  };
  const { dom, body } = await boot(legacy);
  const s = state(dom, body);
  check('头像仍然生效（缺键视为开）', s.avatarNodes > 0, String(s.avatarNodes));
  check('body 带 data-cav-on', s.bodyOn === 'on');
  /*
   * 字体这条：旧配置里所有字体字段都是空串 ⇒ buildFontCss 返回空串 ⇒
   * 不产生 style 节点。这是对的（等于「没有自定义字体」），不是缺陷。
   * 真正要断言的是「字体功能没被 enabled 键误关」—— 用一份带字体设置的旧配置验。
   */
  const legacyWithFont = {
    ...FONT_ON,
    plugin: { enabled: true, aiBubble: false, stickOffset: 0, stickFollow: false },
  };
  const r2 = await boot(legacyWithFont);
  check('旧配置下字体也生效（缺 font 键视为开）',
    Boolean(fontStyleNode(r2.dom)) && state(r2.dom, r2.body).fontCss.includes('--dsw-font-family'));
  check('旧配置的 stickFollow=false 被尊重',
    // 跟随关掉 ⇒ 头像 top 应被复位为 0px
    avatarNodes(r2.dom).every((n) => n.style.top === '' || n.style.top === '0px'),
    avatarNodes(r2.dom).map((n) => n.style.top).join(' | '));
}

console.log('\n[6] 头像跟随开关仍然有效（没被这次改造弄坏）');
{
  const followOn = await boot({ ...BASE, plugin: { ...BASE.plugin, stickFollow: true, stickOffset: 2 } });
  const followOff = await boot({ ...BASE, plugin: { ...BASE.plugin, stickFollow: false, stickOffset: 2 } });
  check('跟随时写了 top 样式（可能为 0px，但属性存在）',
    avatarNodes(followOn.dom).every((n) => n.style.top !== undefined));
  check('不跟随时 top 一定是 0px（复位干净）',
    avatarNodes(followOff.dom).every((n) => n.style.top === '0px' || n.style.top === ''),
    avatarNodes(followOff.dom).map((n) => JSON.stringify(n.style.top)).join(' | '));
}

console.log('\n[7] 运行时切换（真实场景：头像已经画出来之后再关掉）');
{
  /*
   * 前面几个用例都是「启动时就关着」—— 那种情况下 sweep 从没跑过，
   * 天然干净，测不出清理逻辑。真实场景是：头像已经挂在页面上，
   * 用户在面板里把开关拨到关，setLayerSync 立刻重跑 ⇒ 必须当场摘干净。
   * 这一段走的就是那条路：面板组件 → Toggle.onChange → saveSettings。
   */
  const t = await boot(FONT_ON);           // 先全开
  check('切换前：头像在', avatarNodes(t.dom).length > 0, String(avatarNodes(t.dom).length));
  check('切换前：body 带标记', t.body.getAttribute('data-cav-on') === 'on');

  t.toggle('头像', false);
  const s1 = state(t.dom, t.body);
  check('关掉后：头像节点当场摘掉', s1.avatarNodes === 0, String(s1.avatarNodes));
  check('关掉后：行标记当场摘掉', s1.avatarRows === 0, String(s1.avatarRows));
  check('关掉后：body 标记摘掉', s1.bodyOn === null, String(s1.bodyOn));
  check('关掉后：尺寸变量清掉', s1.sizeVar === '' && s1.roundVar === '');
  check('关掉后：字体不受影响', s1.fontNode && s1.fontCss.includes('--dsw-font-family'));
  check('关掉后：字色不受影响', s1.textColorVar === '#ff0000');

  // 再打开
  t.toggle('头像', true);
  const s2 = state(t.dom, t.body);
  check('重新打开：头像回来了', s2.avatarNodes > 0, String(s2.avatarNodes));
  check('重新打开：body 标记回来了', s2.bodyOn === 'on');
  check('重新打开：尺寸变量回来了', s2.sizeVar === '50px', s2.sizeVar);

  // 关字体
  t.toggle('字体', false);
  const s3 = state(t.dom, t.body);
  check('关字体：头像仍在', s3.avatarNodes > 0, String(s3.avatarNodes));
  check('关字体：字体节点移除', !s3.fontNode);
  check('关字体：字色变量撤掉', s3.textColorVar === '' && s3.userTextColorVar === '');
  check('关字体：头像尺寸变量还在', s3.sizeVar === '50px', s3.sizeVar);

  // 再开字体
  t.toggle('字体', true);
  const s4 = state(t.dom, t.body);
  check('重新开字体：字体节点回来', s4.fontNode);
  check('重新开字体：字色变量回来', s4.textColorVar === '#ff0000', s4.textColorVar);
}

console.log('\n[8] 面板结构：开关始终可见，控件随开关出现/隐藏');
{
  /*
   * 「关掉后还能再打开」是硬要求：开关本身不能被自己的开关条件渲染掉，
   * 否则一关就再也开不回来（用户只能去改 settings.json）。
   * 反过来，开关下面的控件应该跟着隐藏 —— 不显示调了也不生效的东西。
   */
  const on = await boot(FONT_ON);
  const off = await boot({ ...FONT_ON, plugin: { avatar: false, font: false } });

  const countRows = (tree) => {
    let n = 0;
    const seen = new Set();
    const stack = [tree];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object' || seen.has(x)) continue;
      seen.add(x);
      if (x.props && typeof x.props.label === 'string') n += 1;
      const kids = x.props?.children;
      if (Array.isArray(kids)) stack.push(...kids);
      else if (kids) stack.push(kids);
    }
    return n;
  };

  const rowsOn = countRows(on.panelRenders());
  const rowsOff = countRows(off.panelRenders());
  check('全开时控件更多', rowsOn > rowsOff, `开=${rowsOn} 关=${rowsOff}`);
  check('全关时仍能看到两个开关（能开回来）', rowsOff >= 2, String(rowsOff));

  const labelsOf = (tree) => {
    const out = [];
    const seen = new Set();
    const stack = [tree];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object' || seen.has(x)) continue;
      seen.add(x);
      if (x.props && typeof x.props.label === 'string') out.push(x.props.label);
      const kids = x.props?.children;
      if (Array.isArray(kids)) stack.push(...kids);
      else if (kids) stack.push(kids);
    }
    return out;
  };

  const labelsOff = labelsOf(off.panelRenders());
  check('全关时「头像」开关仍在', labelsOff.includes('头像'), labelsOff.join(' | '));
  check('全关时「字体」开关仍在', labelsOff.includes('字体'), labelsOff.join(' | '));
  check('全关时不显示「头像大小」', !labelsOff.includes('头像大小'), labelsOff.join(' | '));
  check('全关时不显示「界面字体」', !labelsOff.includes('界面字体'), labelsOff.join(' | '));
  check('全关时不显示「正文字色」', !labelsOff.includes('正文字色'), labelsOff.join(' | '));
  check('全关时没有「启用插件」总开关', !labelsOff.includes('启用插件'), labelsOff.join(' | '));

  const labelsOn = labelsOf(on.panelRenders());
  for (const must of ['头像', '头像大小', '圆角强度', '跟随画面', '吸顶下移',
    '字体', '界面字体', '正文字体', '代码字体', '正文字号', '标题字号',
    '行距', '正文加粗', '正文字色', '我的消息字色']) {
    check(`全开时有「${must}」`, labelsOn.includes(must), labelsOn.join(' | '));
  }
  check('全开时没有气泡框相关项',
    !labelsOn.some((l) => l.includes('气泡')), labelsOn.join(' | '));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
