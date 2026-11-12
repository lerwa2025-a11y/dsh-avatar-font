/**
 * dsh-avatar-font —— Client 半。
 *
 * 头像 + 字体，两个功能各自独立启停（面板里各有一个开关）。
 *
 * 头像：移植自 dsh-plugin-wallpaper-engine 的「自定义会话头像」装饰层，
 *   并补上「头像跟随滚动」（sticky 语义）：行顶滚出可视区 ⇒ 头像贴顶跟着走；
 *   行快滚完 ⇒ 停行尾随行滚出。
 *
 * 字体：精简自 dsh-fonttune，只保留够用的部分（字体 / 字号 / 行距 / 加粗 / 字色）。
 *
 * 与壁纸引擎那套的关键差别：
 *   - 头像**每个消息行都挂**（包括展开的过程区里的行）—— 这才是用户要的"多个头像"；
 *   - 有独立的数据目录与设置（不复用 ~/.dsh-wallpaper-engine）；
 *   - 设置入口是**这个插件自己的详情页**（plugins.bundle.config，按包名 keyed），
 *     不再占「设置」页里单独的一节。
 *
 * ⚠️ v2.0 去掉了「AI 回复气泡框」整套功能（连同为它服务的超宽内容约束）。
 *    现在只剩头像与字体两条线，且两条线互不依赖。
 */

