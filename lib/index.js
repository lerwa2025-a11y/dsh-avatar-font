/**
 * dsh-avatar-font —— Host 半：头像存储 + 三条路由（上传 / 查看 / 清除）。
 *
 * 移植自 dsh-plugin-wallpaper-engine 的「自定义会话头像」扩展，只保留头像部分：
 * 不碰壁纸、玻璃、字体、点击特效、拖尾、吉祥物等任何其它功能。
 *
 * 路由（全部挂 ctx.effect，卸载即净；只信任回环 + 同源）：
 *   GET    /dsh-avatar-font/avatar/<side>       → 头像字节（未导入 → 404）
 *          可带 ?v=<文件名> 作缓存键：带 v 回 immutable 长缓存，不带 v 回 no-cache。
 *          前端必须带 v，否则换图后会命中旧缓存（v2.0.1 修的正是这个）。
 *   POST   /dsh-avatar-font/avatar/<side>       → 导入（body 即图片字节）
 *   DELETE /dsh-avatar-font/avatar/<side>       → 清除
 *   GET    /dsh-avatar-font/settings            → 读设置
 *   POST   /dsh-avatar-font/settings            → 写设置（部分 patch）
 *
 * 上面四条写接口的响应都带 { available, version }：
 *   available[side] 布尔 = 该侧有没有头像
 *   version[side]   文件名 = 该侧当前是哪一版（客户端拿它拼 ?v=）
 *
 * 存储：$DSH_HOME/dsh-avatar-font/{settings.json, avatars/<side>-<stamp>.<ext>}
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

/** 允许的图片格式（Content-Type → 扩展名）。 */
const AVATAR_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** 单张上限 8MB（客户端导入前已缩到 512px 以内）。 */
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
/** 只有两方。路径段当白名单查，不拼进文件名 ⇒ 路径穿越在这一步就不可能。 */
const AVATAR_SIDES = ['user', 'ai'];

const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-avatar-font');
const AVATAR_DIR = join(DATA_DIR, 'avatars');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