window.__ModuleLoader__.load({
  id: 'dsh-avatar-font',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');
    /*
     * react-dom 是「可选增强」：能拿到就用 createPortal 把裁剪弹窗挂到 document.body，
     * 绕开「宿主祖先带 transform/filter 会让 position:fixed 改定位基准」这个 CSS 坑；
     * 拿不到就退回普通 fixed 渲染（见 CropDialog）。
     * 包 try 是因为 ModuleLoader 只保证 react 一定在。
     */
    let reactDom = null;
    try { reactDom = require('react-dom'); } catch { /* 宿主未暴露 react-dom，走降级 */ }

    // ── 常量 ────────────────────────────────────────────────────────────────
    const API = '/dsh-avatar-font';

    /** 三种「消息行」的 kind → 头像属于哪一方（移植自壁纸引擎）。 */
    const AVATAR_FLOW_SIDES = { user: 'user', steering: 'user', 'assistant-step': 'ai' };
    /** 消息行选择器。 */
    const AVATAR_ROW_SELECTOR =
      '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant-step"]';

    const AVATAR_ROW_ATTR = 'data-cav-row';
    const AVATAR_NODE_CLASS = 'cav-avatar';
    const AVATAR_NODE_ATTR = 'data-cav-node';
    const AVATAR_ATTR = 'data-cav-on';
    const VAR_SIZE = '--cav-size';
    const VAR_ROUND = '--cav-round';

    /** 裁剪结果的最长边上限（沿用原导入口径：缩到 512px 以内再上传）。 */
    const CROP_OUT_MAX = 512;
    /** 裁剪方框的最小边长（显示坐标 px）：再小就看不清也没法拖。 */
    const CROP_MIN_SIDE = 48;

    /** 尺寸 16–128；圆角 0–100；吸顶下移 0–6（个头像身位）。 */
    const CLAMP_SIZE = { min: 16, max: 128, def: 40 };
    const CLAMP_ROUND = { min: 0, max: 100, def: 100 };

    /*
     * ── [本地补丁 · 字体清单] ────────────────────────────────────────────────
     * 只列**本机实测装了的**中文字体（2026-10-25 用 InstalledFontCollection 查过）。
     *
     * 为什么不照搬 dsh-fonttune 的 22 项清单：那份清单里有 PingFang SC、
     * Hiragino、Sarasa Gothic 等 macOS/第三方字体，本机没有。列出来选中后
     * 浏览器静默回退到别的字体，看上去像「功能没生效」，其实是字体不存在。
     *
     * 每项 value 是完整的 CSS font-family 值：中文名 + 英文名 + 兜底，
     * 这样不同引擎都能命中，末尾的 generic family 保证永远有字可显示。
     */
    const FONT_FAMILIES = [
      { label: '主题默认', value: '' },
      { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
      { label: 'Noto Sans SC（思源黑体风格）', value: '"Noto Sans SC", "Microsoft YaHei", sans-serif' },
      { label: '宋体', value: 'SimSun, "宋体", serif' },
      { label: '黑体', value: '"黑体", SimHei, sans-serif' },
      { label: '楷体', value: 'KaiTi, "楷体", serif' },
      { label: '仿宋', value: 'FangSong, "仿宋", serif' },
    ];

    /** 等宽字体清单。Consolas 是 Windows 自带，JetBrains Mono 装了就用。 */
    const MONO_FAMILIES = [
      { label: '主题默认', value: '' },
      { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
      { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
      { label: '等宽（系统默认）', value: 'monospace' },
    ];

    /** 内置默认头像（没导入图片时画）：user = 人像，ai = 四角星。 */
    const GLYPH_PARTS = {
      user: [
        ['circle', { cx: '8', cy: '5.6', r: '2.5' }],
        ['path', { d: 'M3.4 13.2c0-2.3 2.1-3.8 4.6-3.8s4.6 1.5 4.6 3.8' }],
      ],
      ai: [
        ['path', { d: 'M8 2.2l1.35 3.9a1.6 1.6 0 0 0 1 1l3.9 1.35-3.9 1.35a1.6 1.6 0 0 0-1 1L8 14.7l-1.35-3.9a1.6 1.6 0 0 0-1-1L1.75 8.45l3.9-1.35a1.6 1.6 0 0 0 1-1z' }],
      ],
    };
    const GLYPH_VIEW_BOX = '0 0 16 16';

    // ── 状态 ────────────────────────────────────────────────────────────────
    const DEFAULT_SETTINGS = {
      /*
       * 两个功能开关（v2.0）：头像 / 字体，各自独立启停。
       * 不再有 plugin.enabled —— 插件启停归 DSH 的插件管理，面板里再来一个
       * 总开关只是第二个真相源，容易让人以为「关掉面板开关 = 卸载插件」。
       */
      plugin: { avatar: true, font: true, stickOffset: 2, stickFollow: true },
      avatarSize: 40,
      avatarRadius: 100,
      // 正文字色：留空 = 跟随主题
      textColor: '',
      // 用户消息字色：留空 = 跟随主题
      userTextColor: '',
      // [本地补丁] 字体（从 dsh-fonttune 移植的精简版）
      fontFamily: '',
      fontMono: '',
      // 字体覆盖层：空 = 沿用界面字体。填了则正文/标题单独用它。
      bodyFont: '',
      headingFont: '',
      fontSizeDelta: 0,
      headingSizeDelta: 0,
      lineHeightDelta: 0,
      fontWeight: 0,
    };
    let settings = DEFAULT_SETTINGS;
    let availability = { user: false, ai: false };
    /*
     * 另一方的「当前头像版本」= 磁盘文件名（含时间戳+随机串），由 Host 下发。
     * v2.0.1 修复：头像读取地址是固定的 /avatar/<side>，加上服务端 immutable 长缓存，
     * 换图后浏览器仍拿旧缓存 ⇒ 看起来"上传了没反应"。把版本拼进 ?v= 即可破缓存。
     * 空串 = 该侧没有头像。
     */
    let avatarVer = { user: '', ai: '' };
    const listeners = new Set();
    let layerSync = null;

    const clamp = (v, lo, hi, fb) => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return fb;
      return Math.min(hi, Math.max(lo, Math.round(n)));
    };
    /** 只接受 `#rgb` / `#rrggbb`（以及空串 = 跟随主题），避免任意值进 CSS 造成注入。 */
    const hexOf = (v) => {
      if (typeof v !== 'string') return '';
      const s = v.trim();
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
    };
    const sizeOf = () => clamp(settings.avatarSize, CLAMP_SIZE.min, CLAMP_SIZE.max, CLAMP_SIZE.def);
    const roundOf = () => clamp(settings.avatarRadius, CLAMP_ROUND.min, CLAMP_ROUND.max, CLAMP_ROUND.def);
    const stickOffsetOf = () => clamp(settings.plugin?.stickOffset, 0, 6, 2);
    /**
     * 头像是否跟随滚动（v1.0）。
     *   true  = 贴住滚动区顶部跟着走（老行为，默认）
     *   false = 只固定在行首，长回复往下滚时头像随行一起滚走
     * 缺省 true：旧配置里没有这个键时不能被判成「关」。
     */
    const stickFollowOf = () => settings.plugin?.stickFollow !== false;
    /*
     * 两个功能开关（v2.0）。都缺省为 true —— 老配置里没有这两个键时
     * 不能把用户已有的功能悄悄关掉。
     */
    const avatarOn = () => settings.plugin?.avatar !== false;
    const fontOn = () => settings.plugin?.font !== false;

    /**
     * [本地补丁] 正文字色。返回合法 hex 或 ''（空 = 跟随主题）。
     *
     * 只做「是不是颜色」的判断，不干预用户选什么颜色 —— 太浅看不清是用户的选择，
     * 面板上给一句提示即可，不拦、不自动纠正。
     */
    const textColorOf = () => hexOf(settings.textColor);

    /** [本地补丁] 用户消息字色。返回合法 hex 或 ''（空 = 跟随主题）。 */
    const userTextColorOf = () => hexOf(settings.userTextColor);

    // ── [本地补丁 · 字体] 取值与净化 ──────────────────────────────────────
    /** 字体栈：空串 = 沿用主题；非法字符（能逃出 CSS 声明的）一律丢掉。 */
    const fontStackOf = (v) => {
      if (typeof v !== 'string') return '';
      const s = v.trim().slice(0, 200);
      if (s === '') return '';
      return /^[\w\s\u4e00-\u9fa5\-,"'·]+$/.test(s) ? s : '';
    };
    const fontFamilyOf = () => fontStackOf(settings.fontFamily);
    const fontMonoOf = () => fontStackOf(settings.fontMono);
    /**
     * 界面上「界面字体」下拉框当前该显示哪一项。
     * 存的是完整字体栈，但 <option> 的 value 也是完整栈，直接相等即可。
     * 若存的值不在清单里（比如手改过配置文件），退回第一项「主题默认」，
     * 避免下拉框显示空白。
     */
    const familyOf = () => {
      const v = fontFamilyOf();
      return FONT_FAMILIES.some((f) => f.value === v) ? v : '';
    };
    const bodyFontOf = () => fontStackOf(settings.bodyFont);
    const headingFontOf = () => fontStackOf(settings.headingFont);
    /** 偏移量：0 = 跟随主题。 */
    const fontSizeDeltaOf = () => clamp(settings.fontSizeDelta, -4, 8, 0);
    const headingSizeDeltaOf = () => clamp(settings.headingSizeDelta, -6, 12, 0);
    const lineHeightDeltaOf = () => clamp(settings.lineHeightDelta, -20, 60, 0);
    const fontBoldOf = () => clamp(settings.fontWeight, 0, 700, 0);
    /** [本地补丁] 设了合法颜色就写入变量，留空/非法则移除变量 ⇒ CSS 回落到主题色。 */
    function applyColorVar(el, name, value) {
      const hex = hexOf(value);
      if (hex) el.style.setProperty(name, hex);
      else el.style.removeProperty(name);
    }

    function sanitize(patch, current) {
      const p = patch && typeof patch === 'object' ? patch : {};
      const pl = p.plugin && typeof p.plugin === 'object' ? p.plugin : {};
      return {
        plugin: {
          /* 两个功能开关（v2.0）。缺省视为 true —— 旧配置没有这两个键时保持原样。 */
          avatar: typeof pl.avatar === 'boolean' ? pl.avatar : current.plugin.avatar !== false,
          font: typeof pl.font === 'boolean' ? pl.font : current.plugin.font !== false,
          stickOffset: clamp(pl.stickOffset ?? current.plugin.stickOffset, 0, 6, 2),
          /* 头像跟随滚动（v1.0）。缺省视为 true —— 旧配置没有这个键时保持老行为。 */
          stickFollow: typeof pl.stickFollow === 'boolean' ? pl.stickFollow : current.plugin.stickFollow !== false,
        },
        avatarSize: clamp(p.avatarSize ?? current.avatarSize, CLAMP_SIZE.min, CLAMP_SIZE.max, CLAMP_SIZE.def),
        avatarRadius: clamp(p.avatarRadius ?? current.avatarRadius, CLAMP_ROUND.min, CLAMP_ROUND.max, CLAMP_ROUND.def),
        textColor: p.textColor === undefined ? current.textColor : hexOf(p.textColor),
        userTextColor: p.userTextColor === undefined ? current.userTextColor : hexOf(p.userTextColor),
        // ── [本地补丁 · 字体] ──
        fontFamily: p.fontFamily === undefined ? current.fontFamily : fontStackOf(p.fontFamily),
        fontMono: p.fontMono === undefined ? current.fontMono : fontStackOf(p.fontMono),
        bodyFont: p.bodyFont === undefined ? current.bodyFont : fontStackOf(p.bodyFont),
        headingFont: p.headingFont === undefined ? current.headingFont : fontStackOf(p.headingFont),
        fontSizeDelta: clamp(p.fontSizeDelta ?? current.fontSizeDelta, -4, 8, 0),
        headingSizeDelta: clamp(p.headingSizeDelta ?? current.headingSizeDelta, -6, 12, 0),
        lineHeightDelta: clamp(p.lineHeightDelta ?? current.lineHeightDelta, -20, 60, 0),
        fontWeight: clamp(p.fontWeight ?? current.fontWeight, 0, 700, 0),
      };
    }

    const getSettings = () => settings;
    const hasAvatar = (side) => availability[side] === true;
    function notify() {
      listeners.forEach((fn) => fn());
      layerSync?.();
    }
    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
    function setLayerSync(fn) { layerSync = fn; }

    function fetchJson(path, init) {
      return fetch(API + path, { headers: { 'content-type': 'application/json' }, ...init }).then((r) => r.json());
    }
    let seq = 0;
    /**
     * 只同步头像的「有没有 / 是哪一版」，不碰字体等其它设置。
     * 上传、清除、读设置三条路径的响应里都带这两个字段，统一从这里落。
     */
    function applyAvatarState(d) {
      if (!d || typeof d !== 'object') return;
      if (d.available && typeof d.available === 'object') {
        availability = {
          user: typeof d.available.user === 'boolean' ? d.available.user : availability.user,
          ai: typeof d.available.ai === 'boolean' ? d.available.ai : availability.ai,
        };
      }
      if (d.version && typeof d.version === 'object') {
        avatarVer = {
          user: typeof d.version.user === 'string' ? d.version.user : avatarVer.user,
          ai: typeof d.version.ai === 'string' ? d.version.ai : avatarVer.ai,
        };
      }
    }
    function applyResponse(d) {
      if (d && d.ok && d.settings) {
        settings = sanitize(d.settings, settings);
        applyAvatarState(d);
        notify();
      }
    }
    function loadSettings() {
      const mine = ++seq;
      fetchJson('/settings').then((d) => { if (mine === seq) applyResponse(d); }).catch(() => {});
    }
    function saveSettings(patch) {
      const mine = ++seq;
      settings = sanitize(patch, settings);
      notify();
      fetchJson('/settings', { method: 'POST', body: JSON.stringify(patch) })
        .then((d) => { if (mine === seq) applyResponse(d); }).catch(() => {});
    }

    // ── DOM 装饰层（移植自壁纸引擎 avatar-layer.js）──────────────────────────
    let observer = null;
    let timer = null;
    let active = false;
    const DEBOUNCE_MS = 120;

    const STICK_TOP = 8;
    let stickFrame = 0;
    let stickListening = false;

    function body() {
      return typeof document !== 'undefined' && document && document.body ? document.body : null;
    }

    /**
     * 头像图片 URL。
     *   · 没设置过 → 空串（调用方画内置默认头像）
     *   · 设置过   → 带上 ?v=<文件名> 的地址
     *
     * 这个 ?v= 不是装饰：服务端对带 v 的请求回 immutable 长缓存，一屏几十个 <img>
     * 才不会每气泡一次请求；而换图后文件名变 ⇒ URL 变 ⇒ 缓存自然失效。
     * 少了它就会出现「已有头像时再上传，画面不动，必须先清除」的老 bug。
     */
    function avatarUrl(side) {
      if (!hasAvatar(side)) return '';
      const v = avatarVer[side];
      return v
        ? `${API}/avatar/${side}?v=${encodeURIComponent(v)}`
        : `${API}/avatar/${side}`;
    }

    function glyphSvgString(side) {
      const parts = GLYPH_PARTS[side] || GLYPH_PARTS.user;
      const inner = parts.map(([tag, a]) =>
        '<' + tag + ' ' + Object.keys(a).map((k) => k + '="' + a[k] + '"').join(' ') + '/>').join('');
      return '<svg viewBox="' + GLYPH_VIEW_BOX + '" width="16" height="16" fill="none" stroke="currentColor"'
        + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }

    /** 就地更新头像节点内容（图 or 内置头像）。 */
    function fillNode(node, side) {
      const url = avatarUrl(side);
      const want = url ? 'img' : 'glyph';
      if (node.getAttribute('data-cav-kind') === want) {
        if (want === 'img') {
          const img = node.firstElementChild;
          if (img && img.getAttribute('src') !== url) img.setAttribute('src', url);
        }
        return;
      }
      node.setAttribute('data-cav-kind', want);
      try { node.textContent = ''; } catch { /* ignore */ }
      if (want === 'img') {
        const img = document.createElement('img');
        img.className = AVATAR_NODE_CLASS + '__img';
        img.setAttribute('alt', '');
        img.setAttribute('draggable', 'false');
        img.setAttribute('src', url);
        node.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.className = AVATAR_NODE_CLASS + '__glyph';
        span.innerHTML = glyphSvgString(side);
        node.appendChild(span);
      }
    }

    /**
     * 判断一行是不是「过程行」（思考区）。
     * 宿主把同一条 assistant-step 拆成两行，靠 data-chat-group-part 区分：
     *   data-chat-group-part="reasoning" → 思考
     *   data-chat-group-part="response"  → 主要回复
     *
     * ⚠️ 硬规矩：本插件**绝不能装饰 reasoning 行**（不插头像、不把它改成 flex）。
     *    证据（不是猜的）：工具调用行是 data-chat-flow-kind="turn-process"，
     *    它**不在** AVATAR_FLOW_SIDES 里 ⇒ 插件从来不碰它 ⇒ 工具调用照常显示；
     *    而思考行是 assistant-step + reasoning ⇒ 插件会去装饰它 ⇒ 思考内容整块消失。
     *    「工具调用正常、思考消失」这个对照，把问题精确定位在"插件动了思考行"上。
     *    思考行那块内容由宿主自己的 ReasoningRow 控制（折叠时 contain:size layout
     *    + 固定 24px 高），行一旦被改成别的排版上下文就会算不出高度 ⇒ 直接不显示。
     */
    function isProcessRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return false;
      return (row.getAttribute('data-chat-group-part') ?? '') === 'reasoning';
    }

    /** 摘掉一行上的插件痕迹（头像节点 + 行标记），把该行完整交还给宿主原生渲染。 */
    function stripRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return false;
      if (!row.hasAttribute(AVATAR_ROW_ATTR)) return false;
      const old = row.firstElementChild;
      if (old && old.classList && old.classList.contains(AVATAR_NODE_CLASS)) {
        try { old.remove(); } catch { /* ignore */ }
      }
      row.removeAttribute(AVATAR_ROW_ATTR);
      return true;
    }

    /** 给一条消息行补头像（已补过则只就地更新）。 */
    function decorateRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return;
      // ⚠️ 思考行：不装饰；若以前装饰过（改设置/热重载残留）就先摘干净。
      if (isProcessRow(row)) { stripRow(row); return; }
      const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
      if (!side) return;
      const marked = row.getAttribute(AVATAR_ROW_ATTR);
      if (marked === side) {
        const node = row.firstElementChild;
        if (node && node.classList && node.classList.contains(AVATAR_NODE_CLASS)) {
          fillNode(node, side);
          return;
        }
        row.removeAttribute(AVATAR_ROW_ATTR);
      } else if (marked) {
        const old = row.firstElementChild;
        if (old && old.classList && old.classList.contains(AVATAR_NODE_CLASS)) {
          try { old.remove(); } catch { /* ignore */ }
        }
        row.removeAttribute(AVATAR_ROW_ATTR);
      }
      const node = document.createElement('div');
      node.className = AVATAR_NODE_CLASS + ' ' + AVATAR_NODE_CLASS + '--' + side;
      node.setAttribute(AVATAR_NODE_ATTR, side);
      node.setAttribute('aria-hidden', 'true');
      fillNode(node, side);
      row.setAttribute(AVATAR_ROW_ATTR, side);
      try { row.insertBefore(node, row.firstChild); } catch { /* ignore */ }
    }

    function sweep() {
      if (typeof document.querySelectorAll !== 'function') return;
      let rows = [];
      try { rows = document.querySelectorAll(AVATAR_ROW_SELECTOR); } catch { return; }
      for (const row of rows) decorateRow(row);
    }

    /** 观察者回调：新增行直接补；其余新增元素若在已装饰行内就早退（避免流式输出时逐帧扫子树）。 */
    function onMutations(records) {
      if (!active) return;
      for (const r of records) {
        const added = r.addedNodes;
        if (!added || !added.length) continue;
        for (const n of added) {
          if (!n || n.nodeType !== 1) continue;
          try {
            if (n.matches && n.matches(AVATAR_ROW_SELECTOR)) { decorateRow(n); continue; }
            if (n.closest && n.closest('[' + AVATAR_ROW_ATTR + ']')) continue;
          } catch { continue; }
          let inner = [];
          try { inner = n.querySelectorAll ? n.querySelectorAll(AVATAR_ROW_SELECTOR) : []; } catch { inner = []; }
          for (const row of inner) decorateRow(row);
        }
      }
    }

    /** 找到行所在的滚动容器（向上第一个真正可纵向滚动的祖先）。 */
    function findScroller(el) {
      let node = el?.parentElement ?? null;
      while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    }

    /** 头像跟随滚动：重算每个头像相对行的 top。 */
    function updateSticky() {
      /*
       * 关掉「跟随滚动」时什么都不算：头像固定在行首，位置完全由 flex 布局决定。
       * 必须先复位 —— 开关从「开」切到「关」时，上一次循环可能已经往
       * style.top 写过一个大值，不复位的话头像会停在半空。
       */
      if (!stickFollowOf()) { resetSticky(); return; }
      const wraps = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']');
      for (const wrap of wraps) {
        const row = wrap.parentElement;
        if (!row) continue;
        const scroller = findScroller(row);
        if (!scroller) {
          if (wrap.style.top !== '0px') wrap.style.top = '0px';
          continue;
        }
        const rowRect = row.getBoundingClientRect();
        const scRect = scroller.getBoundingClientRect();
        const rowTopInView = rowRect.top - scRect.top;
        const maxTop = Math.max(0, row.offsetHeight - wrap.offsetHeight);
        // 吸顶位置 = 8px 留白 + N 个头像身位（默认 2，避开主题云母状态栏）
        const stickTop = STICK_TOP + wrap.offsetHeight * stickOffsetOf();
        let top = 0;
        if (rowTopInView < stickTop) top = Math.min(stickTop - rowTopInView, maxTop);
        top = Math.max(0, Math.min(top, maxTop));
        const next = Math.round(top) + 'px';
        if (wrap.style.top !== next) wrap.style.top = next;
      }
    }

    /** 把所有头像的跟随偏移清零（= 固定在行首）。关闭跟随时用，幂等。 */
    function resetSticky() {
      const wraps = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']');
      for (const wrap of wraps) {
        if (wrap.style.top !== '0px') wrap.style.top = '0px';
      }
    }

    function scheduleSticky() {
      if (!active || stickFrame !== 0) return;
      /*
       * 关闭跟随时连 rAF 都不排：滚动时整个重算被跳过，
       * 既不浪费每帧的 querySelectorAll，也不会和复位逻辑打架。
       */
      if (!stickFollowOf()) { resetSticky(); return; }
      stickFrame = requestAnimationFrame(() => { stickFrame = 0; updateSticky(); });
    }
    const onScrollOrResize = () => scheduleSticky();

    function scheduleProcess() {
      if (!active || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        sweep();
        scheduleSticky();
      }, DEBOUNCE_MS);
    }

    function startLayer() {
      if (active) return;
      active = true;
      observer = new MutationObserver(() => scheduleProcess());
      observer.observe(document.body, { childList: true, subtree: true });
      if (!stickListening) {
        stickListening = true;
        window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
        window.addEventListener('resize', onScrollOrResize, { passive: true });
      }
      scheduleProcess();
    }

    function stopLayer() {
      if (!active) return;
      active = false;
      observer?.disconnect();
      observer = null;
      if (stickListening) {
        stickListening = false;
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
      }
      if (stickFrame !== 0) { cancelAnimationFrame(stickFrame); stickFrame = 0; }
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      // 关掉 = 逐字节回到原生：摘掉所有注入节点、标记、body 开关与变量
      document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']').forEach((n) => { try { n.remove(); } catch { /* ignore */ } });
      document.querySelectorAll('[' + AVATAR_ROW_ATTR + ']').forEach((r) => r.removeAttribute(AVATAR_ROW_ATTR));
      const b = body();
      if (b) {
        b.removeAttribute(AVATAR_ATTR);
        b.style.removeProperty(VAR_SIZE);
        b.style.removeProperty(VAR_ROUND);
        /*
         * ⚠️ 这里【不动】--cav-text-color / --cav-user-text-color。
         * 字色归「字体」开关管，头像关掉时字色还得照常生效 ——
         * 撤不撤变量由 setLayerSync 的字体分支决定，不要在这里抢着做。
         */
      }
    }

    // ── [本地补丁 · 字体] 注入 ──────────────────────────────────────────────
    /**
     * 字体功能的实现（精简自 dsh-fonttune，只保留「够用」的部分）。
     *
     * 为什么不用它那套：它用 573KB 逐个改写 DSH 的 font 简写令牌链
     * （--dsw-font-base-16 这种每个字号一个令牌，还有 40+ 个派生令牌），
     * 为的是让字重轴、行高、字体三轴全联动。我们只要四件事：
     *   换字体 / 正文字号 / 标题字号 / 行距与加粗
     * 所以走一条短得多的路：**只改最上游的两个变量 + 少量直接覆盖**。
     *
     * DSH 的字号体系（查 app.asar 得到）：
     *   正文  --dsw-font-markdown-base  = var(--dsh-content-font-size,14px) / calc(24px + delta)
     *   标题  --dsw-font-markdown-h1..h3 = calc(N px + var(--dsh-content-font-delta))
     *   所以：
     *     · 正文字号 → 改 --dsh-content-font-size（其余派生自动跟）
     *     · 标题字号 → 改 --dsh-content-font-delta（标题加在 delta 上的）
     *   两者天然分离，正好对上「标题和正文分开调」的要求。
     *
     * ⚠️ 必须 !important：主题把 --dsh-content-font-size **内联写在 body 上**，
     *    内联声明优先级高于普通样式表规则，不加 !important 会改不动。
     */
    const FONT_STYLE_ID = 'cav-font-style';

    /** 把用户设置拼成一段 CSS。没有任何设置时返回空串（等于不改）。 */
    function buildFontCss(s) {
      const decls = [];
      const body = 'body';
      const root = ':root,body';

      // ① 界面字体：同时写 DSH 的字体变量和 body 的 font-family
      const family = fontStackOf(s.fontFamily);
      if (family) {
        decls.push(root + '{--dsw-font-family:' + family + ' !important}');
        decls.push(body + '{font-family:' + family + ' !important}');
      }

      // ② 代码字体：DSH 代码令牌链到 --ds-font-family-code
      const mono = fontStackOf(s.fontMono);
      if (mono) {
        decls.push(root + '{--dsw-font-mono:' + mono + ' !important;'
          + '--ds-font-family-code:' + mono + ' !important}');
        // 代码元素本身也要盖一次：它的 font 简写里已经写死了 family
        decls.push('pre,code,kbd,samp{font-family:' + mono + ' !important}');
      }

      // ③ 正文字号：只动最上游那个变量，派生令牌自动跟随
      const sizeDelta = clamp(s.fontSizeDelta, -4, 8, 0);
      if (sizeDelta !== 0) {
        decls.push(root + '{--dsh-content-font-size:calc(14px + ' + (sizeDelta > 0 ? '+' : '')
          + sizeDelta + 'px) !important}');
      }

      // ④ 标题字号：改 delta（标题字号 = 固定 px + delta），与正文互不影响
      const headDelta = clamp(s.headingSizeDelta, -6, 12, 0);
      if (headDelta !== 0) {
        decls.push(root + '{--dsh-content-font-delta:' + (headDelta > 0 ? '+' : '')
          + headDelta + 'px !important}');
      }

      // ⑤ 行距：delta 只作用于标题，正文行高要单独给
      const lineDelta = clamp(s.lineHeightDelta, -20, 60, 0);
      if (lineDelta !== 0) {
        const extra = Math.round(24 * lineDelta / 100);
        decls.push(root + '{--dsh-content-font-delta-secondary:' + (extra > 0 ? '+' : '')
          + extra + 'px !important}');
        decls.push('[class*="_markdown_" i]{line-height:calc(24px + ' + (extra > 0 ? '+' : '')
          + extra + 'px) !important}');
      }

      // ⑥ 正文加粗。0 = 不动（沿用主题自己的 400/600 规则）
      const weight = clamp(s.fontWeight, 0, 700, 0);
      if (weight > 0) {
        /*
         * ⚠️ 只给「段落级」元素加粗，不要用通配符 ——
         * 通配会把 h1..h6、strong 的既定字重也压平，标题就没了层次。
         */
        decls.push('[class*="_markdown_" i] :where(p,li,td,th,blockquote)'
          + '{font-weight:' + weight + ' !important}');
      }

      /*
       * ⑦⑧ 字体覆盖层（2026-10-25 加）：正文 / 标题各一套。
       *
       * 设计意图：界面字体（①）是「打底」，覆盖层是「局部改」。
       *   · 都不填 → 一切跟随界面字体
       *   · 只填正文 → 正文换字体，标题仍是界面字体
       *   · 只填标题 → 标题换字体，正文仍是界面字体
       *   · 两个都填 → 各自独立
       *
       * ⚠️ 选择器要点：
       *   正文 = 所有「非标题」的文字。不能写 `[class*="_markdown_"] p` 就算完，
       *          因为列表项、表格单元、引用块都不在 p 里，会漏掉。
       *          这里用「容器设字体 + 标题再覆盖」两步走：
       *            先把整个 markdown 容器的 family 设成正文体，
       *            再把 h1..h6 单独设成标题体。
       *          这样任何层级都继承到正文体，只有标题被特殊化 —— 不需要穷举标签。
       *   标题 = h1..h6。DSH 用 `:where(h5,h6)` 也会命中，所以六个都列上。
       *
       * 这两个覆盖层用独立的规则、不加 !important 到父容器上，
       * 避免和界面字体那条 `body{font-family:...!important}` 打架：
       * 子元素自己的声明本来就优先于 body 的继承值，不加 flag 也能赢。
       */
      const bodyFamily = fontStackOf(s.bodyFont);
      /*
       * 标题字体：不提供开关（理由见面板那段注释 —— 侧边栏标题与 markdown 标题
       * 都取 --dsw-font-family，和「界面字体」是同一个来源）。
       * 但若配置里残留了 headingFont（老版本写的），仍然尊重它：
       * 有值就覆盖标题，没有就自然继承界面字体。
       */
      const headingFamily = fontStackOf(s.headingFont);

      // 正文体：给 markdown 容器设，标题稍后单独覆盖
      if (bodyFamily) {
        decls.push('[class*="_markdown_" i]{font-family:' + bodyFamily + ' !important}');
        /*
         * 用户消息用的是另一套渲染，不叫 _markdown_，要单独覆盖。
         * ⚠️ 用宿主原生的 data-chat-flow-kind 定位，不要用本插件的 [data-cav-row]：
         * 那个标记只有头像层开着时才存在，字体不能依赖头像开关。
         */
        decls.push('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]'
          + '{font-family:' + bodyFamily + ' !important}');
      }

      // 标题体：优先级最高，排在正文体之后
      if (headingFamily) {
        decls.push('[class*="_markdown_" i] :where(h1,h2,h3,h4,h5,h6)'
          + '{font-family:' + headingFamily + ' !important}');
      }

      /*
       * ⑨ [本地补丁 2026-11-01] 字色规则搬到这里 —— 原来写在 STYLES 里，是个 bug。
       *
       * 原来的问题：字色那条 `color: var(--cav-text-color, inherit)` 挂在 STYLES
       * （主样式节点，插件加载即创建、永不删除），而 --cav-text-color 变量由
       * 「字体」开关控制。于是**关掉字体开关**后：
       *   · 变量被 removeProperty 移除了 ✓
       *   · 但规则还在，`var(--cav-text-color, inherit)` 回落到 inherit ✗
       *   · 结果所有 AI 回复元素的 color 被设成 inherit，
       *     把主题给表格/链接/徽章/diff 行等元素的语义色**全部抹掉**。
       *
       * 现在：只有字色真有值时才输出规则。空值 = 不输出 = 完全不介入，
       * 主题说了算。关字体开关 = buildFontCss 整体被 clearFontStyle 移除，
       * 字色规则随之消失，逐字节回到原生外观。
       *
       * 同时补上原注释（旧第 728-729 行）承诺却没实现的排除项：
       * 链接、徽章、diff 增删行、文件变更卡片等「行内彩色语义元素」不该被刷色，
       * 它们各有状态色令牌，改字色会让「红=错误、绿=成功」这类约定失效。
       */
      const textColor = hexOf(s.textColor);
      const userTextColor = hexOf(s.userTextColor);

      if (textColor) {
        decls.push('body [data-chat-flow-kind="assistant-step"] *:not('
          + 'pre, pre *, code, code *, kbd, samp,'
          + '[data-chat-group-part="reasoning"], [data-chat-group-part="reasoning"] *,'
          + '[data-chat-flow-kind="turn-process"], [data-chat-flow-kind="turn-process"] *,'
          + '[data-chat-call-id], [data-chat-call-id] *,'
          + '.cav-avatar, .cav-avatar *,'
          // ↓ 2026-11-01 新增：保留主题语义色的行内元素
          + 'a,'
          + '[class*="badge" i], [class*="badge" i] *,'
          + '[class*="label-" i],'
          + '[class*="diff-" i], [class*="diff-" i] *,'
          + '[class*="state-" i],'
          + '[data-chat-group-part="file-change"], [data-chat-group-part="file-change"] *'
          + '){color:' + textColor + '}');
        decls.push('body [data-chat-flow-kind="assistant-step"]'
          + '{color:' + textColor + '}');
      }

      if (userTextColor) {
        decls.push('body [data-chat-flow-kind="user"] *:not('
          + 'pre, pre *, code, code *, kbd, samp,'
          + '.cav-avatar, .cav-avatar *,'
          + 'a,'
          + '[class*="badge" i], [class*="badge" i] *,'
          + '[class*="state-" i]'
          + '),'
          + 'body [data-chat-flow-kind="steering"] *:not('
          + 'pre, pre *, code, code *, kbd, samp,'
          + '.cav-avatar, .cav-avatar *,'
          + 'a,'
          + '[class*="badge" i], [class*="badge" i] *,'
          + '[class*="state-" i]'
          + '){color:' + userTextColor + '}');
        decls.push('body [data-chat-flow-kind="user"],'
          + 'body [data-chat-flow-kind="steering"]'
          + '{color:' + userTextColor + '}');
      }

      return decls.join('\n');
    }

    /**
     * 把字体样式写进 / 更新 / 移除。
     *
     * 用单独一个 <style> 节点而不是塞进 STYLES：
     * 设置一变只要替换这一个节点的内容，不用重建整套插件样式。
     */
    function syncFontStyle() {
      const s = getSettings();
      const css = buildFontCss(s);
      let node = document.getElementById(FONT_STYLE_ID);
      if (css === '') {
        if (node) node.remove();
        return;
      }
      if (!node) {
        node = document.createElement('style');
        node.id = FONT_STYLE_ID;
        node.dataset.plugin = 'dsh-avatar-font';
        document.head.appendChild(node);
      }
      if (node.textContent !== css) node.textContent = css;
    }

    /** 关掉插件时清掉字体样式，逐字节回到原生外观。 */
    function clearFontStyle() {
      const node = document.getElementById(FONT_STYLE_ID);
      if (node) node.remove();
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    const STYLES = `
/* 会话里的头像：行改成横向 flex，头像与消息并排；用户行反过来 ⇒ 你的消息在右、助手在左 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] { display: flex; align-items: flex-start; gap: 8px; }
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="user"] { flex-direction: row-reverse; }
/* ⚠️ 只把「非头像的直接子元素」设成可压缩。别扩大这条规则的作用范围。
   历史教训：曾经想用 CSS 单独照顾思考行，但正确解法是**根本不装饰思考行**
   （见 decorateRow 里的 isProcessRow/stripRow），思考行不会带 data-cav-row 标记，
   因此下面这条永远只作用在真正被装饰的行上。保留此注释以免以后又去猜 CSS。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] > :not(.${AVATAR_NODE_CLASS}) { flex: 1 1 auto; min-width: 0; }
.${AVATAR_NODE_CLASS} {
  box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  width: var(${VAR_SIZE}, 40px); height: var(${VAR_SIZE}, 40px);
  border-radius: calc(var(${VAR_ROUND}, 100) * 0.5%);
  overflow: hidden; position: relative;
  color: var(--dsw-alias-label-secondary, currentColor);
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.16));
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
}
/* 跟随滚动：top 由 JS 写入（行顶滚出可视区就贴顶跟随，行快滚完则停行尾） */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] > .${AVATAR_NODE_CLASS} { align-self: flex-start; }
.${AVATAR_NODE_CLASS}__img { display: block; width: 100%; height: 100%; object-fit: cover; }
.${AVATAR_NODE_CLASS}__glyph { display: flex; align-items: center; justify-content: center; }
.${AVATAR_NODE_CLASS}__glyph svg { width: 62%; height: 62%; }

/* ── [本地补丁 · 正文字色] ──────────────────────────────────────────────────
   只改 AI 回复的**正文文字**颜色，代码与思考内容一律不动。

   实现思路（为什么不直接给元素上 color）：
   宿主把正文颜色写成 color: var(--dsw-alias-label-primary)。所以这里
   **在正文容器上重定义这个变量**，正文里所有继承颜色的文字（段落、标题、
   列表、粗体、斜体）自然全部跟随，不用逐个元素点名。
   这比「* { color }」安全得多 —— 后者会连图标、边框、按钮一起改。

   生效条件：JS 把颜色写进 --cav-text-color，只有它存在时下面才覆盖。
   清空设置 = 移除变量 = 完全回到主题原样（用 initial 复位而不是删规则）。

   三条「不管」的边界，每条都有理由：

     ① 代码：pre / code / kbd / samp。
        宿主 shiki 语法高亮给每个 token 自带颜色，但代码块的**默认前景与底色**
        若被继承色污染，在深色代码块上会出现看不清的暗字。
        所以显式把它们的颜色复原成宿主令牌，不参与变字色。

     ② 思考区：[data-chat-group-part="reasoning"] 整棵子树排除。
        判定依据与 isProcessRow() 一致（宿主就是这么标的），两处不能各写各的。

     ③ 工具调用：[data-chat-flow-kind="turn-process"]、工具卡片
        （[data-chat-call-id]）一律排除。

   还**不碰**行内彩色语义元素（徽章、标签、diff 增删行）—— 它们各有状态色
   令牌，改字色会让「红=错误、绿=成功」这类约定失效。

   写法说明：这里**只覆盖 color 这一个属性**，不改任何主题令牌
   （--dsw-alias-label-primary 原样不动）。父级 color 一变，正文里所有
   「没有自己 color 声明」的文字（段落/标题/列表/粗体）自动继承，这正是想要的；
   而 shiki 给代码 token 写的是自带颜色，不受父级影响。
   代码、思考区、工具调用则显式复原成宿主令牌 ⇒ 回到主题原样。
   清空设置 = 移除 --cav-text-color 变量 = 下面整条规则不产生作用。

   ⚠️ 只作用于 AI 侧的行（data-chat-flow-kind="assistant-step"），用户自己的消息不动 ——
   这是需求原话「只改 AI 回复的字色」。
   ⚠️ v2.0 改：这里**不再**依赖本插件自己打的 [data-cav-row] 标记。
   那个标记只有头像层开着时才存在，而字色现在归「字体」开关管 ——
   两件事必须解耦，否则「关头像、留字体」时字色会跟着失效。
   所以改用宿主原生的 data-chat-flow-kind，它是宿主自己写在行上的，永远在。

   ⚠️⚠️ 2026-10-25 修的第二个坑：只写在「直接子元素」上【不管用】。
   宿主的正文组件 AssistantMarkdown 自己在根容器上写死了
     .v5IAXa_root { color: var(--dsw-alias-label-primary) }
   —— 这是一个「显式声明」，会**截断继承**。所以设在外层父元素上的 color
   传不进去，界面上文字一动不动。
   正确做法：把用户色下发到**整棵子树**，而不是只给最外层。

   但通配符会连代码块里的语法高亮 token 一起改（shiki 给每个 token 上色），
   所以用 :not() 在**源头**就把不该碰的排除掉，而不是改完再复原。
   排除清单与下方说明一一对应：
     · pre / code / kbd / samp 及其所有后代（语法高亮）
     · 思考区、工具调用的整棵子树
     · ⚠️ 头像自身及其后代（.cav-avatar / .cav-avatar *）——
       2026-10-25 踩过：头像 SVG 用 stroke="currentColor"，被这条 color 规则
       命中后图标被染色，连带影响头像的视觉尺寸/观感（表现为「头像变得很大」）。
       头像的外观只该由 --cav-size / --cav-round 控制，不该受字色影响。 */
/* ⚠️ 2026-11-01 [本地补丁] 上面这条字色规则已【移到 buildFontCss()】。
   原因：它挂在 STYLES（主样式节点，插件加载即建、永不删除），而 --cav-text-color
   变量由「字体」开关控制。关掉字体开关后变量被移除、规则还在，
   var(--cav-text-color, inherit) 回落到 inherit，把主题给表格/链接/徽章/diff 行
   等元素的语义色全部抹掉 —— 这正是大王看到的「主题颜色没了」。
   现在字色只在真有值时才由 buildFontCss 输出，关开关即整体消失。
   原规则（历史参考）：
     body [data-chat-flow-kind="assistant-step"] *:not(pre,pre *,code,code *,kbd,samp,
       [data-chat-group-part="reasoning"],...){color:var(--cav-text-color,inherit)}
     body [data-chat-flow-kind="assistant-step"]{color:var(--cav-text-color,inherit)}
*/
/* ⚠️ 这里【故意不写】头像的 width/height。
   头像尺寸的唯一真相是上面 .cav-avatar 那条规则里的 var(--cav-size)。
   2026-10-25 事故的教训：我在这个位置补了一条「兜底尺寸」，
   结果是同属性出现两处声明、又和气泡的 max-width 搅在一起，
   头像被撑成一大块。**一个属性只能有一个声明来源**，需要加固就改原规则。 */
/* 注意：这里【不需要】再写一条「把代码/思考区复原」的规则。
   2026-10-25 的写法是在源头用 :not() 排除，被排除的节点压根没被碰过，
   它们的颜色仍是宿主自己的值。此前那两条「事后复原」规则会造成
   同特异性冲突（谁在后面谁赢），反而让行为不确定，故删除。 */

/* ── [本地补丁 · 用户消息字色] ──────────────────────────────────────────────
   ⚠️ 2026-11-01 同样已移到 buildFontCss()，理由见上。原规则：
     body [data-chat-flow-kind="user"] *:not(...),
     body [data-chat-flow-kind="steering"] *:not(...){color:var(--cav-user-text-color,inherit)}
     body [data-chat-flow-kind="user"],body [data-chat-flow-kind="steering"]{color:var(--cav-user-text-color,inherit)}
*/
.cav-card{border:1px solid var(--dsw-alias-border-l1,#555);border-radius:10px;padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02))}
.cav-card-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.cav-card-title{font-weight:600}
.cav-card-hint{color:var(--dsw-alias-label-secondary,#999);font-size:12px;margin-top:2px}
.cav-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25))}
.cav-row:first-of-type{border-top:none}
.cav-label{color:var(--dsw-alias-label-primary,#ddd)}
.cav-hint{color:var(--dsw-alias-label-secondary,#999);font-size:12px;margin-top:2px}
.cav-group{display:flex;align-items:center;gap:8px}
.cav-btn{display:inline-flex;align-items:center;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.cav-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.cav-btn[disabled]{opacity:.5;cursor:not-allowed}
.cav-range{width:120px;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
/* 依赖别的开关才有意义的滑杆（如「吸顶下移」依赖「头像跟随画面」）置灰时给个视觉提示 */
.cav-range:disabled{opacity:.45;cursor:not-allowed}
/* [本地补丁] 气泡颜色选择器 */
.cav-color{width:38px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1,#555);border-radius:6px;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);cursor:pointer}
/*
 * [本地补丁] 字体下拉框。原生 <select> 在各平台长得不一样，这里统一成
 * 和 .cav-btn 同款的方块，避免在深色主题下变成一块刺眼的白。
 * 宽度给足，因为中文字体名 + 括号说明比较长。
 */
.cav-select{
  font:inherit;font-size:12.5px;line-height:1.2;
  min-width:210px;max-width:100%;
  padding:6px 8px;border-radius:7px;cursor:pointer;
  color:var(--dsw-alias-label-primary,#ddd);
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  border:1px solid var(--dsw-alias-border-l1,#555);
}
.cav-select:hover{border-color:var(--dsw-alias-border-l2,#777)}
.cav-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4a9eff)}
/* 下拉展开的选项也要跟着深色，否则 Windows 上会闪白底黑字 */
.cav-select option{
  color:var(--dsw-alias-label-primary,#ddd);
  background:var(--dsw-alias-bg-overlay,#252525);
}
.cav-val{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary,#999)}
.cav-toggle{position:relative;width:38px;height:22px;flex:none;cursor:pointer}
.cav-toggle input{opacity:0;width:0;height:0}
.cav-toggle .track{position:absolute;inset:0;border-radius:11px;transition:background .16s;
  background:var(--dsw-alias-label-tertiary,#8a8a8a);border:1px solid var(--dsw-alias-border-l1,#666)}
.cav-toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-bg-overlay,#f2f2f2);transition:left .16s;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.cav-toggle input:checked + .track{background:var(--dsw-alias-brand-primary,#4a9eff);border-color:transparent}
.cav-toggle input:checked + .track::after{left:18px}
.cav-preview{width:44px;height:44px;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-overlay,#222);color:var(--dsw-alias-label-secondary,#999)}
.cav-preview-empty{font-size:10px;border-style:dashed;color:var(--dsw-alias-label-tertiary,#888)}
.cav-status{font-size:12px;color:var(--dsw-alias-state-error-primary,#e05252);min-height:16px}

/*
 * ── 裁剪弹窗（v2.1.0）────────────────────────────────────────────────────
 * 遮罩用 position:fixed + 极高 z-index：设置面板可能是某个 modal 的后代，
 * 普通的 z-index 会被压住。若宿主祖先带 transform/filter，fixed 会改基准、
 * 弹窗可能被裁 —— 所以能拿到 react-dom 时优先走 createPortal 挂到 body，
 * 拿不到才退回这层 fixed（见 CropDialog 末尾的 canPortal 分支）。
 */
.cav-crop-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:16px;box-sizing:border-box;background:rgba(0,0,0,.62)}
.cav-crop-dialog{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;gap:10px;
  padding:14px 16px 12px;box-sizing:border-box;border-radius:12px;
  background:var(--dsw-alias-bg-overlay,#252525);border:1px solid var(--dsw-alias-border-l1,#555);
  color:var(--dsw-alias-label-primary,#ddd);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.cav-crop-title{font-weight:600;font-size:13px}
.cav-crop-tip{font-size:12px;color:var(--dsw-alias-label-secondary,#999);margin-top:3px;line-height:1.5}
.cav-crop-stage{position:relative;width:100%;height:320px;overflow:hidden;border-radius:8px;
  background:#111;touch-action:none;user-select:none;-webkit-user-select:none}
.cav-crop-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;
  user-select:none;-webkit-user-drag:none}
.cav-crop-box{position:absolute;box-sizing:border-box;border:1.5px solid #fff;cursor:grab;
  /* 框外压暗：一个超大 box-shadow 让四周变黑，被 stage 的 overflow:hidden 裁齐。
     比摆四个半透明 div 省事，也不会在缩放时露缝。 */
  box-shadow:0 0 0 9999px rgba(0,0,0,.58);}
.cav-crop-box:active{cursor:grabbing}
.cav-crop-grid{position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(to right,rgba(255,255,255,.26) 1px,transparent 1px),
                   linear-gradient(to bottom,rgba(255,255,255,.26) 1px,transparent 1px);
  background-size:33.3333% 33.3333%}
.cav-crop-row{display:flex;align-items:center;gap:10px}
.cav-crop-row .cav-crop-range{flex:1;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
.cav-crop-actions{display:flex;justify-content:flex-end;gap:8px}
.cav-btn-primary{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
`;

    // ── 设置面板 ────────────────────────────────────────────────────────────
    function useSettings() {
      const [, force] = react.useState(0);
      react.useEffect(() => subscribe(() => force((n) => n + 1)), []);
      return getSettings();
    }
    function Toggle({ checked, onChange }) {
      return react.createElement('label', { className: 'cav-toggle' },
        react.createElement('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }),
        react.createElement('span', { className: 'track' }));
    }
    function Row({ label, hint, children }) {
      return react.createElement('div', { className: 'cav-row' },
        react.createElement('div', null,
          react.createElement('div', { className: 'cav-label' }, label),
          hint ? react.createElement('div', { className: 'cav-hint' }, hint) : null),
        react.createElement('div', { className: 'cav-group' }, children));
    }

    /**
     * 把原图上的一块正方形裁出来，缩到 <=512px 再编码。
     * rect 用的是**原图自然像素**坐标（显示坐标→自然坐标的换算在 CropDialog 里完成）。
     *
     * 为什么只裁正方形、不做自由矩形：头像最终渲染在正方形框里（object-fit:cover），
     * 非正方形的结果会被二次裁切，用户框好的构图反而保不住。
     * 至于显示成圆还是方，由「圆角」滑块决定，跟这里无关。
     */
    function cropAndEncode(file, rect) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          // 浮点误差可能让源矩形差半像素探出边界，这里再夹一次，保证 drawImage 不越界
          const x = Math.max(0, Math.min(nw - 1, Math.round(rect.x)));
          const y = Math.max(0, Math.min(nh - 1, Math.round(rect.y)));
          const side = Math.max(1, Math.min(Math.round(rect.side), nw - x, nh - y));
          const out = Math.max(1, Math.min(CROP_OUT_MAX, side));
          const c = document.createElement('canvas');
          c.width = out;
          c.height = out;
          const g = c.getContext('2d');
          g.drawImage(img, x, y, side, side, 0, 0, out, out);
          const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          c.toBlob((blob) => {
            if (blob) resolve({ blob, type: blob.type || type });
            else reject(new Error('裁剪失败'));
          }, type, 0.92);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
        img.src = url;
      });
    }

    /** 能不能用 createPortal（决定裁剪弹窗挂 body 还是就地 fixed 渲染）。 */
    const canPortal = !!(reactDom && typeof reactDom.createPortal === 'function'
      && typeof document !== 'undefined' && document.body);

    /**
     * 裁剪弹窗：选中文件后先在这里框一块正方形，点「确定」才真正上传。
     *
     * 全程只有两套坐标，别混：
     *   显示坐标 = 舞台上看到的位置（box.x / box.y / box.side，单位 px）
     *   自然坐标 = 原图像素（发给 cropAndEncode 的 rect）
     * fit 就是这两套之间的换算：contain 缩放 + 居中留白。
     */
    function CropDialog({ file, onCancel, onConfirm }) {
      const stageRef = react.useRef(null);
      const [src, setSrc] = react.useState('');
      const [nat, setNat] = react.useState(null);
      const [stage, setStage] = react.useState({ w: 0, h: 0 });
      const [box, setBox] = react.useState(null);
      const drag = react.useRef(null);

      /* 换文件即换 objectURL；卸载时一定要 revoke，否则每选一次图漏一份内存 */
      react.useEffect(() => {
        const u = URL.createObjectURL(file);
        setSrc(u);
        return () => URL.revokeObjectURL(u);
      }, [file]);

      /* 舞台尺寸：布局后量一次，之后交给 ResizeObserver 跟（拉窗口 / 面板变宽） */
      react.useEffect(() => {
        const el = stageRef.current;
        if (!el) return undefined;
        const measure = () => {
          const r = el.getBoundingClientRect();
          /*
           * 尺寸没变就必须返回原对象。别小看这一步：
           *   stage 换引用 ⇒ fit(useMemo) 重算 ⇒ 下面「给框初值」的 effect 重跑
           *   ⇒ 用户拖到一半的框被打回正中央。
           * ResizeObserver 在布局抖动时可能反复回调，不挡住这条链就真会踩到。
           */
          setStage((prev) => (
            Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
              ? prev
              : { w: r.width, h: r.height }
          ));
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(measure);
          ro.observe(el);
          return () => ro.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, []);

      /* Esc 取消。捕获阶段监听，免得被宿主的快捷键处理先吃掉 */
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
      }, [onCancel]);

      /* contain 之后，图片在舞台里实际占的矩形（含居中留白） */
      const fit = react.useMemo(() => {
        if (!nat || !stage.w || !stage.h) return null;
        const scale = Math.min(stage.w / nat.w, stage.h / nat.h);
        const w = nat.w * scale;
        const h = nat.h * scale;
        return { scale, w, h, x: (stage.w - w) / 2, y: (stage.h - h) / 2 };
      }, [nat, stage]);

      /* 图片尺寸一出来就给初值：最大内接正方形收一点（86%） */
      react.useEffect(() => {
        if (!fit) return;
        const maxSide = Math.min(fit.w, fit.h);
        const side = Math.max(CROP_MIN_SIDE, Math.round(maxSide * 0.86));
        setBox({ side, x: fit.x + (fit.w - side) / 2, y: fit.y + (fit.h - side) / 2 });
      }, [fit]);

      /* 把框夹回图片范围内 —— 拖动和改大小都必须过这一关 */
      const clampBox = (b) => {
        if (!fit) return b;
        const maxSide = Math.min(fit.w, fit.h);
        const side = Math.max(CROP_MIN_SIDE, Math.min(maxSide, Math.round(b.side)));
        const x = Math.max(fit.x, Math.min(fit.x + fit.w - side, b.x));
        const y = Math.max(fit.y, Math.min(fit.y + fit.h - side, b.y));
        return { x, y, side };
      };

      const onDown = (e) => {
        if (!box) return;
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        drag.current = { px: e.clientX, py: e.clientY, bx: box.x, by: box.y };
      };
      const onMove = (e) => {
        const d = drag.current;
        if (!d || !box) return;
        setBox(clampBox({ side: box.side, x: d.bx + (e.clientX - d.px), y: d.by + (e.clientY - d.py) }));
      };
      const onUp = (e) => {
        drag.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      };

      /* 改大小以「框中心」为锚点，否则拖滑杆时框会往一边跑 */
      const maxSide = fit ? Math.min(fit.w, fit.h) : CROP_MIN_SIDE;
      const span = Math.max(1, maxSide - CROP_MIN_SIDE);
      const sideRatio = box ? Math.max(0, Math.min(1, (box.side - CROP_MIN_SIDE) / span)) : 1;
      const onRatio = (e) => {
        if (!box) return;
        const v = Number(e.target.value);
        const side = Math.round(CROP_MIN_SIDE + span * v);
        const cx = box.x + box.side / 2;
        const cy = box.y + box.side / 2;
        setBox(clampBox({ side, x: cx - side / 2, y: cy - side / 2 }));
      };

      const ok = () => {
        if (!fit || !box) return;
        onConfirm({
          x: (box.x - fit.x) / fit.scale,
          y: (box.y - fit.y) / fit.scale,
          side: box.side / fit.scale,
        });
      };

      const inner = react.createElement('div', { className: 'cav-crop-mask', onClick: onCancel },
        react.createElement('div', {
          className: 'cav-crop-dialog',
          onClick: (e) => e.stopPropagation(),   // 点面板内部不该关窗
        },
          react.createElement('div', null,
            react.createElement('div', { className: 'cav-crop-title' }, '选择要用的部分'),
            react.createElement('div', { className: 'cav-crop-tip' },
              '拖动白框选位置，滑杆改大小。头像只取框内的正方形；显示成圆的还是方的，由上面的「圆角」决定。')),
          react.createElement('div', { className: 'cav-crop-stage', ref: stageRef },
            src ? react.createElement('img', {
              className: 'cav-crop-img',
              src,
              alt: '',
              onLoad: (e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight }),
              onError: () => setNat(null),
            }) : null,
            box ? react.createElement('div', {
              className: 'cav-crop-box',
              style: { left: box.x + 'px', top: box.y + 'px', width: box.side + 'px', height: box.side + 'px' },
              onPointerDown: onDown, onPointerMove: onMove,
              onPointerUp: onUp, onPointerCancel: onUp,
            }, react.createElement('div', { className: 'cav-crop-grid' })) : null),
          react.createElement('div', { className: 'cav-crop-row' },
            react.createElement('span', { className: 'cav-hint' }, '小'),
            react.createElement('input', {
              className: 'cav-crop-range', type: 'range',
              min: 0, max: 1, step: 0.01,
              value: String(sideRatio),
              onChange: onRatio,
            }),
            react.createElement('span', { className: 'cav-hint' }, '大')),
          react.createElement('div', { className: 'cav-crop-actions' },
            react.createElement('span', { className: 'cav-btn', onClick: onCancel }, '取消'),
            react.createElement('span', {
              className: 'cav-btn cav-btn-primary',
              onClick: ok,
              // 图片还没量出尺寸时不给确认，否则会算出无效 rect
              style: fit ? undefined : { opacity: .5, pointerEvents: 'none' },
            }, '确定'))));

      return canPortal ? reactDom.createPortal(inner, document.body) : inner;
    }

    function AvatarCard({ side, title, hint, onStatus }) {
      const fileRef = react.useRef(null);
      const available = hasAvatar(side);
      const [busy, setBusy] = react.useState(false);
      /** 选好但还没裁的文件；非空 = 裁剪弹窗开着。 */
      const [pending, setPending] = react.useState(null);

      /** 真正的上传：裁好的 blob 交给宿主存盘。裁剪和它分开是为了能单独重试。 */
      const upload = async (blob, type) => {
        const res = await fetch(`${API}/avatar/${side}`, {
          method: 'POST',
          headers: { 'content-type': type },
          body: blob,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) throw new Error(d.error || ('HTTP ' + res.status));
        /*
         * 先把 POST 响应里的「新版本 + 已可用」立刻落地，再去补读一次 /settings。
         * 只认 /settings 那一次读取的话，它慢一步或失败就表现成"点了没反应"。
         * applyAvatarState 会换掉 avatarVer ⇒ avatarUrl 跟着变 ⇒ 新图立即出现。
         */
        applyAvatarState(d);
        notify();
        const st = await fetchJson('/settings').catch(() => null);
        if (st) applyResponse(st);
      };

      /** 选文件 → 不直接上传，先弹裁剪框让用户定构图。 */
      const onPick = (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';           // 清掉，同一个文件再选一次也能触发 change
        if (!file) return;
        onStatus('');
        setPending(file);
      };

      const onCropConfirm = async (rect) => {
        const file = pending;
        setPending(null);
        setBusy(true);
        try {
          const { blob, type } = await cropAndEncode(file, rect);
          await upload(blob, type);
        } catch (err) {
          onStatus('上传失败：' + String(err.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const onClear = async () => {
        setBusy(true);
        try {
          const res = await fetch(`${API}/avatar/${side}`, { method: 'DELETE' });
          const d = await res.json().catch(() => ({}));
          applyAvatarState(d);
          notify();
          const st = await fetchJson('/settings').catch(() => null);
          if (st) applyResponse(st);
        } catch (err) {
          onStatus('清除失败：' + String(err.message ?? err));
        } finally {
          setBusy(false);
        }
      };
      const preview = available
        ? react.createElement('img', {
            className: 'cav-preview',
            // 这里也必须走 avatarUrl：直接拼裸地址会命中 immutable 缓存，换图后预览不变
            src: avatarUrl(side),
            alt: title + '预览',
            style: { borderRadius: roundOf() >= 100 ? '50%' : Math.round(roundOf() / 4) + '%' },
          })
        : react.createElement('div', { className: 'cav-preview cav-preview-empty' }, '未上传');
      const card = react.createElement('div', { className: 'cav-card' },
        react.createElement('div', { className: 'cav-card-head' },
          react.createElement('div', null,
            react.createElement('div', { className: 'cav-card-title' }, title),
            react.createElement('div', { className: 'cav-card-hint' }, hint)),
          preview),
        react.createElement(Row, { label: '上传图片', hint: 'PNG / JPG / WebP，选中后可框选裁剪，缩到 512px 内' },
          react.createElement('span', { className: 'cav-btn', onClick: () => fileRef.current?.click() },
            busy ? '处理中…' : (available ? '替换图片…' : '选择图片…')),
          react.createElement('input', {
            ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp',
            style: { display: 'none' }, onChange: onPick,
          })),
        available ? react.createElement(Row, { label: '清除', hint: '恢复为内置默认头像' },
          react.createElement('span', { className: 'cav-btn', onClick: onClear }, '清除')) : null);

      // 弹窗挂在 card 之外：它要么走 portal 进 body，要么就地 fixed，都不该被卡片裁掉
      return react.createElement(react.Fragment, null, card,
        pending ? react.createElement(CropDialog, {
          file: pending,
          onCancel: () => setPending(null),
          onConfirm: onCropConfirm,
        }) : null);
    }

    function AvatarPanel() {
      const st = useSettings();
      const [status, setStatus] = react.useState('');
      const aOn = avatarOn();
      const fOn = fontOn();
      return react.createElement('div', { className: 'cav-panel' },
        /*
         * ── 头像（v2.0 独立开关）────────────────────────────────────────────
         * 关掉只撤头像层：注入的头像节点、行标记、body 上的尺寸变量全部还原，
         * 字体设置照常生效。反过来关字体也一样不动头像。
         * 没有「总开关」——插件本身的启停归「插件管理」，这里不再重复一次。
         */
        react.createElement('div', { className: 'cav-card' },
          react.createElement(Row, { label: '头像', hint: aOn ? '显示在每条消息旁' : '已关闭，消息按原生排版' },
            react.createElement(Toggle, {
              checked: aOn,
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, avatar: v } }),
            })),
          aOn ? react.createElement(Row, { label: '头像大小', hint: `${CLAMP_SIZE.min} – ${CLAMP_SIZE.max} px` },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: CLAMP_SIZE.min, max: CLAMP_SIZE.max, step: 1, value: sizeOf(),
              onChange: (e) => saveSettings({ avatarSize: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, sizeOf() + ' px')) : null,
          aOn ? react.createElement(Row, { label: '圆角强度', hint: '100% = 正圆，0% = 直角方形' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: CLAMP_ROUND.min, max: CLAMP_ROUND.max, step: 1, value: roundOf(),
              onChange: (e) => saveSettings({ avatarRadius: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, roundOf() + ' %')) : null,
          /*
           * 头像跟随滚动（v1.0）：关掉后头像只固定在每条消息的开头，
           * 长回复往下翻时它随行一起滚走，不再贴住滚动区顶部跟着走。
           * 下面的「吸顶下移」只在开着时有意义，所以顺手置灰，避免调了没反应像是坏了。
           */
          aOn ? react.createElement(Row, { label: '跟随画面', hint: '关掉后头像只固定在消息开头，不再跟着滑动' },
            react.createElement(Toggle, {
              checked: stickFollowOf(),
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, stickFollow: v } }),
            })) : null,
          aOn ? react.createElement(Row, {
            label: '吸顶下移',
            hint: stickFollowOf() ? '翻页时下滑几个身位，避开主题状态栏' : '先打开「跟随画面」才有效',
          },
          react.createElement('input', {
            className: 'cav-range', type: 'range',
            min: 0, max: 6, step: 1, value: stickOffsetOf(),
            disabled: !stickFollowOf(),
            onChange: (e) => saveSettings({ plugin: { ...st.plugin, stickOffset: Number(e.target.value) } }),
          }),
          react.createElement('span', { className: 'cav-val' }, stickOffsetOf() + ' 个')) : null),
        aOn ? react.createElement(AvatarCard, { side: 'ai', title: 'AI 头像', hint: '显示在助手消息的左侧', onStatus: setStatus }) : null,
        aOn ? react.createElement(AvatarCard, { side: 'user', title: '我的头像', hint: '显示在你的消息右侧', onStatus: setStatus }) : null,

        /*
         * ── 字体（v2.0 独立开关）────────────────────────────────────────────
         * 字体走独立的 <style> 节点，和头像层完全解耦：关掉头像照样能换字体。
         * 字色（正文字色 / 我的消息字色）也归在这里 —— 它们是「文字外观」的一部分。
         */
        react.createElement('div', { className: 'cav-card' },
          react.createElement(Row, { label: '字体', hint: fOn ? '字体、字号、行距与字色' : '已关闭，使用主题默认' },
            react.createElement(Toggle, {
              checked: fOn,
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, font: v } }),
            })),

          /*
           * 字体清单只列本机确实装了的 —— 列一堆没装的字体，选了没反应，
           * 用户会以为功能坏了（这是 dsh-fonttune 原版的问题，这里避开）。
           */
          fOn ? react.createElement(Row, {
            label: '界面字体',
            hint: familyOf() ? '点右侧可恢复主题字体' : '当前系统默认',
          },
          react.createElement('select', {
            className: 'cav-select',
            value: familyOf(),
            onChange: (e) => saveSettings({ fontFamily: e.target.value }),
          }, FONT_FAMILIES.map((f) => react.createElement('option', {
            key: f.value, value: f.value,
          }, f.label)))) : null,

          /*
           * 字体覆盖层：正文 / 标题各一套。
           * 默认项写「跟随界面字体」而不是「主题默认」—— 因为这里是覆盖层，
           * 不填就等于用上面那套界面字体，不是回到系统默认。
           */
          fOn ? react.createElement(Row, {
            label: '正文字体',
            hint: bodyFontOf() ? '覆盖界面字体，只作用于正文' : '跟随界面字体',
          },
          react.createElement('select', {
            className: 'cav-select',
            value: bodyFontOf(),
            onChange: (e) => saveSettings({ bodyFont: e.target.value }),
          }, [{ label: '跟随界面字体', value: '' }].concat(FONT_FAMILIES.slice(1)).map((f) => (
            react.createElement('option', { key: f.value, value: f.value }, f.label)
          )))) : null,

          /*
           * ⚠️ 面板里【不提供】「标题字体」。
           *
           * 依据（查 app.asar 逐条核对过）：
           *   markdown h1..h6  → font-family: var(--dsw-font-family)
           *   markdown 正文     → font-family: var(--dsw-font-family)
           *   侧边栏标题        → 没有任何自己的 font-family，继承 body
           * 三者最终都取同一个 --dsw-font-family，也就是「界面字体」。
           * 所以再做一个「标题字体」开关，等于把同一个变量换个名字卖第二次，
           * 不会产生任何区别于界面字体的效果 —— 故去掉。
           *
           * settings.headingFont 字段仍然保留在数据里（不删），
           * 老配置读进来不会报错；万一以后 DSH 拆出独立的标题字体令牌，
           * 这个字段还能直接用上。
           */
          fOn ? react.createElement(Row, { label: '代码字体', hint: '只影响代码块与行内代码' },
            react.createElement('select', {
              className: 'cav-select',
              value: fontMonoOf(),
              onChange: (e) => saveSettings({ fontMono: e.target.value }),
            }, MONO_FAMILIES.map((f) => react.createElement('option', {
              key: f.value, value: f.value,
            }, f.label)))) : null,

          fOn ? react.createElement(Row, { label: '正文字号', hint: '相对主题，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -4, max: 8, step: 1, value: fontSizeDeltaOf(),
              onChange: (e) => saveSettings({ fontSizeDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (fontSizeDeltaOf() > 0 ? '+' : '') + fontSizeDeltaOf() + ' px')) : null,

          fOn ? react.createElement(Row, { label: '标题字号', hint: '独立于正文，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -6, max: 12, step: 1, value: headingSizeDeltaOf(),
              onChange: (e) => saveSettings({ headingSizeDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (headingSizeDeltaOf() > 0 ? '+' : '') + headingSizeDeltaOf() + ' px')) : null,

          fOn ? react.createElement(Row, { label: '行距', hint: '相对主题，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -20, max: 60, step: 5, value: lineHeightDeltaOf(),
              onChange: (e) => saveSettings({ lineHeightDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (lineHeightDeltaOf() > 0 ? '+' : '') + lineHeightDeltaOf() + ' %')) : null,

          fOn ? react.createElement(Row, { label: '正文加粗', hint: '0 = 跟随主题；只加粗段落，不动标题' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 700, step: 50, value: fontBoldOf(),
              onChange: (e) => saveSettings({ fontWeight: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              fontBoldOf() === 0 ? '主题' : String(fontBoldOf()))) : null,

          /*
           * 正文字色：只改 AI 回复的正文文字。
           * 代码、思考区、工具调用不受影响（见 STYLES 里的边界说明）。
           * 这里**不做对比度校验**：选什么颜色是用户的选择，最多提示一句。
           */
          fOn ? react.createElement(Row, {
            label: '正文字色',
            hint: textColorOf() ? '只影响正文，代码与思考内容不变' : '空 = 跟随主题',
          },
          react.createElement('input', {
            type: 'color', className: 'cav-color',
            value: textColorOf() || '#e8e8ee',
            onChange: (e) => saveSettings({ textColor: e.target.value }),
          }),
          textColorOf()
            ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ textColor: '' }) }, '跟随主题')
            : react.createElement('span', { className: 'cav-val' }, '主题色')) : null,

          /*
           * 用户消息字色：只改你自己发出的消息文本。
           * 与「正文字色」同款做法，两边可以分别设成不同颜色。
           */
          fOn ? react.createElement(Row, {
            label: '我的消息字色',
            hint: userTextColorOf() ? '只影响你发出的消息' : '空 = 跟随主题',
          },
          react.createElement('input', {
            type: 'color', className: 'cav-color',
            value: userTextColorOf() || '#e8e8ee',
            onChange: (e) => saveSettings({ userTextColor: e.target.value }),
          }),
          userTextColorOf()
            ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ userTextColor: '' }) }, '跟随主题')
            : react.createElement('span', { className: 'cav-val' }, '主题色')) : null),
        react.createElement('div', { className: 'cav-status' }, status));
    }

    // ── 入口 ────────────────────────────────────────────────────────────────
    const inject = ['slots'];
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-avatar-font';
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => { style.remove(); };
      });
      ctx.effect(() => () => stopLayer());
      setLayerSync(() => {
        const b = body();
        const aOn = avatarOn();
        const fOn = fontOn();
        /*
         * ── 头像层 ──────────────────────────────────────────────────────────
         * 开：打 body 标记 + 写尺寸变量 + 起观察者。
         * 关：stopLayer() 会把注入的节点、行标记、body 标记与变量全部摘干净，
         *     逐字节回到宿主原生排版。
         */
        if (aOn) {
          if (b) {
            b.setAttribute(AVATAR_ATTR, 'on');
            b.style.setProperty(VAR_SIZE, sizeOf() + 'px');
            b.style.setProperty(VAR_ROUND, String(roundOf()));
          }
          startLayer();
          scheduleProcess();
          /*
           * [本地补丁 · v1.0] 开关切换后要让新状态**立刻**生效，不等下一次滚动：
           *   关 → 所有头像的 style.top 立刻清零（resetSticky）；
           *   开 → 立刻按当前滚动位置重算一次（scheduleSticky）。
           * 这两步都幂等，设置没变时不会产生多余写入。
           */
          if (stickFollowOf()) scheduleSticky(); else resetSticky();
        } else {
          stopLayer();
        }

        /*
         * ── 字体层 ──────────────────────────────────────────────────────────
         * 完全独立于头像层：字体样式有自己的 <style> 节点，头像关掉照样能换字体。
         * 字色（--cav-text-color / --cav-user-text-color）归在这里 ——
         * 它们是「文字外观」，不是「头像外观」。
         */
        if (fOn) {
          syncFontStyle();
          if (b) {
            // 空 = 移除变量 ⇒ CSS 那条 color 规则不生效，回到主题
            applyColorVar(b, '--cav-text-color', settings.textColor);
            applyColorVar(b, '--cav-user-text-color', settings.userTextColor);
          }
        } else {
          clearFontStyle();
          if (b) {
            b.style.removeProperty('--cav-text-color');
            b.style.removeProperty('--cav-user-text-color');
          }
        }
      });
      /*
       * 设置卡片挂在「插件详情页」，不再占设置页里单独的一节。
       *
       * 位置说明（DSH 官方对三个插槽的定义）：
       *   settings.section       → 设置页里独立的一节（旧做法，占地方）
       *   plugins.item           → 「已安装插件」页里的**官方插件**列表项，我们不是官方插件
       *   plugins.bundle.config  → 按 bundle 包名 keyed，显示在**该插件的详情页**上，
       *                            位置在「描述」和「组件行列表」之间 ← 用这个
       *
       * 这样设置只在点进这个插件时才出现，设置页列表保持干净。
       * 组件本身（AvatarPanel）不用改：它靠 useSettings() 自己读写，不依赖挂在哪。
       *
       * 不写 `locale` 字段：这个插件没有向客户端注册过 locale 命名空间
       * （界面文字全写死在组件里），挂一个不存在的命名空间反而会拿到空字典。
       */
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-avatar-font',
      }, AvatarPanel));
      loadSettings();
      notify();
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