const name = 'dsh-avatar-font';
const inject = ['webServer'];

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function trustedRequest(req) {
  const { host = '', origin = '' } = req.headers ?? {};
  if (typeof host !== 'string' || !LOCAL_HOST_RE.test(host)) return false;
  if (origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendJson(res, code, payload) {
  try {
    res.writeHead(code, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  } catch { /* ignore */ }
}

/** 目录确保存在（每次调用都 mkdir，幂等且便宜）。 */
function avatarDir() {
  mkdirSync(AVATAR_DIR, { recursive: true });
  return AVATAR_DIR;
}

/** 换图即换名：时间戳 + 随机，天然是缓存键。 */
function avatarStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 某一方当前那张头像的路径（按前缀扫目录取第一个命中的）；没有就 null。 */
function avatarPath(side) {
  if (!AVATAR_SIDES.includes(side)) return null;
  let entries = [];
  try {
    entries = readdirSync(avatarDir());
  } catch {
    return null;
  }
  const prefix = side + '-';
  const hit = entries.filter((n) => n.startsWith(prefix) && !n.endsWith('.tmp')).sort()[0];
  return hit ? join(avatarDir(), hit) : null;
}

/** 两侧是否已有可用头像：客户端据此决定「画导入的图」还是「内置默认头像」。 */
function avatarAvailability() {
  return {
    user: avatarPath('user') !== null,
    ai: avatarPath('ai') !== null,
  };
}

/**
 * 某一方当前头像的「版本标识」= 磁盘上的文件名（已含时间戳 + 随机串）。
 *
 * v2.0.1 修复：头像的读取路由是固定路径 /avatar/<side>，URL 永远不变，
 * 而 GET 又返回 immutable 长缓存 ⇒ 浏览器第二次请求直接用缓存里的旧图，
 * 表现为「已有头像时再上传，画面纹丝不动，必须先点清除才能换」。
 * 现在把文件名当作版本号下发给客户端，由它拼进 ?v=，换图即换 URL，
 * 缓存必然失效；同时也让同一次换图的新旧文件天然隔离。
 *
 * 只回文件名，不回完整路径（不把本机目录结构泄露给前端）。
 */
function avatarVersion(side) {
  const p = avatarPath(side);
  return p ? basename(p) : '';
}

/** 两侧版本表；与 avatarAvailability() 配套下发。 */
function avatarVersionMap() {
  const out = {};
  for (const side of AVATAR_SIDES) out[side] = avatarVersion(side);
  return out;
}

// ── 设置 ────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  /*
   * 两个功能各自的开关（v2.0）。
   *
   * 拆成 avatar / font 两个独立开关，互不影响：
   *   avatar=false → 不插头像、不改行的 flex 排版
   *   font=false   → 不写字体/字色样式（含正文字色、我的消息字色）
   *
   * 为什么不再有 plugin.enabled：插件的启停本来就由 DSH 的插件管理负责，
   * 面板里再放一个总开关是多余的第二个真相源（关掉面板里的开关并不会卸载插件，
   * 只会让它自己什么都不做，用户很难理解这两者有什么区别）。
   *
   * 气泡框（v2.0 已整体移除）：旧配置里的 aiBubble / bubble* 键会被
   * sanitizeSettings 静默丢弃，不需要迁移。
   */
  plugin: { avatar: true, font: true, stickOffset: 2, stickFollow: true },
  avatarSize: 40,
  avatarRadius: 100,
  // 正文字色：空串 = 跟随主题。只作用于 AI 回复的正文，
  // 代码块 / 行内代码 / 思考区 / 工具调用一律不碰（见 client.js 的 CSS）。
  textColor: '',
  // 用户消息字色：空串 = 跟随主题。只作用于你自己发出的消息文本。
  userTextColor: '',

  /*
   * ── [本地补丁 · 字体] ──────────────────────────────────────────────────
   * 从 dsh-fonttune 移植过来的「够用」版本：换字体、正文/标题分开缩放、
   * 加粗程度、行距。不搬它那套 573KB 的令牌改写引擎，只做这几件事。
   *
   * 全部是「相对主题的偏移量」，0 就是主题原样 —— 这样以后 DSH 改默认
   * 字号也不需要跟着改代码。
   */

  /**
   * 界面字体。空串 = 不覆盖，沿用 DSH 主题字体。
   * 存的是完整 CSS font-family 值（例如 `"Microsoft YaHei", sans-serif`），
   * 因为中文要「中文字体 + 西文回退」叠起来才好看。
   */
  fontFamily: '',
  /** 代码字体。空串 = 沿用主题。 */
  fontMono: '',
  /*
   * 字体覆盖层（2026-10-25 加）：
   *   interfaceFont 是「界面一套」，改了之后整站统一用这个字体；
   *   bodyFont / headingFont 是**覆盖层**，不填就用界面那套，
   *   填了则正文 / 标题各自单独用 —— 也就是在这两处覆盖掉界面字体。
   * 三层关系：headingFont > bodyFont > fontFamily
   */
  bodyFont: '',
  headingFont: '',
  /** 正文字号偏移，-4…+8 px。0 = 主题原样。 */
  fontSizeDelta: 0,
  /** 标题字号偏移，-6…+12 px。0 = 主题原样。独立于正文字号。 */
  headingSizeDelta: 0,
  /** 行距偏移，-20…+60 %。0 = 主题原样。 */
  lineHeightDelta: 0,
  /** 正文粗细，300…700。0 = 主题原样（不写 font-weight）。 */
  fontWeight: 0,
};

function clampNum(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 只接受 `#rgb` / `#rrggbb`（空串 = 跟随主题哨兵值）。 */
function hexOrEmpty(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
}

/**
 * 净化一个 font-family 值（空串 = 沿用主题）。
 *
 * 只做安全过滤，不试图理解字体名：允许字母数字、空格、中文、连字符、下划线，
 * 以及 CSS 字体栈需要的引号与逗号。挡掉 `;` `{` `}` `(` `)` 这些能逃出
 * 声明边界的字符 —— 这个值最终会被拼进 CSS，必须挡住注入。
 */
function fontStackOrEmpty(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 200);
  if (s === '') return '';
  if (!/^[\w\s\u4e00-\u9fa5\-,"'·]+$/.test(s)) return '';
  return s;
}

/** 字号/行距/字重这类「相对偏移」，0 表示跟随主题。 */
function offsetOrZero(v, lo, hi) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 逐字段净化：非法/缺失沿用 current，未知字段丢弃。 */
function sanitizeSettings(patch, current) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const plugin = p.plugin && typeof p.plugin === 'object' ? p.plugin : {};
  return {
    plugin: {
      /*
       * 两个功能开关（v2.0）。缺省都算开 —— 老配置里没有这两个键时，
       * 不能把用户的功能悄悄关掉。
       */
      avatar: typeof plugin.avatar === 'boolean' ? plugin.avatar : current.plugin.avatar !== false,
      font: typeof plugin.font === 'boolean' ? plugin.font : current.plugin.font !== false,
      stickOffset: clampNum(plugin.stickOffset ?? current.plugin.stickOffset, 0, 6, 2),
      /*
       * 头像跟随滚动（v1.0 加）。
       *   true  = 头像贴住滚动区顶部跟着走，行快滚完再随行退出；
       *   false = 只固定在行首，不跟着滑动（长回复往下滚时头像留在原地滚走）。
       *
       * 旧配置文件里没有这个键时取 current（默认 true），不会误关。
       */
      stickFollow: typeof plugin.stickFollow === 'boolean' ? plugin.stickFollow : current.plugin.stickFollow,
    },
    avatarSize: clampNum(p.avatarSize ?? current.avatarSize, 16, 128, 40),
    avatarRadius: clampNum(p.avatarRadius ?? current.avatarRadius, 0, 100, 100),
    // 空串 = 跟随主题（hexOrEmpty 规则）
    textColor: p.textColor === undefined ? current.textColor : hexOrEmpty(p.textColor),
    userTextColor: p.userTextColor === undefined ? current.userTextColor : hexOrEmpty(p.userTextColor),
    // ── [本地补丁 · 字体] ──
    fontFamily: p.fontFamily === undefined ? current.fontFamily : fontStackOrEmpty(p.fontFamily),
    fontMono: p.fontMono === undefined ? current.fontMono : fontStackOrEmpty(p.fontMono),
    bodyFont: p.bodyFont === undefined ? current.bodyFont : fontStackOrEmpty(p.bodyFont),
    headingFont: p.headingFont === undefined ? current.headingFont : fontStackOrEmpty(p.headingFont),
    fontSizeDelta: offsetOrZero(p.fontSizeDelta ?? current.fontSizeDelta, -4, 8),
    headingSizeDelta: offsetOrZero(p.headingSizeDelta ?? current.headingSizeDelta, -6, 12),
    lineHeightDelta: offsetOrZero(p.lineHeightDelta ?? current.lineHeightDelta, -20, 60),
    fontWeight: offsetOrZero(p.fontWeight ?? current.fontWeight, 0, 700),
  };
}

function readSettings() {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')), DEFAULT_SETTINGS);
  } catch {
    try {
      if (existsSync(SETTINGS_FILE)) renameSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
    } catch { /* ignore */ }
    return sanitizeSettings({}, DEFAULT_SETTINGS);
  }
}

function writeSettings(next) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(tmp, SETTINGS_FILE);
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        reject(new Error('too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function apply(ctx) {
  mkdirSync(DATA_DIR, { recursive: true });
  const disposers = [];

  const on = (path, handler) => {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        if (!trustedRequest(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' });
        Promise.resolve().then(() => handler(req, res)).catch((err) => {
          sendJson(res, 400, { ok: false, error: String(err?.message ?? err) });
        });
      },
    }));
  };

  on('/dsh-avatar-font/settings', async (req, res) => {
    if (req.method !== 'POST') {
      const settings = readSettings();
      return sendJson(res, 200, {
        ok: true, settings, available: avatarAvailability(), version: avatarVersionMap(),
      });
    }
    const body = await readBody(req, 64 * 1024);
    const next = sanitizeSettings(JSON.parse(body.toString('utf8') || '{}'), readSettings());
    writeSettings(next);
    sendJson(res, 200, {
      ok: true, settings: next, available: avatarAvailability(), version: avatarVersionMap(),
    });
  });

  // 头像：GET 查看 / POST 导入 / DELETE 清除。side 走白名单。
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-avatar-font/avatar',
    handler: (req, res) => {
      if (!trustedRequest(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' });
      const method = (req.method || 'GET').toUpperCase();
      const reqUrl = new URL(req.url || '/', 'http://x');
      const pathname = reqUrl.pathname;
      const side = decodeURIComponent(pathname.slice('/dsh-avatar-font/avatar/'.length)).replace(/\/+$/, '');
      if (!AVATAR_SIDES.includes(side)) return sendJson(res, 400, { ok: false, error: 'bad side' });

      if (method === 'GET' || method === 'HEAD') {
        const p = avatarPath(side);
        if (!p) return sendJson(res, 404, { ok: false, error: 'not set' });
        const bytes = readFileSync(p);
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp' : 'image/png';
        /*
         * 只有带 ?v=<文件名> 的请求才允许长缓存：那种 URL 天然一图一址，
         * 换图即换地址，immutable 是安全的。
         * 不带 v 的裸 URL（老客户端、手工访问、或修复前留在浏览器里的旧条目）
         * 一律 no-cache —— 否则那个固定地址会被永久钉死在某一张旧图上。
         */
        const versioned = reqUrl.searchParams.has('v');
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'no-cache',
          'Content-Length': String(bytes.length),
        });
        res.end(method === 'HEAD' ? undefined : bytes);
        return;
      }

      if (method === 'DELETE') {
        const p = avatarPath(side);
        let removed = false;
        if (p) {
          try { unlinkSync(p); removed = true; } catch { /* ignore */ }
        }
        sendJson(res, 200, {
          ok: true, side, removed, available: avatarAvailability(), version: avatarVersionMap(),
        });
        return;
      }

      if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });

      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = AVATAR_EXT[ctype];
      if (!ext) return sendJson(res, 415, { ok: false, error: 'unsupported type: ' + ctype });

      readBody(req, AVATAR_MAX_BYTES).then((body) => {
        if (!body.length) return sendJson(res, 400, { ok: false, error: 'empty body' });
        // 换图即清兄弟：同 side 的旧文件（可能换了扩展名/时间戳）先删，否则读取侧取到旧图
        try {
          for (const n of readdirSync(avatarDir())) {
            if (!n.startsWith(side + '-')) continue;
            try { unlinkSync(join(avatarDir(), n)); } catch { /* ignore */ }
          }
        } catch { /* 空目录 */ }
        const file = join(avatarDir(), side + '-' + avatarStamp() + '.' + ext);
        const tmp = file + '.tmp';
        writeFileSync(tmp, body);
        renameSync(tmp, file);
        sendJson(res, 200, {
          ok: true,
          side,
          // 以前是 file.slice(file.lastIndexOf('/') + 1)：Windows 路径用反斜杠，
          // 那样切出来是整个绝对路径。basename 才是跨平台的正确写法。
          name: basename(file),
          available: avatarAvailability(),
          version: avatarVersionMap(),
        });
      }).catch(() => sendJson(res, 413, { ok: false, error: 'image too large (max 8MB)' }));
    },
  }));

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose();
  });
}

export { apply, inject, name };
