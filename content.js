(function __dyhlfBoot() {
  'use strict';
  // 抖音低赞过滤器 v20.0
  // 自动跳过低赞，高赞/颜值/音乐/直播可以保留（v20.0：颜值保留对象可切换 女生默认⇄男生，芯片"颜值保留"四字不变）
  //
  // ── 作者声明 ─────────────────────────────────────────────
  // 作者：高级程序员，男生。
  // 女生/男生保留的词表都是作者本人的口味，不喜欢这套筛法就别用，不伺候众口。
  // 本脚本一天时间完成，自己刷抖音用的；发开源项目纯属兴趣分享，不接需求不维护社区版。
  //
  // 为什么是单文件（架构说明，回复"拆成 engine/ui/style 三文件"的建议）：
  //   1. 单文件 = 即拷即用：控制台粘贴、油猴安装、扩展加载、热重启（dyhlf_src 兜底）
  //      四种运行方式共用这一份源码，拆文件后注入/热重启路径全部失效；
  //   2. MV3 content_scripts 引外部 CSS 会使"控制台一键注入"不可用，得不偿失；
  //   3. 模块边界在文件内已经划清（模块①②③④… + 引擎/UI 分区注释），2200 行在可控范围。
  //   综上：单文件是刻意设计，不是没能力拆。
  // ─────────────────────────────────────────────────────────
  // W=回看 S=继续 空格=抖音原生暂停（不拦）
  // 赞数读不准就保留，宁可不跳也别误杀
  const VERSION = '20.0';
  if (window.__dyhlf?.stop) {
    try { window.__dyhlf.stop(); } catch (e) {}
  }
  // v15.0：产品化重设计（v14.x 全部修复保留，引擎不动）
  //   1) 阈值九宫格 → 十档滑块（1千~100万，1-2-5 对数序列），面板更瘦更精致
  //   2) 时间账本：本次观看时长（仅前台可见时间）+ 今日/累计节省时长（每次跳过保守计 20s），
  //      持久化到 localStorage(dyhlf_time)，跨会话累计，跨日自动清零"今日"
  //   3) 体验细节：面板入场动画、按钮按压反馈、标题悬停显示快捷键、连跳模式状态标注
  //   4) BASE_H 随新布局调整；"清除程序"连同时间账本一起清除
  //   5) v15.1：时间账本拆两行（本次 / 已省·今日高亮），修复单行超宽截断
  //   6) v15.2：作者页判定去掉周期性全量 body 扫描；合成按键改单目标派发防重复触发；
  //      回看/退出回看重置连跳加速；visible() 兼容 fixed 容器（checkVisibility）；
  //      启发式赞数读取改"收集一次、批量量取"；非扩展注入也支持热重启（dyhlf_src 兜底）；
  //      男频判定改词表正则；空格热键 preventDefault 防页面滚动；缓存重置逻辑去重
  // v16.0：视觉焕新（只动 UI 层与已裁定引擎 hunk，判定引擎/缓存/事件调度逻辑零改动）
  //   1) 「精密玻璃仪表」UI：.62 深玻璃、宽 224px、状态卡上移、图标化策略按钮、tabular-nums、
  //      首次引导条、「⋯更多」菜单、清除 3 秒内联二次确认、FAB 三态角标（暂停黄/回看紫/停止灰）
  //   2) 空格 A 案：脚本不再接管空格（空格 = 抖音原生暂停/播放），改 document 捕获监听 pause/play
  //      被动跟踪脚本状态；合成跳转后 600ms 内的 pause 豁免；评论区豁免族（commentsOpen）零改动
  //   3) 缩放基准运行时量取（offset÷zoom + ResizeObserver 单路径 + 拖拽防重入），面板高度自由
  //   4) 主题三同步：红/蓝值迁移 #FF1744→#FF3B5C、#1565FF→#4E9BFF（load 迁移 + 默认串 + data-c）
  //      + 脏值防御；_applyTheme 扩展同步 #dy-fab
  //   5) 统计数字 countUp 滚动（450ms cubic-out + 代际 token）；状态卡文案进出场重触发
  //   6) 待修 #1/#3：_dyClear 补清 dyhlf_src / dyhlf_seen；待修 #2：非扩展注入无 dyhlf_src 时
  //      重启兜底软重启（重入引导函数），扩展 eval 最新源码的开发者路径保留
  try { document.getElementById('dy')?.remove(); } catch (e) {}
  try { document.getElementById('dy-fab')?.remove(); } catch (e) {}
  try { document.getElementById('dy-fx')?.remove(); } catch (e) {} // v18.2：粒子宿主随重启一并清
  try {
    document.querySelectorAll('style').forEach(el => {
      if (el.textContent && (el.textContent.includes('#dy-fab{') || el.textContent.includes('/*dyhlf'))) el.remove();
    });
  } catch (e) {}
  // v14.2：拉取自身源码，供 _dyRestart 热重启（此前 __dySrc 无人赋值，重启是死功能）
  // v15.2：非扩展注入场景改从 localStorage(dyhlf_src) 读源码兜底；扩展场景取得源码后回写一份
  // v16.0：非扩展注入（控制台/油猴）拿不到源码也没关系——_dyRestart 有软重启兜底（见文件尾部）
  try {
    if (window.__dySrc == null) {
      try {
        const _savedSrc = localStorage.getItem('dyhlf_src');
        // v16.1 ⑥：仅当源码版本指纹匹配当前版才采用，否则视为残旧源码丢弃并清除，避免重启执行旧码
        // v16.5 ④：指纹改匹配文件头字面注释标记（原 'FILTER v'+VERSION 是运行时拼接串，
        // 在源码文本中永不字面出现，导致校验恒失败、dyhlf_src 每次启动都被白删重拉）
        if (_savedSrc && _savedSrc.length > 1000 && _savedSrc.includes('dyhlf v' + VERSION)) window.__dySrc = _savedSrc;
        else { try { localStorage.removeItem('dyhlf_src'); } catch (e) {} }
      } catch (e) {}
      if (window.__dySrc == null && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        fetch(chrome.runtime.getURL('content.js'))
          .then(r => { if (r.ok) return r.text(); })
          .then(src => {
            if (src && src.length > 1000) {
              window.__dySrc = src;
              try { localStorage.setItem('dyhlf_src', src); } catch (e) {}
            }
          })
          .catch(() => {});
      }
    }
  } catch (e) {}
  const cfg = {
    enabled: true,
    autoSkip: true,
    skipLive: true,
    keepFemale: true,
    keepGender: 'f', // v20.0：颜值保留对象 'f'=女生（默认）|'m'=男生，芯片点击循环切换
    keepMusic: true,
    fx: true, // v20.0：UI 动效总开关（波纹/震屏/爆彩/浮字等），默认开，「更多」菜单里可关
    autoJ: false,
    threshold: 1000,
    skipSpeed: 80,
    turboSpeed: 15
  };
  try {
    const saved = JSON.parse(localStorage.getItem('dyhlf_cfg') || '{}');
    Object.assign(cfg, saved);
  } catch (e) {}
  let _saveT = null;
  function saveCfg() {
    clearTimeout(_saveT);
    _saveT = setTimeout(() => {
      try { localStorage.setItem('dyhlf_cfg', JSON.stringify(cfg)); } catch (e) {}
    }, 300);
  }

  // v15.0：阈值十档（1-2-5 对数序列），滑块 index -> 赞数
  const THRESHOLD_PRESETS = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 5000000]; // v18.9：上限加 500万
  function presetIndex(v) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < THRESHOLD_PRESETS.length; i++) {
      const d = Math.abs(THRESHOLD_PRESETS[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  const LIKE_EXACT_MS = 200;
  const LIKE_HEURISTIC_MS = 300;
  const TICK_FAST = 50;
  const TICK_IDLE = 200;
  const HIST_MAX = 200;
  const JDONE_MAX = 500;

  // 启发式赞数读取的位置约束（右边操作栏那块区域的数字才算赞）
  const HEU_MIN_L = 0.55, HEU_MAX_L = 0.98;
  const HEU_MIN_T = 0.18, HEU_MAX_T = 0.86;
  const HEU_MAX_W = 110;
  const HEU_MIN_SCORE = 520;
  // v14.1：vid 级缓存 TTL，过期后允许重扫，兜底 DOM 稳定性判定失手的情况
  const VID_CACHE_TTL = 2000;

  // ============ v15.0：时间账本 ============
  const AVG_SKIP_SEC = 20; // 每跳过一个视频保守估计节省的秒数
  const _todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  let _savedSec = 0;      // 本次会话节省（秒）
  let _visibleMs = 0;     // 本次会话前台可见时长
  let _lastTickAt = performance.now();
  let _lastMinMark = -1;
  let _timeStats = { day: _todayStr(), today: 0, total: 0 };
  try {
    const _t = JSON.parse(localStorage.getItem('dyhlf_time') || 'null');
    if (_t && typeof _t.total === 'number') {
      _timeStats.total = _t.total;
      _timeStats.today = (_t.day === _timeStats.day) ? (_t.today || 0) : 0; // 跨日清零"今日"
    }
  } catch (e) {}
  let _saveTimeT = null;
  function saveTimeStats() {
    clearTimeout(_saveTimeT);
    _saveTimeT = setTimeout(() => {
      try { localStorage.setItem('dyhlf_time', JSON.stringify(_timeStats)); } catch (e) {}
    }, 500);
  }
  function addSaved(sec) {
    _savedSec += sec;
    _timeStats.today += sec;
    _timeStats.total += sec;
    saveTimeStats();
  }
  function fmtDur(sec) {
    if (sec < 60) return sec + '秒';
    if (sec < 3600) return Math.floor(sec / 60) + '分钟';
    return (sec / 3600).toFixed(1) + '小时';
  }

  const state = {
    activeVid: null,
    _holdVid: null, // v16.1 门控③：评论打开时记录正在看的视频，关闭后用于判定是否跳过重新判定
    handling: false,
    kept: 0,
    skipped: 0,
    liveSkipped: 0,
    unknown: 0,
    femaleKept: 0,
    userBack: 0,
    authorPage: false,
    lastResult: null,
    consecutiveSkips: 0,
    hitWord: null
  };
  const hist = [];
  const histPos = new Map(); // vid -> last index in hist
  const jDone = new Set();
  let hidx = -1;
  let actionToken = 0;
  let userBackMode = false;
  let userPauseMode = false;
  let _lastJumpAt = 0; // v16.0 空格 A 案：末次合成跳转时刻（pause 事件 600ms 豁免窗基点）
  let syntheticDepth = 0;
  // v14.2：strongBack/weakBack 始终同值，合并为 backArmed（原 weakBack 分支恒为死代码）
  let backArmed = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withSynthetic = fn => {
    syntheticDepth++;
    try { return fn(); } finally { syntheticDepth--; }
  };

  // v14.2：统一登记 document/window 级监听，stop() 一次性清理
  const _disposers = [];
  const onDoc = (type, fn, opts) => { document.addEventListener(type, fn, opts); _disposers.push(() => document.removeEventListener(type, fn, opts)); };
  const onWin = (type, fn, opts) => { window.addEventListener(type, fn, opts); _disposers.push(() => window.removeEventListener(type, fn, opts)); };
  let _stopped = false;

  let activeItemCache = null;
  let activeItemCacheAt = 0;
  let vidCacheVal = null;
  let vidCacheAt = 0;
  let vw = innerWidth, vh = innerHeight;
  // resize handled later with placePanel

  // v14.1：vid 级缓存改为 {val, at} 结构，带 TTL
  const vidLiveCache = new Map();
  const vidShopCache = new Map();
  function cacheGet(map, vid) {
    const c = map.get(vid);
    if (!c) return null;
    if (performance.now() - c.at > VID_CACHE_TTL) { map.delete(vid); return null; }
    return c.val;
  }
  function cacheSet(map, vid, val) {
    if (map.size > 60) {
      // 删掉最旧的条目
      const it = map.keys().next();
      if (!it.done) map.delete(it.value);
    }
    map.delete(vid); // v14.2：先删再插，刷新插入序，避免淘汰刚更新过的条目
    map.set(vid, { val, at: performance.now() });
  }

  // v15.2：条目/vid 缓存重置抽出共用，invalidate 与 goNext 跳转后清理走同一份逻辑
  const resetCaches = () => {
    activeItemCache = null;
    activeItemCacheAt = 0;
    vidCacheVal = null;
    vidCacheAt = 0;
  };
  const invalidate = () => {
    actionToken++;
    resetCaches();
    vidLiveCache.clear();
    vidShopCache.clear();
  };
  const _NORM_RE = /[\s\u00a0\u200b\u200c\u200d]/g;
  const norm = s => String(s || '').replace(_NORM_RE, '');
  const commentsCache = { at: 0, val: false };
  function commentsOpen(force) {
    const now = performance.now();
    // v16.6 [5]：force=true 绕过 300ms 缓存直查 DOM（退出回看的 play() 守卫用，消除缓存漏窗出声）
    if (!force && now - commentsCache.at < 300) return commentsCache.val;
    let val = false;
    const el = document.querySelector('[data-e2e="comment-list"],.comment-mainContent');
    if (el) {
      const r = el.getBoundingClientRect();
      val = r.width > 100 && r.height > 100;
    }
    commentsCache.at = now;
    commentsCache.val = val;
    return val;
  }

  const authorPageCache = { path: '', at: 0, val: false };
  // v15.2：feed 类路径直接判非作者页，正文兜底只在未知路径上运行，
  // 避免在刷视频期间每 2.5s 全量序列化一次 body.textContent
  const _FEED_PATH_RE = /^\/?$|^\/(jingxuan|recommend|foryou|fyp|follow|friend|video|note|live|discover|search|channel|hot|music)/i;
  function isAuthorPage() {
    const p = location.pathname || '/';
    const now = performance.now();
    // v14.2：负结果（非作者页）拉长缓存到 2.5s
    if (authorPageCache.path === p && now - authorPageCache.at < (authorPageCache.val ? 400 : 2500)) return authorPageCache.val;
    let val = /^\/(user|profile|author|@)/i.test(p);
    if (!val && !_FEED_PATH_RE.test(p)) {
      const t = document.body.textContent || '';
      val = t.includes('粉丝') && t.includes('获赞') && t.includes('TA的作品');
    }
    authorPageCache.path = p;
    authorPageCache.at = now;
    authorPageCache.val = val;
    return val;
  }
  // v16.6 [9]：抽屉检测去周期全量扫描——v16.5 每 600ms 序列化一次 body.textContent（约 1.7 次/秒）。
  // 实测（2026-09-30 抖音线上 DOM）：右侧作者卡片不是 body 级 portal，而是渲染在 feed 侧栏内的
  // #relatedVideoCard（LookModalFrameFast，内含 semi tabs 的「TA的作品」页签）——该页签文本常驻
  // DOM，v16.5 的全 body 文本检查会恒判“抽屉开”；找 body 子层 fixed portal 又恒空。故改为
  // 卡片元素锚定：点击 / Escape / 路径变化后事件驱动重检，卡片可见且含该文本 = 抽屉开。
  let _drawerNode = null;
  const _drawerScanTs = new Set();
  function _drawerScanText() {
    try {
      const card = document.getElementById('relatedVideoCard') || document.querySelector('.LookModalFrameFast');
      let open = false;
      if (card) {
        const r = card.getBoundingClientRect();
        open = r.width > 100 && r.height > 100 &&
               (card.textContent || '').includes('TA的作品') &&
               (typeof card.checkVisibility !== 'function' || card.checkVisibility());
      }
      _drawerNode = open ? card : null;
    } catch (e) {}
  }
  function _scheduleDrawerScan() {
    if (_stopped) return;
    _drawerScanText(); // v16.6：卡片检测本身只花 ~0.1ms（getElementById+rect+卡片内文本），同步先检一次
    for (const d of [350, 1200, 3000]) {
      if (_drawerScanTs.has(d)) continue;
      _drawerScanTs.add(d);
      setTimeout(() => {
        _drawerScanTs.delete(d);
        if (!_stopped) _drawerScanText();
      }, d);
    }
  }
  function authorDrawerOpen() {
    if (_drawerNode) {
      if (!_drawerNode.isConnected) _drawerNode = null;
      else if (typeof _drawerNode.checkVisibility === 'function' && !_drawerNode.checkVisibility()) _drawerNode = null;
    }
    return !!_drawerNode;
  }
  function updatePageMode() {
    // v16.4：URL 含 /user/ 或右侧作者抽屉打开时判定作者页
    const p = location.pathname || '/';
    const val = /^\/(user|profile|author|@)/i.test(p) || authorDrawerOpen() || isAuthorPage();
    // v16.5 ②：状态未变早退——原版停在作者页期间每 tick 重复 invalidate/清 jDone
    if (val === state.authorPage) return;
    state.authorPage = val;
    markDirty(); // v16.6：模式翻转立即重绘状态卡，避免停留在上一次判定文案（实测踩过：卡片开着却显示"直播"）
    if (val) {
      invalidate();
      state.activeVid = null;
      state.handling = false;
      // v16.6 [6]：不再 jDone.clear()——回 feed 重判会再按一次 J，把已清屏视频切回未清屏
    }
  }
  function visible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    // v15.2：offsetParent 对 position:fixed 元素返回 null 会误判不可见，改用 checkVisibility
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    return true;
  }
  function activeItem(force = false) {
    const now = performance.now();
    if (!force && activeItemCache && now - activeItemCacheAt < 35 && document.contains(activeItemCache)) {
      return activeItemCache;
    }
    let best = null, area = 0;
    document.querySelectorAll('[data-e2e="feed-item"],[data-e2e="feed-video"]').forEach(it => {
      const r = it.getBoundingClientRect();
      const a = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
                Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (a > area) { area = a; best = it; }
    });
    if (!best) {
      for (const v of document.querySelectorAll('video')) {
        if (!visible(v)) continue;
        const vr = v.getBoundingClientRect();
        const va = Math.max(0, Math.min(vr.right, vw) - Math.max(vr.left, 0)) *
                   Math.max(0, Math.min(vr.bottom, vh) - Math.max(vr.top, 0));
        if (va < 90000) continue;
        let p = v.parentElement, depth = 0, fallbackArea = 0;
        while (p && depth++ < 7) {
          const r = p.getBoundingClientRect();
          const a = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
                    Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
          if (a > fallbackArea && a <= vw * vh * 1.25) { best = p; fallbackArea = a; }
          p = p.parentElement;
        }
        if (best) area = fallbackArea; // v14.2：兜底命中时同步 area，否则下方判定恒为 null
        break;
      }
    }
    activeItemCache = area > 90000 ? best : null;
    activeItemCacheAt = now;
    return activeItemCache;
  }
  function textBySelectors(root, selectors) {
    if (!root) return '';
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) {
        const t = (el.textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }
  function getNickname(it = activeItem()) {
    return textBySelectors(it, ['[data-e2e="feed-video-nickname"]','[data-e2e*="nickname"]']);
  }
  function getDesc(it = activeItem()) {
    return textBySelectors(it, ['[data-e2e="video-desc"]','[data-e2e="feed-video-desc"]','[data-e2e*="desc"]']);
  }
  // 当前视频ID，优先锚 /video/xxx 链接，拿不到再拼（昵称+描述+视频源）
  function currentVid() {
    const now = performance.now();
    if (vidCacheVal !== null && now - vidCacheAt < 25) return vidCacheVal;
    let vid;
    const it = activeItem();
    if (it) {
      // v16.6 [8]：优先锚定 feed 项内 /video/<数字id> 链接作 vid——昵称/文案渐进加载会变，
      // 拼接 vid 漂移会导致 hist 重复入栈、同一视频重复判定；取不到链接再退回拼接兜底
      const _a = it.querySelector('a[href*="/video/"]');
      const _mid = _a ? (/\/video\/(\d+)/.exec(_a.getAttribute('href') || '') || [])[1] : null;
      if (_mid) vid = 'f|' + _mid;
      else {
        const v = it.querySelector('video');
        vid = 'f|' + getNickname(it) + '|' + getDesc(it).slice(0,100) + '|' + (v?.currentSrc || v?.src || v?.poster || '');
      }
    } else {
      const m = location.pathname.match(/\/video\/(\d+)/);
      vid = m ? 'v|' + m[1] : 'x|' + location.pathname;
    }
    vidCacheVal = vid;
    vidCacheAt = now;
    return vid;
  }

  // v14.1：isLiveFast 加"稳定性门控"——DOM 未稳定时不写缓存，让下次 tick 重扫
  // v14.3：新增 preText 参数，由调用方传入一次性序列化的 feed 全文，避免重复 textContent
  // 快速判直播：文本命中"进入直播间"直接中；右下角没倍速/清屏按钮也算直播
  // DOM 没稳的时候不写缓存，下次 tick 重扫
  function isLiveFast(it = activeItem(), vid = currentVid(), preText) {
    if (!it) return false;
    const cached = cacheGet(vidLiveCache, vid);
    if (cached !== null) return cached;
    const text = (preText != null ? preText : (it.textContent || '')).replace(/\s+/g,'');
    let result, stable = true;
    if (text.includes('进入直播间') || text.includes('点击进入直播')) {
      result = true;
      // 文本命中是强证据，可缓存
    } else {
      const base = it.getBoundingClientRect();
      if (!base.width || !base.height) {
        result = false;
        stable = false;   // 布局未完成，不缓存
      } else {
        let has = false, scanned = 0;
        // TreeWalker 只遍历文本节点，跳过纯容器
        const lw = document.createTreeWalker(it, NodeFilter.SHOW_TEXT, null);
        let tn;
        while ((tn = lw.nextNode())) {
          const el = tn.parentElement;
          if (!el || !visible(el)) continue;
          scanned++;
          const t = norm(tn.nodeValue || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '');
          if (!t) continue;
          const r = el.getBoundingClientRect();
          const relX = (r.left + r.width/2 - base.left)/base.width;
          const relY = (r.top + r.height/2 - base.top)/base.height;
          if (relX < 0.62 || relY < 0.62 || relX > 1.02 || relY > 1.02) continue;
          if (t.includes('倍速') || t.includes('清屏')) { has = true; break; }
        }
        result = !has;
        // v16.8 [1]：可见子元素太少说明右下角控件还没渲染出来，此时的"直播"判定不可信——
        // 与上方"空矩形"分支同款安全语义：返回 false 且不缓存。宁可当普通视频保留，
        // 不在 DOM 未稳时把普通视频当直播跳走（真直播由文本命中与稳定后的重扫兜底）
        if (scanned < 5) { result = false; stable = false; }
      }
    }
    if (stable) cacheSet(vidLiveCache, vid, result);
    return result;
  }

  const _COMMA_RE = /[,，\s]/g;
  const _LIKE_WORD_RE = /赞|喜欢|热度/g;
  const _UNIT_RE = /(\d+(?:\.\d+)?)\s*(亿|万|[wW])/;
  const _NUM_RE = /(\d{2,})/;
  function parseCount(text) {
    if (text == null) return NaN;
    let s = String(text).replace(_COMMA_RE,'').replace(_LIKE_WORD_RE,'');
    let m = s.match(_UNIT_RE);
    if (m) return Math.round(parseFloat(m[1]) * (m[2]==='亿'?1e8:1e4));
    m = s.match(_NUM_RE);
    return m ? parseInt(m[1],10) : NaN;
  }

  function readExactLike(it = activeItem()) {
    if (!it) return null;
    const candidates = [];
    for (const sel of ['[data-e2e="video-player-digg"]','[data-e2e*="like-count"]','[data-e2e*="digg-count"]']) {
      for (const el of it.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        // v20.0：精确节点文本可信，个位数赞（0~9）直读——原 \d{2,} 会把刚发视频判成 unknown 放行；
        //         启发式路径维持 \d{2,} 不变（一位数误读风险高，宁可保留）
        let v = parseCount(el.textContent);
        if (Number.isNaN(v)) {
          const _d = (el.textContent || '').trim().replace(_COMMA_RE, '');
          if (/^\d$/.test(_d)) v = parseInt(_d, 10);
        }
        if (Number.isNaN(v)) continue;
        const r = el.getBoundingClientRect();
        candidates.push({ value: v, raw: (el.textContent||'').trim().replace(/\s+/g,''), score: -r.left });
      }
    }
    if (candidates.length) {
      candidates.sort((a,b) => b.score - a.score);
      return { value: candidates[0].value, raw: candidates[0].raw, mode: 'exact' };
    }
    return null;
  }
  function readHeuristicLike(it = activeItem()) {
    if (!it) return null;
    const re = /^\d+(?:\.\d+)?(?:亿|万|[wW])?$/;
    // v15.2：第一遍只收集数字叶子（纯文本操作），随后只对少量候选量取 rect，
    // 避免旧版对每个可见叶子都 getBoundingClientRect
    const cands = [];
    const hw = document.createTreeWalker(it, NodeFilter.SHOW_TEXT, null);
    let hn;
    while ((hn = hw.nextNode())) {
      const el = hn.parentElement;
      if (!el || el.children.length) continue;
      const raw = (hn.nodeValue||'').trim();
      const t = raw.replace(/[,，\s]/g,'');
      if (!t || t.length > 9 || !re.test(t)) continue;
      const v = parseCount(t);
      if (Number.isNaN(v)) continue;
      cands.push({ el, raw, v });
    }
    let best = null;
    for (const c of cands) {
      const el = c.el;
      if (!el.isConnected || !visible(el)) continue;
      // v16.1 门控④：启发式读取排除评论区数字，防止关评论/看完连播时误读评论区点赞、楼中楼计数
      if (el.closest && el.closest('[data-e2e="comment-list"],.comment-mainContent')) continue;
      // v16.8 [2]：门控④同思路——按按钮语义排除评论/收藏/分享按钮自身计数（纯排除，选择器不符时自动无效），
      // 精确赞数节点缺失/延迟时不再把动作栏兄弟按钮的数字误当点赞数
      if (el.closest && el.closest('[data-e2e*="comment"],[data-e2e*="collect"],[data-e2e*="share"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.left < vw * HEU_MIN_L || r.left > vw * HEU_MAX_L) continue;
      if (r.top < vh * HEU_MIN_T || r.top > vh * HEU_MAX_T) continue;
      if (r.width > HEU_MAX_W) continue;
      const score = r.left / vw * 700 + (1 - Math.abs(((r.top + r.height / 2) / vh) - 0.55)) * 300;
      if (!best || score > best.score) best = { value: c.v, raw: c.raw, score };
    }
    if (best && best.score >= HEU_MIN_SCORE) {
      return { value: best.value, raw: best.raw, mode: 'heuristic' };
    }
    return null;
  }
  async function readLikeAccurate(vid, fastMode) {
    const exactMs = fastMode ? 100 : LIKE_EXACT_MS;
    const heuriMs = fastMode ? 150 : LIKE_HEURISTIC_MS;
    const t0 = Date.now();
    while (Date.now()-t0 < exactMs) {
      if (currentVid() !== vid) return null;
      const x = readExactLike();
      if (x) return x;
      await sleep(20);
    }
    let last = null, same = 0;
    const t1 = Date.now();
    while (Date.now()-t1 < heuriMs) {
      if (currentVid() !== vid) return null;
      const x = readHeuristicLike();
      if (x) {
        same = (last && last.value===x.value) ? same+1 : 1;
        last = x;
        if (same >= 2) return x;
      }
      await sleep(30);
    }
    return null;
  }

  // v14.3：广告检测（AD_RE/hasAdMarker）已随"广告跳过"开关一并移除——该分支自 v14.1 起就不可达
  const SHOP_RE = /购物|商品|橱窗|小黄车|旗舰店|专卖店|视频同款|游戏推广|下单|点击购买|去购买/;
  // v14.1：hasGameShoppingMarker 也加稳定性门控 + TTL
  function hasGameShoppingMarker(it = activeItem(), vid = currentVid()) {
    if (!it) return false;
    const cached = cacheGet(vidShopCache, vid);
    if (cached !== null) return cached;
    let result = false, stable = true;
    const base = it.getBoundingClientRect();
    if (!base.width || !base.height) {
      stable = false;
    } else {
      let scanned = 0;
      const sw2 = document.createTreeWalker(it, NodeFilter.SHOW_TEXT, null);
      let sn2;
      while ((sn2 = sw2.nextNode())) {
        const el = sn2.parentElement;
        if (!el || !visible(el)) continue;
        scanned++;
        const t = norm(sn2.nodeValue);
        if (!t || t.length > 30) continue;
        if (!SHOP_RE.test(t)) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left+r.width/2, cy = r.top+r.height/2;
        if (cx>=base.left && cx<=base.right && cy>=base.top+base.height*0.5 && cy<=base.bottom) { result = true; break; }
      }
      if (scanned < 3) stable = false;
    }
    if (stable) cacheSet(vidShopCache, vid, result);
    return result;
  }
  // v20.0：颜值保留对象可切换（2026-10-01 用户要求）——女生（默认）⇄ 男生，cfg.keepGender='f'|'m'。
  //   芯片四字文案"颜值保留"不变，点击循环：女生保留→男生保留→关闭→女生保留。
  //   函数名 matchFemale / verdict 'female-keep' / cfg.keepFemale 键名均沿用，避免牵动引擎判定与已存配置。
  const FEMALE_HOT = new Set(['美女','女生','小姐姐','女神','甜妹','辣妹','穿搭','美妆','舞蹈','自拍','颜值','JK','校园','学姐','学妹','女高','女大','女团','白丝','清纯','变装','氛围感','口红','美甲','护肤','翻唱','对口型','宿舍','教室']);
  const FEMALE_RE = /女孩|妹子|萌妹|软妹|熟女|御姐|萝莉|少女|妹妹|高中|初中|大学|校花|初恋|纯欲|仙女|女友|老婆|大小姐|闺蜜|姐妹|妆容|化妆|素颜|随拍|对镜拍|OOTD|韩系|韩妹|日系|lo裙|洛丽塔|汉服|模特|主播|好看的|漂亮|跳舞|手势舞|长发|卷发|温柔|唱歌|弹唱|理想型|宅女|恋爱|女初|女爱豆|女偶像|女歌手|辣妈|宝妈|旗袍|婚纱|女生日常|甜妹风|御姐风|纯欲风|女生头像|闺蜜照|姐妹照|女生穿搭|辣妹风|温柔风|甜美风|仙女风|初恋风|校园风|学院风|JK制服|连衣裙|短裙|吊带|露肩|大长腿|马甲线|小蛮腰|锁骨|天鹅颈|直角肩|漫画腿|蚂蚁腰|A4腰|酒窝|梨涡|虎牙|卧蚕|双眼皮|高鼻梁|嘟嘟唇|微笑唇|素颜妆|伪素颜|纯欲妆|甜辣妆|清冷妆|氛围感妆|白开水妆|裸妆|淡妆|仙子毛|漫画睫毛|野生眉|平眉|挑眉|柳叶眉|鼻影|修容|高光|腮红|欧美唇|唇釉|唇泥|镜面唇釉|哑光唇釉|丝绒唇釉|水光唇|玻璃唇|果冻唇|咬唇妆|渐变唇|花瓣唇|樱桃小嘴|丰唇|唇珠|唇膜|唇部护理|唇油|唇蜜|唇彩|唇冻|唇霜|唇乳|唇粉/;
  const MALE_HOT = new Set(['帅哥','男生','男孩','小哥哥','猛男','大叔','兄弟','老铁','男团','男歌手','男主播','男士','老爷们','男装','男鞋','男表','男包']);
  function matchFemale(it = activeItem(), preText) {
    if (!it) return null;
    const t = preText || norm(getNickname(it) + ' ' + getDesc(it));
    const hot = (cfg.keepGender === 'm') ? MALE_HOT : FEMALE_HOT;
    const re = (cfg.keepGender === 'm') ? MALE_RE : FEMALE_RE;
    for (const w of hot) {
      if (t.includes(w)) return w;
    }
    const m = t.match(re);
    return m ? m[0] : null;
  }

  // v14.2：女性向购物语境豁免（女生保留模式下减少 male-skip 误杀，如"送男朋友的礼物"）
  const MALE_EXEMPT_RE = /男朋友|男友|送男|给男|适合男|男生礼物|男生的礼物|男士礼物|男同款/;
  // v15.2：男频词表替代单字 '男' 匹配，避免"队友""前任"等无关上下文误杀；现兼作男生保留匹配源
  const MALE_RE = /男孩|男生|男人|男士|帅哥|小哥哥|猛男|大叔|兄弟|老铁|男装|男鞋|男表|男包|男团|男歌手|男主播|老爷们/;

  const J_INIT = Object.freeze({key:'j',code:'KeyJ',keyCode:74,which:74,bubbles:true,cancelable:true,composed:true,repeat:false});
  // v15.2：补 composed，事件可穿过 shadow DOM 边界冒泡
  const DOWN_INIT = Object.freeze({key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true,cancelable:true,composed:true});
  // v15.2：只在最深的容器上派发一次，事件沿冒泡路径覆盖所有祖先（含 React 根/document/window）监听器。
  // 旧版向 window/document/body 等多个目标重复派发，document 级监听器会收到 2~3 次同键事件。
  function synthKeyTarget() {
    const it = activeItem();
    if (it) return it;
    const ae = document.activeElement;
    // v18.7：焦点在顶部导航/搜索区时绝不借用（ArrowDown 会被抖音当搜索联想下移，点亮搜索框弹下拉）
    if (ae && ae !== document.body && ae !== document.documentElement && document.contains(ae) &&
        !(ae.closest && ae.closest('[data-e2e="douyin-navigation"],header,[class*="searchbar"],[class*="search-"]'))) return ae;
    // v18.7：兜底目标白名单——只许 feed 容器，不要用 [data-e2e] 裸查询（第一个命中=顶部导航条）
    const probe = document.querySelector('[data-e2e="feed-active-video"],[data-e2e="feed-item"],[data-e2e="slideList"]');
    return probe || document.body;
  }
  function pressJ() {
    if (userPauseMode || userBackMode) return;
    const data = J_INIT;
    try {
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
      window.focus();
    } catch(e){}
    const target = synthKeyTarget();
    if (!target) return;
    withSynthetic(() => {
      for (const type of ['keydown','keypress','keyup']) {
        try { target.dispatchEvent(new KeyboardEvent(type,data)); } catch(e){}
      }
    });
  }
  function clearScreenOnce(vid) {
    if (!cfg.autoJ || state.authorPage || userBackMode || userPauseMode || jDone.has(vid)) return;
    pressJ();
    jDone.add(vid);
    if (jDone.size > JDONE_MAX) jDone.delete(jDone.values().next().value);
  }
  function clickNextArrow() {
    const el = document.querySelector('[data-e2e="video-switch-next-arrow"]');
    if (!el) return false;
    try { withSynthetic(() => el.click()); return true; } catch(e){ return false; }
  }
  function pressArrowDown() {
    if (userPauseMode || userBackMode) return;
    const data = DOWN_INIT;
    const target = synthKeyTarget();
    if (!target) return;
    withSynthetic(() => {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown',data));
        target.dispatchEvent(new KeyboardEvent('keyup',data));
      } catch(e){}
    });
  }
  // v16.5 ⑤：连跳打断辅助回看用的"上一个"工具（派发细节与 DOWN 对称）
  const UP_INIT = Object.freeze({key:'ArrowUp',code:'ArrowUp',keyCode:38,which:38,bubbles:true,cancelable:true,composed:true});
  function clickPrevArrow() {
    const el = document.querySelector('[data-e2e="video-switch-prev-arrow"]');
    if (!el) return false;
    try { withSynthetic(() => el.click()); return true; } catch(e){ return false; }
  }
  function pressArrowUp() {
    const target = synthKeyTarget();
    if (!target) return;
    withSynthetic(() => {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown',UP_INIT));
        target.dispatchEvent(new KeyboardEvent('keyup',UP_INIT));
      } catch(e){}
    });
  }
  // 跳下一个：同时点下箭头+派发ArrowDown，双保险
  // 连跳2次以上进turbo模式（间隔更短），最多重试40次
  async function goNext(vid, token) {
    if (!cfg.enabled || token!==actionToken || userBackMode || userPauseMode || state.authorPage) return false;
    const speed = state.consecutiveSkips >= 2 ? cfg.turboSpeed : cfg.skipSpeed;
    let tries = 0;
    while (token===actionToken && !userBackMode && !userPauseMode && !state.authorPage && !commentsOpen()) {
      clickNextArrow(); pressArrowDown();
      _lastJumpAt = performance.now(); // v16.0 空格 A 案：标记合成跳转时刻，豁免窗覆盖整串连跳
      resetCaches();
      await sleep(speed);
      if (currentVid() !== vid) return true;
      if (++tries > 40) break;
    }
    return currentVid() !== vid;
  }

  // v14.2：histCount 只被死代码分支读取，已删除；位置索引统一由 rebuildHistPos 维护
  function histAdd(vid) {
    histPos.set(vid, hist.length - 1); // push 之后调用，新元素下标是 length-1（修复 off-by-one）
  }
  function rebuildHistPos() {
    histPos.clear();
    for (let i = 0; i < hist.length; i++) histPos.set(hist[i], i);
  }

  // 核心判定：新视频来了依次过规则，决定留还是跳
  // 顺序：直播→购物车→男生保留→音乐保留→赞数阈值
  // v19.10a：原"男频必跳"分支已删——男生是保留对象，不能再提前跳掉；女生视频走正常赞数阈值判定
  // 读不准一律保留，绝不误杀
  async function handleNewVideo(vid) {
    if (!cfg.enabled || state.authorPage || userBackMode || userPauseMode || commentsOpen()) return;
    state.handling = true;
    const token = actionToken;
    try {
      const inTurbo = state.consecutiveSkips >= 2;
      const isBack = backArmed || (!inTurbo && hist[hidx-1]===vid);
      const isEmptyVid = !vid || vid.length < 10;
      backArmed = false;
      if (isBack && !isEmptyVid) {
        // v14.2：校验 histPos 仍指向该 vid，防截断后索引失效
        const bp = histPos.get(vid);
        hidx = (bp != null && hist[bp] === vid) ? bp : hidx;
        state.userBack++; state.kept++;
        state.lastResult = { verdict:'userback' };
        markDirty();
        return;
      }
      // v16.1 门控①：判定前等目标视频 DOM 就绪（video.readyState>=2 且高度>100，或精确赞数节点已可读），
      // 避免"看完即判/关评论即判"时新视频 DOM 未就绪、精确赞数读不到导致启发式误读评论区数字而误跳。
      let _ready = false;
      for (let _rt = 0; _rt < 3; _rt++) {
        if (currentVid() !== vid || token !== actionToken) return; // 视频已变，放弃本次判定
        const _it = activeItem();
        const _vv = _it && _it.querySelector('video');
        const _digg = _it && _it.querySelector('[data-e2e="video-player-digg"]');
        const _diggReady = _digg && _digg.getBoundingClientRect().height > 0 && /\d/.test((_digg.textContent||'').trim());
        if ((_vv && _vv.readyState >= 2 && _it.getBoundingClientRect().height > 100) || _diggReady) { _ready = true; break; }
        await sleep(300);
      }
      if (currentVid() !== vid || token !== actionToken) return;
      if (!_ready) { state.unknown++; state.unknownStreak = (state.unknownStreak || 0) + 1; state.lastResult = { verdict:'unknown' }; markDirty(); return; } // 就绪失败：按 unknown 保留，绝不跳过
      if (hidx>=0 && hidx<hist.length-1) {
        hist.length = hidx+1; // v14.2：截断后统一 rebuildHistPos 重建索引
        rebuildHistPos();
      }
      // v16.4 修复 #2/#3：回看/继续后、阈值调整后，当前视频需重判（低赞立即跳过、不漏判）。
      // 仅去重"入栈/计数"，不再短路判定逻辑；已在本位则跳过入栈但照常走判定。
      if (!(hidx >= 0 && hist[hidx] === vid)) {
        hist.push(vid); histAdd(vid); hidx = hist.length-1;
        if (hist.length > HIST_MAX) {
          hist.splice(0, hist.length - HIST_MAX);
          hidx = hist.length - 1;
          rebuildHistPos();
        }
      }

      const it = activeItem();
      // v14.1：缓存 nickname/desc，避免下面多个函数重复查 DOM
      const _nk = getNickname(it);
      const _ds = getDesc(it);
      const _fullText = norm(_nk + ' ' + _ds);
      // v14.3：feed 容器全文只序列化一次，isLiveFast 与音乐判定共用
      // v15.2：直播/音乐判定都关掉时不再做整项 textContent 序列化
      const _rawText = (it && (cfg.skipLive || cfg.keepMusic)) ? (it.textContent || '') : '';
      let decision = 'unknown';
      let like = null;
      let hit = null;

      if (cfg.skipLive && isLiveFast(it, vid, _rawText)) {
        decision = 'live';
      } else if (hasGameShoppingMarker(it, vid)) {
        decision = 'game-shopping';
      } else if (cfg.keepGender !== 'm' && MALE_RE.test(_fullText) && !MALE_EXEMPT_RE.test(_fullText)) {
        decision = 'male-skip'; // v20.0：女生保留模式下男生仍必跳（v15.2 原语义）；男生保留模式下此分支关闭
      } else if (cfg.keepMusic && _rawText.includes('汽水音乐')) {
        decision = 'music-keep';
      } else if (cfg.keepFemale && (hit = matchFemale(it, _fullText))) {
        decision = 'female-keep'; // v20.0：保留对象随 cfg.keepGender 切换（女生默认/男生），verdict 名沿用
      } else {
        like = await readLikeAccurate(vid, state.consecutiveSkips>=2);
        // v15.2：等待期间用户可能打开评论，恢复后补检一次再继续
        if (currentVid()!==vid || userBackMode || userPauseMode || state.authorPage || commentsOpen() || token!==actionToken) return;
        // v16.1 门控②：赞数读不到 = unknown = 保留（keep）+ 延迟重试，绝不自动跳过
        if (!like) decision = 'unknown';
        // v16.1 门控②：连跳加速（turbo）中只采信精确赞数（[data-e2e="video-player-digg"]），启发式结果视为 unknown
        else if (like.mode === 'heuristic' && state.consecutiveSkips >= 2) decision = 'unknown';
        else if (like.value >= cfg.threshold) decision = 'keep';
        else decision = 'low';
      }

      const shouldSkip = decision==='live'||decision==='game-shopping'||decision==='low'||decision==='male-skip';
      state.hitWord = hit;
      state.lastResult = { verdict:decision, hit, value:like?.value, raw:like?.raw };

      clearScreenOnce(vid);

      // autoSkip 关着时只显示判定结果，不累加统计
      if (!cfg.autoSkip) {
        markDirty();
        return;
      }

      if (decision==='live') state.liveSkipped++;
      if (decision==='female-keep') state.femaleKept++;
      // v20.0：unknown 连击计数——给"抖音改版→过滤静默失效"做显式告警用（UI 层读取，≥15 提示）
      if (decision==='unknown') { state.unknown++; state.unknownStreak = (state.unknownStreak || 0) + 1; }
      else state.unknownStreak = 0;
      markDirty();

      if (!shouldSkip) {
        state.kept++; state.consecutiveSkips = 0;
        markDirty();
        return;
      }
      state.skipped++; state.consecutiveSkips++;
      addSaved(AVG_SKIP_SEC);
      markDirty();
      const ok = await goNext(vid, token);
      if (ok) {
        _failVid = null; _failStreak = 0;
      } else if (_failVid === vid) {
        if (++_failStreak < 3) state.activeVid = null;
      } else {
        _failVid = vid; _failStreak = 1;
        state.activeVid = null;
      }
    } catch (err) {
      console.warn('[FILTER] handle error:', err);
    } finally {
      state.handling = false;
      markDirty();
      render();
    }
  }

  let _tickDelay = TICK_FAST;
  let _sameVidCount = 0;
  let _tickTimer = null;   // v14.1：跟踪 setTimeout 句柄，stop() 时可清理
  let _failVid = null;     // v14.3：goNext 失败重试追踪
  let _failStreak = 0;
  // v16.1 ①：暂停态改为 tick 轮询真实 video.paused，彻底根除 pause/play 事件竞态（视频切换瞬间事件被旧视频认领、新视频 play 被拒收导致 userPauseMode 卡 true）。
  // 合成跳转豁免窗（_lastJumpAt 600ms 内）与看完切流（v.ended）不置暂停。
  function pollPauseState() {
    if (!cfg.enabled || state.authorPage || userBackMode) return;
    if (performance.now() - _lastJumpAt < 600) return; // 合成跳转/连跳切换期不误判
    const it = activeItem();
    const v = it && it.querySelector('video');
    if (!v || v.ended) return; // 看完自动连播切流不置暂停
    if (userPauseMode !== v.paused) { userPauseMode = v.paused; markDirty(); }
  }
  // 主循环：轮询当前视频，检测到新视频就触发判定
  // 活跃50ms/静止200ms/后台500ms，自适应降频
  function tick() {
    if (_stopped) return; // v16.5 ①：僵尸链守卫——stop() 后漏网的定时器到此自杀
    // v15.0：前台可见时长累计（隐藏时不计）；跨分钟刷新时间账本显示
    const _nowT = performance.now();
    if (!document.hidden) _visibleMs += _nowT - _lastTickAt;
    _lastTickAt = _nowT;
    const _mins = Math.floor(_visibleMs / 60000);
    if (_mins !== _lastMinMark) { _lastMinMark = _mins; markDirty(); }
    if (document.hidden) {
      _tickTimer = setTimeout(tick, 500);
      return;
    }
    updatePageMode();
    render(); // v14.2：消费脏标记，暂停/回看/评论态即时刷新
    pollPauseState(); // v16.1 ①：每轮轮询真实暂停态，置于引擎早退判断之前，确保恢复播放能被及时感知
    if (!cfg.enabled || state.authorPage || userBackMode || userPauseMode || state.handling) {
      _tickTimer = setTimeout(tick, TICK_IDLE);
      return;
    }
    // v16.1 门控③：评论打开时记录正在看的视频（不清 activeVid），关闭后若仍是同一视频则恢复 activeVid 并跳过重新判定，
    // 杜绝"关评论再点叉/看完连播"对正在看视频的误跳与 hist 重复入栈。
    if (commentsOpen()) { state._holdVid = currentVid(); markDirty(); _tickTimer = setTimeout(tick, TICK_IDLE); return; }
    if (state._holdVid != null) {
      const _held = state._holdVid; state._holdVid = null;
      // v16.4 修复 #3：关评论后强制重判当前视频（activeVid 置空，下一轮 tick 重新进入 handleNewVideo），
      // 避免低赞视频因"恢复即保留"而漏跳
      if (_held === currentVid()) { state.activeVid = null; markDirty(); _tickTimer = setTimeout(tick, TICK_IDLE); return; }
      // 不同：走正常 handleNewVideo 重新判定
    }
    const vid = currentVid();
    if (!vid || vid === state.activeVid) {
      _sameVidCount++;
      if (_sameVidCount >= 20 && _tickDelay === TICK_FAST) _tickDelay = TICK_IDLE;
    } else {
      _sameVidCount = 0;
      _tickDelay = TICK_FAST;
      state.activeVid = vid;
      handleNewVideo(vid);
    }
    _tickTimer = setTimeout(tick, _tickDelay);
  }
  _tickTimer = setTimeout(tick, TICK_FAST);

  function enterUserBack(assist) {
    userBackMode = true; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; backArmed = true;
    state.consecutiveSkips = 0; // v15.2：回看后不延续连跳 turbo 速度
    // v16.5 ⑤：连跳打断辅助回看——连跳中（末次合成跳转 800ms 内）上滑/↑/W 想抓回刚被
    // 跳走的视频时，页面常因跳转惯性卡顿、手势没被抖音处理；脚本主动补一次「上一个」。
    // 点 UI 左箭头不辅助（用户点了就是精确回退，别双退）。
    // v16.5 ⑦：辅助改 350ms 延迟确认——到点时视频已变（原生手势其实生效了）或用户已
    // 滑回正轨/脚本已停，就不再补，防止"原生退一次 + 辅助再退一次"的双退过头。
    if (assist && performance.now() - _lastJumpAt < 800) {
      const _vidAtGesture = currentVid();
      setTimeout(() => {
        // v16.6 [5]：确认窗 350→600ms（页面卡顿时原生手势可能 >350ms 才反映到 vid，防双退）；
        // 开评论时不补退（跳转后 800ms 内滚评论不再误触「上一个」）
        if (_stopped || !userBackMode || commentsOpen() || currentVid() !== _vidAtGesture) return;
        if (!clickPrevArrow()) pressArrowUp();
      }, 600);
    }
    markDirty();
  }
  function exitUserBack() {
    // v16.5 ①：非回看/暂停态的 S/↓ 是 no-op 早退——原版每次按键都全量重置并直接调 tick()，
    // 且没先 clearTimeout，每按一次就多一条永续 tick 链（stop() 也杀不干净，越用越卡的根因）
    if (!userBackMode && !userPauseMode) return;
    userBackMode = false; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; backArmed = false;
    state.consecutiveSkips = 0;
    // v16.6 [6]：不再 jDone.clear()——J 是切换键，清空后重判同一视频会再按一次 J 把清屏切回去
    // v16.5 ⑥：下滑/S 恢复时若视频仍处暂停，一并 play() 恢复——否则（尤其回看后的暂停视频）
    // 脚本会因 pollPauseState 的真实暂停态停在"暂停中"不再自动筛选，用户以为脚本失灵。
    // 与 v16.1 的 S 键恢复路径同款行为，滚轮/↓ 恢复补齐同样体验。
    // v16.5 ⑧：评论打开时不 play——滚评论列表同样触发 wheel→exitUserBack，
    // 不能让"挂着暂停视频滚评论"突然出声。
    try {
      const _it = activeItem();
      const _v = _it && _it.querySelector('video');
      if (!commentsOpen(true) && _v && _v.paused && !_v.ended) _v.play().catch(()=>{});
    } catch (e) {}
    markDirty();
    try { clearTimeout(_tickTimer); tick(); } catch(e){}
  }
  function onKey(e) {
    if (syntheticDepth > 0) return;
    if (e.key === 'Escape') {
      // v16.7 [4]：菜单开着时 Esc 先关菜单（_closeMenu 含确认态还原；不 preventDefault，抖音自身 Esc 关抽屉不受影响）
      if (_menu && !_menu.hidden) _closeMenu();
      _scheduleDrawerScan(); return;
    } // v16.6 [9]：Esc 关抽屉后事件驱动重检
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    const key = String(e.key||'').toLowerCase();
    if (key==='w' || e.key==='ArrowUp' || e.key==='PageUp') { enterUserBack(true); return; }
    if (key==='s' || e.key==='ArrowDown' || e.key==='PageDown') {
      if (userPauseMode) {
        // v16.1 ①：恢复自动刷时，若视频仍被原生暂停，一并调用 play() 恢复播放，防止"脚本恢复刷、视频没播放"的状态分裂
        try {
          const _it = activeItem();
          const _v = _it && _it.querySelector('video');
          if (_v && _v.paused && !_v.ended) _v.play().catch(()=>{});
        } catch (e) {}
      }
      exitUserBack(); return;
    }
    // v16.1 ①：空格交还抖音原生暂停/播放（零键盘拦截）；暂停态改由 tick 轮询 video.paused 被动跟随；W/S/滚轮/翻页热键全保留
  }
  let _lastWheel = 0;
  function onWheel(e) {
    if (syntheticDepth > 0) return;
    const now = performance.now();
    // v18.2 修复：回看中下滑退出不受 500ms 节流——上滑的滚轮惯性事件会连续刷新节流窗，
    // 把紧跟的第一次下滑吞掉（用户实测"要滑两下才判定继续往下滑"）。退出方向必须即时响应。
    const isExit = userBackMode && e.deltaY > 10;
    if (!isExit && now - _lastWheel < 500) return;
    if (e.deltaY < -10) { _lastWheel = now; enterUserBack(true); }
    else if (e.deltaY > 10) { _lastWheel = now; exitUserBack(); }
  }
  function onClick(e) {
    if (syntheticDepth > 0) return;
    _scheduleDrawerScan(); // v16.6 [9]：点击（开/关抽屉等）后事件驱动重检，替代周期全量扫描
    if (!e.target?.closest?.('[data-e2e="video-switch-prev-arrow"]')) return;
    enterUserBack();
  }
  onDoc('keydown', onKey, true);
  // v16.4：URL 变化时立即判定作者页，不等 tick
  // v16.5 ③：句柄纳入清理——原版 setInterval 从不被 stop() 清除，重启/清除程序一次漏一个
  let _lastPath = location.pathname;
  const _pathT = setInterval(() => {
    if (_stopped) { clearInterval(_pathT); return; }
    if (location.pathname !== _lastPath) {
      _lastPath = location.pathname;
      _scheduleDrawerScan(); // v16.6 [9]：导航后事件驱动重检抽屉（原 600ms 缓存已随全量扫描移除）
      updatePageMode();
    }
  }, 100);
  onDoc('wheel', onWheel, {capture:true, passive:true});
  // 搜索框保留可用，下拉弹窗一律隐藏
  // v20.0：body 级 subtree observer 触发频繁，防抖 120ms 合并处理（弹窗隐藏延迟一帧无感知），
  //         stop()/清除时连定时器一起回收
  // 为什么不缩小观察范围（回复审查建议"只 observe 搜索栏容器"）：抖音 SPA 的联想/热搜/
  //         下拉容器挂在动态父节点下、父节点本身也随路由重建，锚定任何固定容器都会漏；
  //         回调已防抖 120ms，且选择器仅匹配 id/class 前缀，实际开销可控。维持现状。
  let _searchPopupT = null;
  const _hideSearchPopups = () => {
    document.querySelectorAll('[data-e2e*="search-"],[class*="search-suggest"],[class*="SearchSuggest"],[class*="search-dropdown"]').forEach(el => {
      if (!el.querySelector('[data-e2e="searchbar-input"]')) el.style.display = 'none';
    });
  };
  const _searchPopupObs = new MutationObserver(() => {
    if (_searchPopupT) return;
    _searchPopupT = setTimeout(() => { _searchPopupT = null; _hideSearchPopups(); }, 120);
  });
  if (document.body) {
    _searchPopupObs.observe(document.body, { childList: true, subtree: true });
    _disposers.push(() => { _searchPopupObs.disconnect(); if (_searchPopupT) { clearTimeout(_searchPopupT); _searchPopupT = null; } });
  }
  onDoc('click', onClick, true);
  _scheduleDrawerScan(); // v16.6 [9]：启动先检一次抽屉（兜底刷新时抽屉已开）
  // v16.1 ①：删除 pause/play 事件监听，改由 tick 轮询真实 video.paused（见 pollPauseState），根除事件竞态

  // ============ UI v16.0 ============
  const style = document.createElement('style');
  style.textContent = `/*dyhlf v20.0 · 曜石引擎（本行是热重启版本指纹，格式必须为"dyhlf v"+VERSION 空格形式、与 VERSION 同步改动）
  UI 全换代：深空底色 / 顶部能量线(运行态点亮) / 状态卡能量核心(tint渐变+左能量条+脉冲点)
  / 滑块十档刻度+彩底值芯片 / 策略芯片发光态 / 统计格顶色条 / FAB 主题光环 / blur 入场动效
  契约不变：#dy/#dy-fab 变量块、--ac/--ac-rgb 主题注入、全部元素 ID 与语义类、自清理标记 */
#dy,#dy-fab{
  --w-p:240px;
  --ac:#FF3B5C;--ac-rgb:255,59,92;
  --t1:rgba(255,255,255,.96);--t2:rgba(255,255,255,.62);--t3:rgba(255,255,255,.40);
  --c-ok:#3DE8A0;--c-bad:#FF5C7A;--c-info:#5AB0FF;--c-pink:#FF6FA8;--c-warn:#FFC53D;--c-back:#B389FF;
  --glass:rgba(14,16,22,.34);--glass-2:rgba(255,255,255,.055);--menu:rgba(16,18,24,.64);
  --line:rgba(255,255,255,.12);--line-2:rgba(255,255,255,.08);
  --r-card:14px;--r-ctrl:11px;
  --f: -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
/* ============ 容器：曜石底 + 能量线 ============ */
#dy{position:fixed;left:20px;top:90px;width:var(--w-p);z-index:2147483647;background:var(--glass);backdrop-filter:blur(18px) saturate(1.8);-webkit-backdrop-filter:blur(18px) saturate(1.8);border-radius:18px;font:13px/1.5 var(--f);color:var(--t1);overflow:hidden;max-width:calc(100vw - 8px);user-select:none;box-shadow:0 14px 40px rgba(0,0,0,.28),0 3px 10px rgba(0,0,0,.16),0 0 0 1px rgba(255,255,255,.05);zoom:1;animation:dyIn .28s cubic-bezier(.2,.9,.25,1);text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
#dy::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 0 0 1px rgba(255,255,255,.03)}
/* 顶部能量线：运行时点亮并缓慢呼吸 —— 一眼可辨「引擎在跑」 */
#dy::after{content:'';position:absolute;top:0;left:30px;right:30px;height:2px;border-radius:0 0 3px 3px;background:linear-gradient(90deg,transparent,rgba(var(--ac-rgb),.9) 50%,transparent);box-shadow:0 0 12px 1px rgba(var(--ac-rgb),.45);opacity:0;transition:opacity .45s;pointer-events:none}
#dy:has(.sw.on)::after{opacity:1;animation:dyEnergy 5.2s ease-in-out infinite}
#dy .bd{padding:0}
/* ============ A 状态层：标题 + 运行开关 ============ */
#dy .hd{padding:14px 16px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
#dy .hact{display:flex;align-items:center;gap:8px}
/* v18.2 音效开关（静音态持久化 localStorage dyhlf_snd） */
#dy .snd{width:26px;height:26px;border-radius:9px;border:0;background:rgba(255,255,255,.06);color:var(--t2);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:color .15s,background .15s,transform .1s;flex:none}
#dy .snd svg{width:15px;height:15px}
#dy .snd:hover{color:#fff;background:rgba(255,255,255,.11)}
#dy .snd:active{transform:scale(.88)}
#dy .snd .mu{display:none}
#dy .snd.off{color:var(--t3)}
#dy .snd.off .wv{display:none}
#dy .snd.off .mu{display:block}
#dy .hd .t{font-size:12px;font-weight:600;letter-spacing:.8px;color:var(--t2);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
#dy .hd .t::before{content:'';display:inline-block;width:7px;height:7px;border-radius:2.5px;background:var(--t3);margin-right:8px;vertical-align:1px;transition:background .25s,box-shadow .25s}
#dy .hd:has(.sw.on) .t::before{background:var(--ac);box-shadow:0 0 9px rgba(var(--ac-rgb),.85);animation:dyBreath 2.4s ease-in-out infinite}
#dy .sw{position:relative;width:44px;height:24px;border-radius:12px;background:rgba(255,255,255,.10);border:1px solid var(--line-2);cursor:pointer;flex:none;transition:background .2s,box-shadow .2s,border-color .2s}
#dy .sw::before{content:'';position:absolute;inset:-11px -8px}/* 命中区扩展 */
#dy .sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.45);transition:transform .24s cubic-bezier(.34,1.56,.64,1)}
#dy .sw.on{background:linear-gradient(135deg,rgba(var(--ac-rgb),.92),rgba(var(--ac-rgb),.72));border-color:rgba(255,255,255,.18);box-shadow:0 0 14px rgba(var(--ac-rgb),.35),inset 0 1px 1px rgba(255,255,255,.28)}
#dy .sw.on::after{transform:translateX(20px)}
/* ============ A 状态层：状态卡「能量核心」============ */
#dy .st{--sc:var(--t3);--sc-rgb:255,255,255;
  position:relative;margin:0 16px 14px;padding:12px 14px 11px 18px;border-radius:var(--r-card);overflow:hidden;
  background:linear-gradient(135deg,rgba(var(--sc-rgb),.10),rgba(var(--sc-rgb),.02) 62%),rgba(255,255,255,.03);
  border:1px solid rgba(var(--sc-rgb),.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  transition:background .35s,border-color .35s}
#dy .st:has(.m.cg){--sc:var(--c-ok);--sc-rgb:61,232,160}
#dy .st:has(.m.cr){--sc:var(--c-bad);--sc-rgb:255,92,122}
#dy .st:has(.m.cb){--sc:var(--c-info);--sc-rgb:90,176,255}
#dy .st:has(.m.cp){--sc:var(--c-pink);--sc-rgb:255,111,168}
#dy .st:has(.m.cy){--sc:var(--c-warn);--sc-rgb:255,197,61}
#dy .st:has(.m.ca){--sc:var(--ac);--sc-rgb:var(--ac-rgb)}
#dy .st::before{content:'';position:absolute;left:0;top:13%;bottom:13%;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--sc),rgba(var(--sc-rgb),.15));box-shadow:0 0 7px rgba(var(--sc-rgb),.38);transition:background .35s,box-shadow .35s}
#dy .st .m{display:flex;align-items:center;gap:9px;font-size:20px;font-weight:700;letter-spacing:.3px;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--t1);animation:dyStIn .16s ease-out;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#dy .st .m::before{content:'';flex:none;width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}/* v18.4：脉冲只留运行态（.running 规则见动效区），常驻辉光减弱 */
#dy .st .s{font-size:11px;color:var(--t2);margin-top:4px;animation:dyStIn .16s ease-out;min-height:1.5em;overflow-wrap:anywhere}
/* —— v18.2 解压卡片：可连点（果冻挤压 + 点击涟漪），触屏防双击缩放 —— */
#dy .st{cursor:pointer;touch-action:manipulation}
#dy .rp{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.45),rgba(var(--sc-rgb),.25) 55%,transparent 70%);transform:translate(-50%,-50%) scale(0);pointer-events:none;animation:dyRp .55s cubic-bezier(.2,.7,.4,1) forwards}
@keyframes dyRp{60%{opacity:.85}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}
/* —— v18.2 粒子宿主：挂在 body 上、面板之下（stop() 需 remove）—— */
#dy-fx{position:fixed;inset:0;pointer-events:none;z-index:2147483600;overflow:hidden}
#dy-fx i{position:absolute;border-radius:50%;will-change:transform,opacity}
#dy .m.cg{color:var(--c-ok)}
#dy .m.cr{color:var(--c-bad)}
#dy .m.cb{color:var(--c-info)}
#dy .m.cp{color:var(--c-pink)}
#dy .m.cy{color:var(--c-warn)}
#dy .m.ca{color:var(--ac)}
/* ============ A 状态层：首次引导条（主题色信息卡）============ */
#dy .guide{margin:0 16px 14px;padding:9px 11px;background:linear-gradient(135deg,rgba(var(--ac-rgb),.12),rgba(var(--ac-rgb),.04));border:1px solid rgba(var(--ac-rgb),.3);border-radius:var(--r-card);display:flex;align-items:center;gap:8px;overflow:hidden}
#dy .guide .gt{flex:1;font-size:11px;line-height:1.5;color:var(--t2)}
#dy .guide .gok{flex:none;font-family:inherit;font-size:11px;font-weight:700;color:#fff;background:linear-gradient(135deg,rgba(var(--ac-rgb),.9),rgba(var(--ac-rgb),.68));border:none;border-radius:9px;padding:4px 10px;cursor:pointer;box-shadow:0 2px 10px rgba(var(--ac-rgb),.3);transition:filter .15s}
#dy .guide .gok:hover{filter:brightness(1.18)}
#dy .guide .gok:active{transform:scale(.94)}
/* ============ B 控制层：阈值滑块（刻度 + 彩底值芯片）============ */
#dy .slw{padding:0 16px;margin-bottom:14px}
#dy .slh{display:flex;justify-content:space-between;align-items:center;margin-bottom:2px}
#dy .slh .lb{font-size:12px;font-weight:600;letter-spacing:.5px;color:var(--t2)}
#dy .slh .vl{font-size:11px;font-weight:700;color:#fff;background:linear-gradient(135deg,rgba(var(--ac-rgb),.95),rgba(var(--ac-rgb),.7));padding:2px 10px 3px;border-radius:8px;letter-spacing:.3px;box-shadow:0 2px 10px rgba(var(--ac-rgb),.32)}
#dy .slwrap{position:relative;height:32px;display:flex;align-items:center;cursor:pointer}
#dy .slwrap::before{content:'';position:absolute;inset:-5px 0;pointer-events:none}/* 命中区扩至 42px 高 */
#dy .slwrap::after{content:'';position:absolute;left:9px;right:9px;bottom:calc(50% + 5px);height:2.5px;pointer-events:none;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.4) 0 1.5px,transparent 1.5px calc(100%/10))}
#dy .sl{-webkit-appearance:none;appearance:none;display:block;width:100%;height:6px;border-radius:3px;background:rgba(255,255,255,.13);outline:none;margin:0;cursor:pointer} /* v19.2：原生滑条恢复 */
#dy .sl::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:none;box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.3),0 0 12px rgba(var(--ac-rgb),.35);cursor:pointer;transition:transform .12s,box-shadow .12s} /* v19.2：拇指恢复 */
#dy .sl:hover::-webkit-slider-thumb{transform:scale(1.15)}
#dy .sl:active::-webkit-slider-thumb{transform:scale(1.3);box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 7px rgba(var(--ac-rgb),.15),0 0 18px rgba(var(--ac-rgb),.5)}
#dy .sl::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#fff;border:none;box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 12px rgba(var(--ac-rgb),.35);cursor:pointer} /* v19.2：拇指恢复 */
#dy .bub{position:absolute;bottom:calc(100% + 7px);transform:translateX(-50%);background:var(--menu);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(var(--ac-rgb),.42);border-radius:9px;padding:4px 10px;font-size:11px;font-weight:700;color:var(--t1);white-space:nowrap;pointer-events:none;opacity:0;transition:left .1s ease-out,opacity .15s;box-shadow:0 6px 18px rgba(0,0,0,.42),0 0 14px rgba(var(--ac-rgb),.18)}
#dy .bub::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:var(--menu)}
#dy .bub.show{opacity:1}
#dy .sle{display:flex;justify-content:space-between;font-size:11px;color:var(--t3);letter-spacing:.4px}
/* —— v18.2 滑块动效：跨档微反馈（拇指挤压/刻度闪/值芯片弹跳）+ 尽头撞击（拇指弹性爆闪）—— */
@keyframes dyThumbTick{0%{transform:scale(1.3)}45%{transform:scale(1.34,.72)}100%{transform:scale(1.3)}}
#dy .sl.tk::-webkit-slider-thumb{animation:dyThumbTick .13s cubic-bezier(.3,.7,.4,1)}
@keyframes dyThumbImp{0%{transform:scale(1.3)}30%{transform:scale(1.62)}100%{transform:scale(1.3)}}
#dy .sl.imp::-webkit-slider-thumb{animation:dyThumbImp .3s cubic-bezier(.16,1.2,.3,1);box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.3),0 0 22px 5px rgba(var(--ac-rgb),.6)}
@keyframes dyTickF{0%{filter:brightness(2)}100%{filter:brightness(1)}}
#dy .slwrap.tk::after{animation:dyTickF .16s ease-out}
@keyframes dyVlPop{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}
#dy .slh .vl.pop{animation:dyVlPop .2s cubic-bezier(.2,.9,.3,1.4)}
/* ============ B 控制层：策略芯片 2×2 ============ */
#dy .rg{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px;margin-bottom:14px;min-width:0}
#dy .rg button{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:var(--r-ctrl);border:1px solid var(--line-2);background:rgba(255,255,255,.035);color:var(--t2);font-family:inherit;font-size:12px;font-weight:600;letter-spacing:.2px;cursor:pointer;transition:color .16s,border-color .16s,background .16s,box-shadow .16s,transform .1s;-webkit-font-smoothing:antialiased;min-width:0;white-space:nowrap}
#dy .rg button::after{content:'';position:absolute;inset:-4px 0;border-radius:14px}/* 命中区扩至 44px 高 */
#dy .rg button svg{width:13px;height:13px;flex:none;opacity:.72;transition:opacity .16s,filter .16s}
#dy .rg button:hover{color:var(--t1);border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.06)}
#dy .rg button:active{transform:scale(.95)}
#dy .rg button.on{color:var(--ac);border-color:rgba(var(--ac-rgb),.48);background:linear-gradient(135deg,rgba(var(--ac-rgb),.17),rgba(var(--ac-rgb),.06));box-shadow:0 0 14px rgba(var(--ac-rgb),.13),inset 0 1px 0 rgba(255,255,255,.07)}
#dy .rg button.on svg{opacity:1;filter:drop-shadow(0 0 4px rgba(var(--ac-rgb),.55))}
/* ============ C 数据层：统计四格（顶色条 + 微光数字）============ */
#dy .nm{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:0 16px;margin-bottom:14px;min-width:0}
#dy .nm>div{position:relative;overflow:hidden;background:var(--glass-2);border:1px solid var(--line-2);border-radius:12px;padding:10px 2px 8px;text-align:center;--dc:var(--t3);transition:background .15s}
#dy .nm>div:hover{background:rgba(255,255,255,.07)}
#dy .nm>div::before{content:'';position:absolute;top:0;left:22%;right:22%;height:1.5px;border-radius:2px;background:var(--dc);opacity:.7;box-shadow:0 0 8px var(--dc)}
#dy .nm .v{font-size:15px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;text-shadow:0 0 6px currentColor}
#dy .nm .l{font-size:10px;color:var(--t3);margin-top:4px;font-weight:600;letter-spacing:1.5px}
#dy .cg{color:var(--c-ok)}
#dy .cr{color:var(--c-bad)}
#dy .cb{color:var(--c-info)}
#dy .cp{color:var(--c-pink)}
#dy .cy{color:var(--c-warn)}
#dy .time{display:flex;flex-direction:column;gap:4px;padding:0 16px 14px;font-size:11px;letter-spacing:.2px;overflow-wrap:anywhere}
#dy #tNow{color:var(--t2)}
#dy #tSave{color:var(--t3)}
#dy .time .hi{color:var(--ac);font-weight:700;text-shadow:0 0 8px rgba(var(--ac-rgb),.3)}
/* ============ D 底部：更多菜单 + 主题点 + 版本 ============ */
#dy .ft{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:10px 16px 13px;border-top:1px solid var(--line-2);background:linear-gradient(180deg,rgba(255,255,255,.018),transparent 70%)}
#dy .more{position:relative;justify-self:start}
#dy .mbtn{position:relative;width:30px;height:30px;border-radius:var(--r-ctrl);border:none;background:none;color:var(--t2);font-family:inherit;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s,transform .1s}
#dy .mbtn::after{content:'';position:absolute;inset:-6px;border-radius:14px}/* 命中区 42px */
#dy .mbtn:hover{color:var(--t1);background:rgba(255,255,255,.09)}
#dy .mbtn:active{transform:scale(.92)}
#dy .menu{position:absolute;bottom:calc(100% + 8px);left:0;min-width:138px;background:var(--menu);backdrop-filter:blur(16px) saturate(2.0);-webkit-backdrop-filter:blur(16px) saturate(2.0);border:1px solid var(--line);border-radius:13px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,.30),0 3px 10px rgba(0,0,0,.16),0 0 0 1px rgba(255,255,255,.05);animation:dyMenuIn .16s cubic-bezier(.2,.9,.3,1)}
#dy .menu .mi{font-size:12px;padding:9px 12px;border-radius:9px;color:var(--t1);cursor:pointer;white-space:nowrap;transition:background .12s,transform .1s}
#dy .menu .mi:hover{background:rgba(255,255,255,.09)}
#dy .menu .mi.danger{color:var(--c-bad)}
#dy .menu .mi.danger:hover{background:rgba(255,92,122,.13)}
#dy .menu .mi.danger.confirm{background:var(--c-bad);color:#fff;font-weight:700;box-shadow:0 0 14px rgba(255,92,122,.4)}
#dy .menu .mi:active{transform:scale(.97);background:rgba(255,255,255,.14)}
#dy .menu .sep{height:1px;margin:5px 9px;background:var(--line-2)}
#dy .tm{display:flex;align-items:center;gap:8px;justify-self:center}
#dy .tm i{position:relative;width:11px;height:11px;border-radius:50%;cursor:pointer;transition:transform .16s,box-shadow .16s}
#dy .tm i::after{content:'';position:absolute;inset:-9px;border-radius:50%}/* 命中区 29px */
#dy .tm i:hover{transform:scale(1.35)}
#dy .tm i.on{box-shadow:0 0 0 2px rgba(10,11,16,.9),0 0 0 3.5px rgba(255,255,255,.85),0 0 12px 1px rgba(255,255,255,.35);transform:scale(1.12)}
#dy .ver{font-size:11px;color:var(--t3);justify-self:end;cursor:default;transition:color .15s}
#dy .ver:hover{color:var(--t2)}
/* ============ 缩放手柄 ============ */
#dy .rs{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:5;background:none;border:0;opacity:.35;transition:opacity .2s}
#dy .rs::after{content:'';position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid var(--t2);border-bottom:2px solid var(--t2);border-radius:0 0 3px 0}
#dy .rs::before{content:'';position:absolute;inset:-7px}/* 命中区扩展 */
#dy:hover .rs{opacity:.7}
#dy .rs:hover{opacity:1}
/* ============ FAB：曜石底 + 主题光环 ============ */
#dy-fab{position:fixed;left:20px;top:36px;width:44px;height:44px;border-radius:15px;z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:pointer;background:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.03) 55%,rgba(255,255,255,0)),var(--glass);backdrop-filter:blur(16px) saturate(1.7);-webkit-backdrop-filter:blur(16px) saturate(1.7);border:1px solid rgba(var(--ac-rgb),.42);box-shadow:0 8px 22px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.14),0 0 14px rgba(var(--ac-rgb),.15);transition:transform .2s cubic-bezier(.34,1.56,.64,1),border-color .2s,box-shadow .2s;touch-action:none;padding:0}
#dy-fab::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.04)}
#dy-fab:hover{transform:scale(1.08) translateY(-1px);border-color:rgba(var(--ac-rgb),.68);box-shadow:0 10px 26px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.15),0 0 20px rgba(var(--ac-rgb),.25)}
#dy-fab:active{transform:scale(.93)}
#dy-fab svg{width:20px;height:20px;color:var(--ac);filter:drop-shadow(0 0 5px rgba(var(--ac-rgb),.35))}
/* ============ 焦点可见性（键盘用户）============ */
#dy :focus-visible,#dy-fab:focus-visible{outline:2px solid rgba(255,255,255,.55);outline-offset:2px}
#dy .sl:focus-visible{outline-offset:7px}
/* ============ 动效 ============ */
@keyframes dyIn{from{opacity:0;transform:translateY(16px) scale(.96);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes dyOut{to{opacity:0;transform:translateY(8px) scale(.97);filter:blur(4px)}}
@keyframes dyBreath{0%,100%{opacity:.55;transform:scale(.88)}50%{opacity:1;transform:scale(1)}}
@keyframes dyPulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes dyEnergy{0%,100%{filter:brightness(.7)}50%{filter:brightness(1.4)}}
@keyframes dyStIn{from{opacity:0;transform:translateX(6px);filter:blur(3px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes dyMenuIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
#dy.closing{animation:dyOut .12s ease-in both;pointer-events:none}
/* —— v18.4 运行态兜底（:has 不支持时以 .running 类同步，JS 在 sync() 里维护）—— */
#dy.running::after{opacity:1;animation:dyEnergy 5.2s ease-in-out infinite}
#dy.running .hd .t::before{background:var(--ac);box-shadow:0 0 9px rgba(var(--ac-rgb),.85);animation:dyBreath 2.4s ease-in-out infinite}
#dy.running .st .m::before{animation:dyPulse 2.4s ease-in-out infinite}
/* —— v18.4 打开级联：7 层 25ms 步进，.casc 每次打开重播 —— */
#dy.casc .hd{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 20ms both}
#dy.casc .st{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 45ms both}
#dy.casc .guide{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 45ms both}
#dy.casc .slw{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 70ms both}
#dy.casc .rg{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 95ms both}
#dy.casc .nm{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 120ms both}
#dy.casc .time{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 145ms both}
#dy.casc .ft{animation:dyCsc .22s cubic-bezier(.2,.9,.25,1) 170ms both}
@keyframes dyCsc{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
/* —— v18.4 计数浮字 —— */
#dy .nm .fl{position:absolute;left:50%;top:2px;transform:translateX(-50%);font-size:10px;font-weight:700;font-style:normal;color:var(--ac);text-shadow:0 1px 3px rgba(0,0,0,.5);pointer-events:none;animation:dyFl .65s ease-out forwards}
@keyframes dyFl{from{opacity:0;transform:translate(-50%,6px)}25%{opacity:1}to{opacity:0;transform:translate(-50%,-14px)}}
/* —— v18.4 音量滑条（⋯菜单内）—— */
#dy .volrow{display:flex;align-items:center;gap:8px;padding:7px 10px 8px;color:var(--t2)}
#dy .volrow svg{width:14px;height:14px;flex:none}
#dy .volrow input{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.16);outline:none;cursor:pointer;margin:0}
#dy .volrow input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.45);cursor:pointer}
#dy .volrow input::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#fff;border:none;box-shadow:0 1px 5px rgba(0,0,0,.45)}
/* —— v19.4：拉满流光条 —— */
#dy .dysweep{position:absolute;top:0;bottom:0;left:0;width:64px;background:linear-gradient(90deg,transparent,rgba(var(--ac-rgb),.55) 35%,rgba(255,255,255,.85) 50%,rgba(var(--ac-rgb),.55) 65%,transparent);filter:blur(1.5px);pointer-events:none;z-index:5}
/* —— v19.4：波纹挂载点需要相对定位 —— */
#dy .menu .mi{position:relative}
#dy .guide .gok{position:relative}
#dy .volrow svg{position:relative}
/* —— v18.5 GPU 特效组（用户授权吃显卡）—— */
/* v18.9：面板边缘旋转流光已按用户要求移除（太突兀）；闪光改到 FAB 光晕与鼠标跟随光效 */
#dy-fab.running{animation:dyFabGlow 2.4s ease-in-out infinite}
@keyframes dyFabGlow{0%,100%{box-shadow:0 8px 22px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.14),0 0 14px rgba(var(--ac-rgb),.15)}50%{box-shadow:0 8px 22px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.14),0 0 30px rgba(var(--ac-rgb),.42)}}
/* v18.6：悬浮球 hover 扫光已按用户要求移除 */
#dy.running{background:linear-gradient(160deg,rgba(var(--ac-rgb),.055),transparent 30%,rgba(var(--ac-rgb),.035) 65%,transparent 85%),var(--glass);background-size:220% 220%;animation:dyBgFlow 30s ease-in-out infinite}
@keyframes dyBgFlow{0%{background-position:0% 0%}50%{background-position:100% 100%}100%{background-position:0% 0%}}
/* v18.6：统计格迷你进度弧已按用户要求移除（像按钮却没反应，视觉噪音） */
#dy .nm .v.flip{animation:dyFlip .3s cubic-bezier(.2,.8,.3,1)}
@keyframes dyFlip{0%{transform:rotateX(80deg);opacity:.15}100%{transform:rotateX(0);opacity:1}}
#dy .volrow input.tk::-webkit-slider-thumb{animation:dyThumbTick .13s cubic-bezier(.3,.7,.4,1)}
/* —— v18.9：台球白球 + 头部音量条 —— */
/* v19.2：白球/弹弓线已按用户要求整体移除（滑条回归原生） */
#dy .hd .volrow{flex:1;padding:0;min-width:0}
#dy .hd .volrow input{height:4px;flex:0 1 0px;width:0;opacity:0;padding:0;transition:flex-basis .25s ease,opacity .25s ease}
#dy .hd .volrow.open input{flex:0 0 76px;width:76px;opacity:1}
#dy .volrow svg{cursor:pointer}
#dy .volrow svg .mu{display:none}
#dy .volrow.muted svg .wv{display:none}
#dy .volrow.muted svg .mu{display:block}
/* —— 搜索框下方所有弹窗/联想/热搜全部隐藏，搜索框本身保留可用 —— */
[data-e2e="search-guess-container"],[data-e2e="search-hot-container"],
[data-e2e*="search-suggest"],[data-e2e*="search-dropdown"],[data-e2e*="search-popup"],
[class*="search-suggest"],[class*="search-hot"],[class*="search-dropdown"],[class*="search-popup"],
[class*="SearchSuggest"],[class*="SearchDropdown"],[class*="SearchPopup"]{display:none!important}
/* —— v18.4 系统减弱动效：动画/过渡全关（粒子/浮字由 JS _prm 双保险）—— */
@media (prefers-reduced-motion:reduce){
  #dy,#dy *,#dy::before,#dy::after,#dy *::before,#dy *::after,#dy-fab,#dy-fab::before{animation:none!important;transition:none!important}
}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  #dy,#dy-fab{background:rgba(10,11,16,.9)}
  #dy .menu{background:rgba(16,18,24,.94)}
}
`;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'dy';
  panel.classList.add('casc'); // v18.4：打开级联入场
  panel.innerHTML = `
<div class="hd" id="dd">
    <div class="volrow hdvol" id="dy-volwrap" title="动效音量（点图标=静音/恢复）">
      <svg id="dy-volicon" viewBox="0 0 24 24" role="button" aria-hidden="true"><path d="M4 9.5v5h3.6l4.9 3.9V5.6L7.6 9.5H4z" fill="currentColor"/><path class="wv" d="M15.8 9a4.4 4.4 0 010 6M18.4 6.6a8 8 0 010 10.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path class="mu" d="M15 9.5l6 5M21 9.5l-6 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
      <input type="range" id="dy-vol" min="0" max="200" step="1" value="70" aria-label="动效音量（最高200%）">
    </div>
    <div class="hact">
    <div class="sw on" id="run" role="switch" aria-checked="true" title="开始/停止"></div>
    </div>
</div>
<div class="bd">
  <div class="st">
    <div class="m cg" id="sm" aria-live="polite">读取中</div>
    <div class="s" id="ss"></div>
  </div>
  <div class="guide" id="dy-guide" style="display:none">
    <span class="gt">低赞视频将自动跳过 · 拖滑块调门槛 · W/S 回看/继续 · 空格=暂停/恢复</span>
    <button class="gok" id="dy-guide-ok">知道了</button>
  </div>
  <div class="slw">
    <div class="slh"><span class="lb">赞数阈值</span><span class="vl" id="slv">≥2万</span></div>
    <div class="slwrap">
      <input type="range" class="sl" id="sl" min="0" max="10" step="1" aria-label="赞数阈值">
      <div class="bub" id="sl-bub" hidden>≥2万</div>
    </div>
    <div class="sle"><span>1千</span><span>500万</span></div>
  </div>
  <div class="rg">
    <button id="rfem" aria-pressed="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21l-1.5-1.35C5.4 15.1 2 12.2 2 8.35 2 5.4 4.4 3 7.35 3c1.7 0 3.35.8 4.65 2.15C13.3 3.8 14.95 3 16.65 3 19.6 3 22 5.4 22 8.35c0 3.85-3.4 6.75-8.5 11.3L12 21z"/></svg>颜值保留</button>
    <button id="rj" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3"/></svg>自动清屏</button>
    <button id="rmus" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.5L20 3.5V16"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="16" r="2.6"/></svg>音乐保留</button>
    <button id="rlive" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.7"/><path d="M6.3 6.3a8.1 8.1 0 0 0 0 11.4M17.7 6.3a8.1 8.1 0 0 1 0 11.4"/></svg>保留直播</button>
  </div>
  <div class="nm">
    <div style="--dc:var(--c-ok)"><div class="v cg" id="nk">0</div><div class="l">保留</div></div>
    <div style="--dc:var(--c-bad)"><div class="v cr" id="ns">0</div><div class="l">跳过</div></div>
    <div style="--dc:var(--c-info)"><div class="v cb" id="nl">0</div><div class="l">直播</div></div>
    <div style="--dc:var(--c-pink)"><div class="v cp" id="nf">0</div><div class="l">男生</div></div>
  </div>
  <div class="time"><span id="tNow"></span><span id="tSave"></span></div>
  <div class="ft">
    <div class="more" id="dy-more">
      <button class="mbtn" id="dy-more-btn" title="更多" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu" id="dy-menu" hidden>
                <div class="mi" id="dy-restart">重启脚本</div>
        <div class="mi" style="padding:8px 12px;cursor:default">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">背景透明度</div>
          <input type="range" id="dy-opacity" min="0" max="95" value="34" style="width:100%;height:4px">
        </div>
        <div class="mi" id="dy-fxmi" title="波纹/震屏/爆彩等装饰性动效总开关">动效：开</div>
        <div class="mi danger" id="dy-cls" title="将删除全部配置与时间账本，不可恢复">清除程序</div>
      </div>
    </div>
    <div class="tm" id="tm">
      <i data-c="255,59,92" data-hex="#FF3B5C" style="background:#FF3B5C"></i>
      <i data-c="78,155,255" data-hex="#4E9BFF" style="background:#4E9BFF"></i>
      <i data-c="44,232,160" data-hex="#2CE8A0" style="background:#2CE8A0"></i>
      <i data-c="178,102,255" data-hex="#B266FF" style="background:#B266FF"></i>
      <i data-c="255,149,0" data-hex="#FF9500" style="background:#FF9500"></i>
      <i data-c="34,222,226" data-hex="#22DEE2" style="background:#22DEE2"></i>
    </div>
    <div class="ver" title="点击重启脚本">v20.0</div>
  </div>
</div>
<div class="rs" id="dy-rs" title="拖动缩放"></div>`;
  document.body.appendChild(panel);
  const fab = document.createElement('button');
  fab.id = 'dy-fab';
  // v16.6 [1]：FAB 图标内联 SVG（漏斗，跟主题色）；三态角标已按用户要求整链删除
  fab.title = '点击展开筛选面板，可拖动';
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5h17l-6.8 7.7v6.1l-3.4 2v-8.1L3.5 5z"/></svg>';
  document.body.appendChild(fab);
  // v14.1：启动时恢复面板位置、zoom、fab位置、打开状态
  function restorePanelLayout() {
    try {
      const pp = JSON.parse(localStorage.getItem('dyhlf_pp') || 'null');
      if (pp && pp.l && pp.t) {
        panel.style.left = pp.l;
        panel.style.top = pp.t;
      }
    } catch(e) {}
    try {
      const z = parseFloat(localStorage.getItem('dyhlf_zoom'));
      if (z && z >= 0.6) {
        panel.style.zoom = z;
        panel.dataset.userZoom = z;
      }
    } catch(e) {}
    try {
      const fp = JSON.parse(localStorage.getItem('dyhlf_fab') || 'null');
      if (fp && fp.x != null && fp.y != null) {
        fab.style.left = fp.x + 'px';
        fab.style.top = fp.y + 'px';
        fab.dataset.customPos = '1';
      }
    } catch(e) {}
    try {
      _panelOpen = localStorage.getItem('dyhlf_open') === '1';
    } catch(e) { _panelOpen = false; }
  }
  function savePanelOpen() {
    // v17.2：改记 _panelOpen——关闭淡出期间 display 仍是 block，读 display 会把"已关"存成"开着"
    try { localStorage.setItem('dyhlf_open', _panelOpen ? '1' : '0'); } catch(e) {}
  }
  // v16.0：首次引导标记（dyhlf_seen 无值 → 首次；面板强制自动展开一次，不写 dyhlf_open）
  let _firstRun = false;
  try { _firstRun = !localStorage.getItem('dyhlf_seen'); } catch(e) {}
  let _panelOpen = false;
  restorePanelLayout();
  if (_firstRun) _panelOpen = true;
  panel.style.display = _panelOpen ? 'block' : 'none'; // 16.0：面板随 FAB 点击展开/收起，首启按 _panelOpen 决定

  const $ = {
    run: document.getElementById('run'),
    rlive: document.getElementById('rlive'),
    rfem: document.getElementById('rfem'),
    rmus: document.getElementById('rmus'),
    rj: document.getElementById('rj'),
    sl: document.getElementById('sl'),
    slv: document.getElementById('slv'),
    tNow: document.getElementById('tNow'),
    tSave: document.getElementById('tSave'),
    nk: document.getElementById('nk'),
    ns: document.getElementById('ns'),
    nl: document.getElementById('nl'),
    nf: document.getElementById('nf'),
    sm: document.getElementById('sm'),
    ss: document.getElementById('ss'),
  };
  // v16.0：新增元素引用（契约 8 个新 ID）
  const _bub = document.getElementById('sl-bub');
  const _slwrap = $.sl.parentElement; // .slwrap
  const _guide = document.getElementById('dy-guide');
  const _menu = document.getElementById('dy-menu');
  const _moreBtn = document.getElementById('dy-more-btn');
  const _restartMi = document.getElementById('dy-restart');

  // v16.0：首次引导条——dyhlf_seen 无值时展示；「知道了」写标记并 0.2s 高度动画收起，此后不再出现
  if (_firstRun && _guide) _guide.style.display = '';
  const _guideOk = document.getElementById('dy-guide-ok');
  if (_guide && _guideOk) {
    _guideOk.addEventListener('click', () => {
      try { localStorage.setItem('dyhlf_seen', '1'); } catch(e) {}
      _guide.style.transition = 'height .2s ease,opacity .2s ease,margin-bottom .2s ease,border-width .2s ease';
      _guide.style.height = _guide.offsetHeight + 'px';
      requestAnimationFrame(() => {
        _guide.style.height = '0px'; _guide.style.opacity = '0';
        _guide.style.marginBottom = '0px'; _guide.style.borderWidth = '0px';
        setTimeout(() => {
          _guide.style.display = 'none';
          _guide.style.transition = ''; _guide.style.height = '';
          _guide.style.opacity = ''; _guide.style.marginBottom = ''; _guide.style.borderWidth = '';
        }, 240);
      });
    });
  }

  // v15.0：阈值滑块（十档 1-2-5 对数序列），替代九宫格
  function fmtThreshold(v){return v>=10000?(v/10000)+'万':v>=1000?(v/1000)+'千':String(v);}
  function paintSlider(){
    const p = ($.sl.value / (THRESHOLD_PRESETS.length - 1)) * 100;
    $.sl.style.background = 'linear-gradient(90deg, var(--ac) ' + p + '%, rgba(255,255,255,.16) ' + p + '%)';
  }
  // v16.0：拖动时浮于 thumb 上方的档位气泡，松手 0.8s 消散（顶行 #slv 保留，双保险）
  let _bubT = null;
  function showBub(){
    // v17.1：维持 v16.6 原实现——AI3 实测现代 Chrome（zoom 已标准化）后代 clientWidth 不含缩放、
    // 与 style.left 同坐标系直读即准，÷zoom 反致偏移（AI1/AI2 的 v16.7[2] 实测不收编）
    const w = _slwrap.clientWidth;
    const x = (+$.sl.value / (THRESHOLD_PRESETS.length - 1)) * (w - 16) + 8;
    _bub.hidden = false;
    _bub.textContent = '≥' + fmtThreshold(THRESHOLD_PRESETS[+$.sl.value]);
    _bub.style.left = x + 'px';
    requestAnimationFrame(() => _bub.classList.add('show'));
    clearTimeout(_bubT);
    _bubT = setTimeout(hideBub, 800);
  }
  function hideBub(){
    _bub.classList.remove('show');
    setTimeout(() => { if (!_bub.classList.contains('show')) _bub.hidden = true; }, 200);
  }
  function applyThreshold(i){
    cfg.threshold = THRESHOLD_PRESETS[i] || cfg.threshold;
    $.slv.textContent = '≥' + fmtThreshold(cfg.threshold);
    // v16.6 [7]：拖阈值后当前视频立即重判（invalidate 已作废在途判定，这里补上重新触发）
    state.activeVid = null; state.handling = false;
    saveCfg(); invalidate(); markDirty(); render();
  }
  $.sl.value = presetIndex(cfg.threshold);
  $.slv.textContent = '≥' + fmtThreshold(cfg.threshold);
  paintSlider();
  $.sl.addEventListener('input', () => { applyThreshold(+$.sl.value); paintSlider(); showBub(); });
  // v16.7 [5]：拖完滑杆即 blur 交还焦点——否则焦点滞留在 range 上，W/S/↑↓ 会被 onKey 的 INPUT 守卫拦截，
  // 用户体感"快捷键失灵"；键盘调档（Tab 聚焦+方向键）无 pointerup，不受影响
  $.sl.addEventListener('pointerup', () => { try { $.sl.blur(); } catch(e){} });

  // ══════════ v18.2 UI 动效模块（迁移自 v18 定稿预览，仅 UI 层，零引擎逻辑）══════════
  // 模块①：合成音效引擎 —— Web Audio 懒创建（首次手势 _ac() 内 resume），零外部文件；
  //         静音态持久化 localStorage(dyhlf_snd)，初始化时恢复并同步 .off 类与 aria-pressed
  let _AC = null, _muted = false, _noiseBuf = null;
  const _prm = (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches; // v18.4：系统减弱动效 → 粒子/浮字全关
  let _vol = 1.5; // 默认音量 150%
  try { const _sv = parseFloat(localStorage.getItem('dyhlf_vol')); if (isFinite(_sv) && _sv >= 0 && _sv <= 200) _vol = _sv / 100; } catch (e) {} // v19.4：上限 200%
  try { _muted = localStorage.getItem('dyhlf_snd') === '0'; } catch (e) {}
  function _ac() {
    if (!_AC) { try { _AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (_AC && _AC.state === 'suspended') _AC.resume();
    return _AC;
  }
  let _lastSfxAt = 0; // v19.2：全局音效节流
  function _tone(o) {
    const c = _ac(); if (!c || _muted) return;
    const _ns = performance.now();
    if (_ns - _lastSfxAt < 60) return; // v19.2：60ms 内的重复音效直接丢弃（用户反馈太密集）
    _lastSfxAt = _ns;
    const { f = 440, f2 = null, t = .12, type = 'sine', g = .1, delay = 0 } = o;
    const osc = c.createOscillator(), gn = c.createGain(), t0 = c.currentTime + delay;
    osc.type = type; osc.frequency.setValueAtTime(f, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + t);
    gn.gain.setValueAtTime(g * _vol, t0); gn.gain.exponentialRampToValueAtTime(.0001, t0 + t);
    osc.connect(gn).connect(c.destination); osc.start(t0); osc.stop(t0 + t + .02);
  }
  function _noiseHit(o) {
    const c = _ac(); if (!c || _muted) return;
    const { t = .08, g = .1, f = 1800, q = 1, delay = 0 } = o;
    // v18.4：共享噪声 buffer（预生成 0.25s，start(offset,duration) 截段复用，省每次分配）
    if (!_noiseBuf) { _noiseBuf = c.createBuffer(1, Math.max(1, c.sampleRate * .25 | 0), c.sampleRate); const _d = _noiseBuf.getChannelData(0); for (let i = 0; i < _d.length; i++) _d[i] = Math.random() * 2 - 1; }
    const n = c.createBufferSource(); n.buffer = _noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const gn = c.createGain(), t0 = c.currentTime + delay;
    gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(.0001, t0 + t);
    gn.gain.setValueAtTime(g * _vol, t0);
    n.connect(bp).connect(gn).connect(c.destination); n.start(t0, 0, Math.min(t, .25));
  }
  const SFX = {
    tick: v => _tone({ f: [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093][v] || 523.25, t: .06, type: 'sine', g: .15 }),
    hit: () => { _tone({ f: 170, f2: 55, t: .2, g: .4 }); _noiseHit({ t: .12, g: .2, f: 2400, q: .8 }); _tone({ f: 1240, t: .25, type: 'triangle', g: .1, delay: .02 }); },
    pop: () => { const k = .9 + Math.random() * .25; _tone({ f: 520 * k, f2: 150 * k, t: .1, g: .25 }); _noiseHit({ t: .04, g: .08, f: 3000, q: 2 }); },
    note: (f, oct) => _tone({ f: f * (oct ? 2 : 1), t: .2, g: .12 }),
    click: () => _tone({ f: 880, f2: 640, t: .07, type: 'triangle', g: .15 }),
    sw: () => { _tone({ f: 660, f2: 990, t: .1, type: 'triangle', g: .15 }); _noiseHit({ t: .05, g: .06, f: 2600, q: 2 }); },
    menu: () => _tone({ f: 420, f2: 620, t: .1, type: 'sine', g: .12 }),
    warn: () => _tone({ f: 330, f2: 220, t: .16, type: 'square', g: .1 }),
    star: () => _tone({ f: 1318, t: .12, type: 'sine', g: .1 }),
    coin: () => { _tone({ f: 988, t: .08, type: 'triangle', g: .12 }); _tone({ f: 1319, t: .15, type: 'triangle', g: .12, delay: .06 }); },
    tap: () => { _tone({ f: 190, f2: 90, t: .08, g: .15 }); _noiseHit({ t: .04, g: .08, f: 2000, q: 1 }); },
  };
  // v19.1：静音开关=音量小图标 #dy-volicon（旧 #snd 按钮已删，残留绑定已清）；静音态 1448 行初始化恢复
  // v18.4 模块①b：音量滑条 —— 调 SFX 总增益，持久化 dyhlf_vol
  const _volSl = document.getElementById('dy-vol');
  if (_volSl) {
    _volSl.value = String(Math.round(_vol * 100));
    _volSl.addEventListener('input', () => {
      _vol = (+_volSl.value) / 100;
      try { localStorage.setItem('dyhlf_vol', String(_volSl.value)); } catch (e) {}
      const _vstep = Math.round(_vol * 20);
      if (_vstep !== (_volSl._lastStep || -1)) { _volSl._lastStep = _vstep; SFX.tick(_vstep); } // v19.0：按步进触发，杜绝连发音
    });
    _volSl.addEventListener('animationend', () => _volSl.classList.remove('tk'));
  }
  // v19.1：音量小图标=静音开关（替代已删的 #snd 按钮）；滑条不调整 2 秒后自动收起只留图标
  const _volWrap = document.getElementById('dy-volwrap');
  const _volIcon = document.getElementById('dy-volicon');
  let _volHideT = null;
  const _volSyncMute = () => { if (_volWrap) _volWrap.classList.toggle('muted', _muted); };
  _volSyncMute();
  if (_volIcon) _volIcon.addEventListener('click', () => {
    _muted = !_muted;
    _volSyncMute();
    try { localStorage.setItem('dyhlf_snd', _muted ? '0' : '1'); } catch (e) {}
    if (!_muted) SFX.tick(6);
  });
  if (_volWrap) {
    const _volOpen = () => {
      _volWrap.classList.add('open');
      clearTimeout(_volHideT);
      _volHideT = setTimeout(() => { if (!_volSl || !_volSl._dragging) _volWrap.classList.remove('open'); }, 2000);
    };
    _volWrap.addEventListener('pointerenter', _volOpen);
    _volSl.addEventListener('pointerdown', () => { _volSl._dragging = true; _volOpen(); });
    ['pointerup', 'pointercancel'].forEach(ev => _volSl.addEventListener(ev, () => { _volSl._dragging = false; _volOpen(); }));
    _volSl.addEventListener('input', _volOpen);
    _disposers.push(() => clearTimeout(_volHideT));
  }
  // 模块②：粒子层 —— #dy-fx 宿主挂 body、z-index 低于面板；spawnParts 上限 70 防长按堆爆；
  //          stop() 与启动自清理均会 remove 宿主
  const _fxHost = document.createElement('div');
  _fxHost.id = 'dy-fx';
  document.body.appendChild(_fxHost);
  // v20.0：UI 动效总开关——装饰性动效（波纹/震屏/爆彩/浮字/果冻按压/海浪）入口统一走 fxOn()
  const fxOn = () => cfg.fx !== false;
  function _confetti() {
    if (_prm || !fxOn()) return;
    try { SFX.coin(); } catch (e) {}
    const r = panel.getBoundingClientRect();
    const cols = ['61,232,160', '255,197,61', '90,176,255', '255,111,168', '255,255,255'];
    for (let i = 0; i < 60; i++) { // v18.5：爆彩翻倍
      const p = document.createElement('i'), sz = 2.5 + Math.random() * 4;
      const rgb = cols[i % cols.length];
      p.style.cssText = `left:${r.left + r.width / 2 + (Math.random() - .5) * 60}px;top:${r.top + 8}px;width:${sz}px;height:${sz}px;background:rgb(${rgb});box-shadow:0 0 ${sz * 2}px rgba(${rgb},.85)`;
      const dx = (Math.random() - .5) * 190, dy = 50 + Math.random() * 120, dur = .8 + Math.random() * .6;
      p.animate([
        { transform: 'translate(0,-6px) scale(.5)', opacity: 0 },
        { transform: `translate(${dx * .35}px,${dy * .25 - 18}px) scale(1.1)`, opacity: 1, offset: .28 },
        { transform: `translate(${dx}px,${dy}px) scale(.4)`, opacity: 0 }
      ], { duration: dur * 1000, easing: 'cubic-bezier(.25,.46,.45,.94)' }).onfinish = () => p.remove();
      _fxHost.appendChild(p);
    }
  }
  function _floatUp(el, txt) {
    if (_prm || !fxOn()) return;
    try {
      const cell = el.parentElement; if (!cell) return;
      const f = document.createElement('b');
      f.className = 'fl'; f.textContent = txt;
      cell.appendChild(f);
      setTimeout(() => f.remove(), 700);
    } catch (e) {}
  }
  // —— v18.5 新增：全屏彩带雨 / 能量线判定闪烁 / 主题点波纹（全部一次性 WAAPI，GPU 合成）——
  function _ribbonRain() {
    if (_prm) return;
    const cols = ['61,232,160', '255,197,61', '90,176,255', '255,111,168', '255,92,122'];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('i'), w = 3 + Math.random() * 3, h = 8 + Math.random() * 8;
      const rgb = cols[i % cols.length];
      p.style.cssText = `left:${Math.random() * 100}vw;top:-20px;width:${w}px;height:${h}px;border-radius:1.5px;background:rgb(${rgb});box-shadow:0 0 6px rgba(${rgb},.6)`;
      const dur = 1 + Math.random() * .8, sway = (Math.random() - .5) * 160, rot = (Math.random() - .5) * 720;
      p.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: .95 },
        { transform: `translate(${sway}px,${(innerHeight * .6) | 0}px) rotate(${rot * .6}deg)`, opacity: .9, offset: .6 },
        { transform: `translate(${sway * 1.4}px,${innerHeight + 30}px) rotate(${rot}deg)`, opacity: 0 }
      ], { duration: dur * 1000, easing: 'cubic-bezier(.3,.4,.6,1)' }).onfinish = () => p.remove();
      _fxHost.appendChild(p);
    }
  }
  function _energyFlash() {
    try { panel.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.9)', offset: .25 }, { filter: 'brightness(1)' }], { duration: 300, easing: 'ease-out', pseudoElement: '::after' }); } catch (e) {}
  }
  function _themeRipple(x, y, rgb) {
    if (_prm) return;
    const pr = panel.getBoundingClientRect();
    const z = parseFloat(panel.style.zoom) || 1; // v19.3：面板缩放≠1 时本地坐标要除回 zoom，否则波纹错位
    const rp = document.createElement('span');
    rp.style.cssText = `position:absolute;left:${(x - pr.left) / z}px;top:${(y - pr.top) / z}px;width:${14 / z}px;height:${14 / z}px;border-radius:50%;border:2px solid rgba(${rgb},.7);transform:translate(-50%,-50%) scale(.4);pointer-events:none`;
    panel.appendChild(rp);
    rp.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: .9 },
      { transform: 'translate(-50%,-50%) scale(9)', opacity: 0 }
    ], { duration: 480, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => rp.remove();
  }
  // 模块③：解压状态卡 —— pointerdown 果冻挤压（先 cancel 旧的再播）+ .rp 涟漪 + pop 音；
  //          纯解压交互，不绑任何引擎行为
  const _stCard = panel.querySelector('.st');
  let _jellyAni = null;
  if (_stCard) {
    _stCard.addEventListener('pointerdown', e => {
      if (!fxOn()) return;
      _jellyAni && _jellyAni.cancel();
      _jellyAni = _stCard.animate([
        { transform: 'scale(1,1)', easing: 'ease-out' },
        { transform: 'scale(.93,1.07) translateY(-1px)', offset: .18, easing: 'ease-out' },
        { transform: 'scale(1.06,.93) translateY(1px)', offset: .42, easing: 'ease-out' },
        { transform: 'scale(.98,1.02)', offset: .65, easing: 'ease-out' },
        { transform: 'scale(1.01,.995)', offset: .84 },
        { transform: 'scale(1,1)' }
      ], { duration: 460 });
      // v20.0：涟漪坐标必须除以面板 zoom——getBoundingClientRect 是视觉像素，
      // 而 .rp 在 zoom 容器内按布局像素定位，不除会往右下漂（缩放越大漂得越多）
      const z = parseFloat(panel.style.zoom) || 1;
      const r = _stCard.getBoundingClientRect(), sz = 90;
      const rp = document.createElement('span'); rp.className = 'rp';
      rp.style.left = (((e.clientX || r.left + r.width / 2) - r.left) / z) + 'px';
      rp.style.top = (((e.clientY || r.top + r.height / 2) - r.top) / z) + 'px';
      rp.style.width = rp.style.height = sz + 'px';
      _stCard.appendChild(rp); setTimeout(() => rp.remove(), 580);
      SFX.pop();
    });
    // 【用户裁定·程序说明】v18.5：状态卡是纯解压小卡片——只许果冻挤压/涟漪/音效，
    // 不要绑定播放暂停、跳转或任何影响视频的行为（v18.4 曾绑过"点击=播放暂停"，实测点卡片
    // 会把视频停了，已按用户要求移除）。往后迭代也不许在此卡上挂任何视频控制逻辑。
  }
  // 模块④：滑块撞击与微反馈接线 —— 追加监听，原 input 处理（applyThreshold/paintSlider/showBub）不动。
  //          过档：拇指挤压(dyThumbTick)/刻度闪(dyTickF)/值芯片弹跳(dyVlPop) + tick 音；
  //          到端点：impactFx 震屏（WAAPI 逐段缓动必须写在每个 keyframe 的 easing 属性——
  //          options.easing 作用于整条时间线，会把震动压缩成瞬间）+ 能量线爆闪 + 粒子迸溅 + hit 音；
  //          按住尽头不松手：560ms 后接管 96ms 无限微震 + 110ms 粒子雨，松手/离端点全停
  const _acRgb = () => ((getComputedStyle(panel).getPropertyValue('--ac-rgb') || '').trim() || '255,59,92');
  let _lastSl = +$.sl.value;
  let _slDragging = false;
  let _rumbleAni = null, _partTimer = null, _rumblePend = null;
  function _impactFx() {
    if (!fxOn()) return;
    // 拉满重震：面板左右猛晃一下
    panel.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(-13px)', offset: .13 },
      { transform: 'translateX(9px)', offset: .34 },
      { transform: 'translateX(-5px)', offset: .55 },
      { transform: 'translateX(0)' }
    ], { duration: 400 });
  }
  // —— v19.6：拉满海浪——光带一波接一波从左往右推过阈值区，停在最右档就一直保持 ——
  let _waveRaf = null, _waveLast = 0;
  function _waveTick(now) {
    if (_stopped) { _waveRaf = null; return; }
    if (+$.sl.value !== THRESHOLD_PRESETS.length - 1) { _waveRaf = null; return; } // 离开最右档即停
    if (now - _waveLast > 280) {
      _waveLast = now;
      const s = document.createElement('span');
      s.className = 'dysweep';
      _slwrap.appendChild(s);
      const w = _slwrap.getBoundingClientRect().width;
      s.animate([
        { transform: 'translateX(-70px) scaleY(.7)', opacity: 0 },
        { transform: `translateX(${w * .4}px) scaleY(1)`, opacity: .95, offset: .45 },
        { transform: `translateX(${w + 70}px) scaleY(.7)`, opacity: 0 }
      ], { duration: 620, easing: 'cubic-bezier(.35,.3,.45,.8)' }).onfinish = () => s.remove();
    }
    _waveRaf = requestAnimationFrame(_waveTick);
  }
  function _lightSweep() {
    if (!fxOn()) return;
    if (!_waveRaf) { _waveLast = 0; _waveRaf = requestAnimationFrame(_waveTick); }
  }
  // —— v19.4：全按钮点击波纹（从点击处荡开一圈色环；本地坐标按面板 zoom 换算）——
  function _btnRing(el, e) {
    if (_prm || !fxOn() || !el) return;
    try {
      // v19.10a：SVG 目标（音量图标）不能直接塞 HTML 波纹，改挂父容器；static 定位的宿主
      // 会被波纹锚到面板原点导致位置对不上鼠标，就地补 position:relative
      const isSvg = typeof SVGElement !== 'undefined' && el instanceof SVGElement;
      const host = isSvg ? (el.parentElement || el) : el;
      if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const r = host.getBoundingClientRect();
      const z = panel.contains(host) ? (parseFloat(panel.style.zoom) || 1) : 1;
      const cx = (e && e.clientX ? e.clientX : r.left + r.width / 2), cy = (e && e.clientY ? e.clientY : r.top + r.height / 2);
      const rp = document.createElement('span');
      rp.style.cssText = `position:absolute;left:${(cx - r.left) / z}px;top:${(cy - r.top) / z}px;width:${14 / z}px;height:${14 / z}px;border-radius:50%;border:2px solid rgba(${_acRgb()},.7);transform:translate(-50%,-50%) scale(.4);pointer-events:none`;
      host.appendChild(rp);
      rp.animate([
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: .9 },
        { transform: 'translate(-50%,-50%) scale(9)', opacity: 0 }
      ], { duration: 480, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => rp.remove(); // v19.5：与调色盘波纹同款
    } catch (err) {}
  }
  onDoc('click', e => {
    if (_prm || syntheticDepth > 0) return;
    const el = e.target && e.target.closest && e.target.closest('.sw,.mbtn,.menu .mi,.gok,.nm>div,#dy-fab,#dy-volicon'); // v19.10：状态卡与四策略芯片不叠波纹（自带果冻/粒子/音效）
    if (el) _btnRing(el, e);
  }, true);
  function _stopRumble() {
    if (_rumbleAni) { try { _rumbleAni.cancel(); } catch (e) {} _rumbleAni = null; }
    if (_partTimer) { clearInterval(_partTimer); _partTimer = null; }
    clearTimeout(_rumblePend); _rumblePend = null;
  }
  $.sl.addEventListener('pointerdown', () => { _slDragging = true; });
  ['pointerup', 'pointercancel'].forEach(ev => $.sl.addEventListener(ev, () => { _slDragging = false; _stopRumble(); }));
  let _slTickAt = 0;
  $.sl.addEventListener('input', () => {
    const _maxI = THRESHOLD_PRESETS.length - 1;
    const v = +$.sl.value, wasMax = (_lastSl === _maxI);
    // 过档音效（130ms 节流）
    if (v !== _lastSl) {
      const _tn = performance.now();
      if (_tn - _slTickAt > 60) { _slTickAt = _tn; SFX.tick(v); }
    }
    // 拉到最右档：重音效 + 震屏 + 海浪持续
    if (v === _maxI && !wasMax) { SFX.hit(); _impactFx(); _lightSweep(); }
    _lastSl = v;
  });
  $.sl.addEventListener('animationend', () => { $.sl.classList.remove('tk', 'imp'); });
  _slwrap.addEventListener('animationend', () => { _slwrap.classList.remove('tk'); });
  $.slv.addEventListener('animationend', () => { $.slv.classList.remove('pop'); });
  // v19.2：白球/弹弓/台球整链已移除，阈值滑条回归原生拖动
  // ══════════ v18.2 UI 动效模块结束 ══════════

  function saveFabPos() {
    try {
      localStorage.setItem('dyhlf_fab', JSON.stringify({
        x: parseFloat(fab.style.left) || 0,
        y: parseFloat(fab.style.top) || 0
      }));
    } catch(e) {}
  }
  const findLogo = () => [...document.querySelectorAll('a')].find(a => /^(https?:)?\/\/www\.douyin\.com\//i.test(a.getAttribute('href') || ''));
  function pinToLogo(){
    const logo = findLogo();
    if (!logo) return false;
    const r = logo.getBoundingClientRect();
    if (!(r.width > 0)) return false;
    const cs = getComputedStyle(logo);
    const px = v => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); return m ? parseFloat(m[1]) : null; };
    const pct = v => { const m = /^(-?[\d.]+)%$/.exec(String(v).trim()); return m ? parseFloat(m[1]) / 100 : null; };
    const sz = cs.backgroundSize.split(/\s+/);
    const ps = cs.backgroundPosition.split(/\s+/);
    let bw = px(sz[0]), bh = sz[1] != null ? px(sz[1]) : null;
    if (bw == null || bh == null) { bw = r.width; bh = r.height; }
    let bgL, bgT;
    const pxX = px(ps[0] || ''), pxY = px(ps[1]) != null ? px(ps[1]) : null;
    if (pxX != null) bgL = r.left + pxX; else bgL = r.left + (r.width - bw) * (pct(ps[0]) != null ? pct(ps[0]) : 0.5);
    if (pxY != null) bgT = r.top + pxY; else bgT = r.top + (r.height - bh) * (pct(ps[1]) != null ? pct(ps[1]) : 0.5);
    let noteX0, noteY0;
    if (bw > 44) {
      noteX0 = bgL + bw * 0.236;
      noteY0 = bgT + bh * 0.286;
    } else {
      noteX0 = bgL - 2;
      noteY0 = bgT + bh * 0.004;
    }
    fab.style.left = Math.max(0, noteX0) + 'px';
    fab.style.top = Math.max(0, noteY0) + 'px';
    return true;
  }
  const _pinTimers = [];
  (()=>{
    if (fab.dataset.customPos === '1') return;
    const tryPin = (tries) => {
      if (pinToLogo()) return;
      if (tries > 0) _pinTimers.push(setTimeout(() => tryPin(tries - 1), 300));
    };
    tryPin(10);
  })();
  let pressId = 0, curPress = 0, draggedThisPress = false;
  let _ppT = null; // v17.1：面板位置落盘防抖——拖拽 mousemove/touchmove 每帧都调 placePanel，不能每帧同步写 localStorage
  function placePanel(){
    const fr=fab.getBoundingClientRect();
    const pr=panel.getBoundingClientRect();
    const pw=pr.width||panel.offsetWidth, ph=pr.height||panel.offsetHeight, gap=10;
    const z = parseFloat(panel.style.zoom) || 1;
    let pl = fr.right + gap;
    if (pl + pw > vw - 4) pl = Math.max(4, fr.left - gap - pw);
    if (pl + pw > vw - 4) pl = Math.max(4, vw - 4 - pw);
    let pt = fr.top;
    if (pt + ph > vh - 4) pt = Math.max(4, vh - 4 - ph);
    panel.style.left=(pl/z)+'px'; panel.style.top=(pt/z)+'px';
    clearTimeout(_ppT);
    _ppT = setTimeout(() => { try{localStorage.setItem('dyhlf_pp',JSON.stringify({l:panel.style.left,t:panel.style.top}))}catch(e){} }, 200);
  }
  const SNAP = 160;
  function trySnap(){
    const logo = findLogo();
    if (!logo) return;
    const r = logo.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const fr = fab.getBoundingClientRect();
    if (Math.hypot(fr.left - r.left, fr.top - r.top) > SNAP) return;
    if (!pinToLogo()) return;
    if (panel.style.display !== 'none') {
      closePanelAnim(); // v17.2：吸附收起也走淡出
      _panelOpen = false;
    }
  }
  (()=>{let d=false,sx=0,sy=0,maxDev=0,fx=0,fy=0;
    fab.addEventListener('mousedown',e=>{if(e.button!==0)return;
      d=true;maxDev=0;sx=e.clientX;sy=e.clientY;fx=e.clientX-fab.offsetLeft;fy=e.clientY-fab.offsetTop;
      curPress=++pressId;draggedThisPress=false;e.preventDefault();});
    onDoc('mousemove',e=>{if(!d)return;
      maxDev=Math.max(maxDev,Math.hypot(e.clientX-sx,e.clientY-sy));
      if(maxDev>2)draggedThisPress=true;
      const nx=Math.max(0,Math.min(vw-fab.offsetWidth,e.clientX-fx));
      const ny=Math.max(0,Math.min(vh-fab.offsetHeight,e.clientY-fy));
      fab.style.left=nx+'px';fab.style.top=ny+'px';
      if(panel.style.display!=='none')placePanel();});
    onDoc('mouseup',()=>{if(d&&maxDev>2){fab.dataset.dragged='1';draggedThisPress=true;trySnap();saveFabPos();}d=false;});
  })();
  let tId=null,tlx=0,tly=0,tmax=0;
  fab.addEventListener('touchstart',e=>{const t=e.changedTouches[0];tId=t.identifier;tlx=t.clientX;tly=t.clientY;tmax=0;curPress=++pressId;draggedThisPress=false;},{passive:true});
  fab.addEventListener('touchmove',e=>{
    for(const t of e.changedTouches){
      if(t.identifier!==tId)continue;
      const dx=t.clientX-tlx,dy=t.clientY-tly;tlx=t.clientX;tly=t.clientY;
      tmax=Math.max(tmax,Math.hypot(dx,dy));
      if(tmax>2){e.preventDefault();draggedThisPress=true;
        const cr=fab.getBoundingClientRect();
        const nx=Math.max(0,Math.min(vw-fab.offsetWidth,cr.left+dx));
        const ny=Math.max(0,Math.min(vh-fab.offsetHeight,cr.top+dy));
        fab.style.left=nx+'px';fab.style.top=ny+'px';
        if(panel.style.display!=='none')placePanel();}
    }
  },{passive:false});
  fab.addEventListener('touchend',e=>{if(tmax>2){draggedThisPress=true;e.preventDefault();trySnap();saveFabPos();}tId=null;tmax=0;});
  // v17.2：面板关闭补 120ms 淡出（dyOut），与入场 dyIn 对称；closing 类守卫防陈旧定时器误关重开的面板
  let _closeT = null;
  function closePanelAnim(){
    if (panel.style.display === 'none') return;
    panel.classList.add('closing');
    clearTimeout(_closeT);
    _closeT = setTimeout(() => {
      if (panel.classList.contains('closing')) {
        panel.classList.remove('closing');
        panel.style.display = 'none';
      }
    }, 120);
  }
  fab.onclick=()=>{
    if(draggedThisPress && curPress===pressId){fab.dataset.dragged='';return;}
    fab.dataset.dragged='';
    // v17.2：判定用 _panelOpen——淡出进行中（display 仍 block）再点 FAB = 取消关闭、重新打开
    const open=_panelOpen && panel.style.display!=='none';
    if(open){
      closePanelAnim(); _panelOpen=false; // v17.2：关闭走淡出
      pinToLogo();
    }else{
      clearTimeout(_closeT); panel.classList.remove('closing');
      panel.style.display='block';
      placePanel();
      _panelOpen=true;
      setTimeout(_measurePanel, 50);
    }
    savePanelOpen();
  };
  // v16.4：FAB 框架已还原（16.0），上面为悬浮球创建/吸附/拖拽/点击全部逻辑
  // v16.0：缩放基准运行时量取（替换硬编码 BASE_W/BASE_H，面板高度不再受 378 约束）。
  // Chrome 的 zoom 参与 layout，offsetWidth/Height 含缩放量，量取后 ÷zoom 还原自然尺寸；
  // 量取值经共享 let 变量同步刷新 maxZoom 与拖拽缩放分母；ResizeObserver 盯 #dy 单路径，
  // 字体晚到 reflow 也会自动触发重测。两守卫：拖拽缩放期防重入；display:none 时跳过（0×0 不能污染缓存）。
  let BASE_W = 224, BASE_H = 432; // 参考自然尺寸 224×432@zoom1，运行时量取覆盖
  let _zoomDragging = false;
  const maxZoom = () => Math.min((vh - 8) / BASE_H, (vw - 8) / BASE_W);
  function _measurePanel(){
    if (_zoomDragging) return;
    if (panel.style.display === 'none' || !document.contains(panel)) return;
    const ow = panel.offsetWidth, oh = panel.offsetHeight;
    if (!ow || !oh) return;
    const z = parseFloat(panel.style.zoom) || 1;
    if (!(z > 0)) return;
    const nw = Math.round(ow / z), nh = Math.round(oh / z);
    if (nw > 10 && nh > 10 && (nw !== BASE_W || nh !== BASE_H)) {
      BASE_W = nw; BASE_H = nh;
      placePanel();
    }
  }
  const _ro = (typeof ResizeObserver === 'function') ? new ResizeObserver(() => _measurePanel()) : null;
  if (_ro) {
    _ro.observe(panel);
    _disposers.push(() => { try { _ro.disconnect(); } catch(e){} });
  }

  function fmt(n){return n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':String(n);}
  function sync(){
    $.run.classList.toggle('on',cfg.enabled);
    $.run.setAttribute('aria-checked', String(!!cfg.enabled));
    $.rlive.classList.toggle('on',!cfg.skipLive);
    $.rfem.classList.toggle('on',cfg.keepFemale);
    $.rmus.classList.toggle('on',cfg.keepMusic);
    $.rj.classList.toggle('on',cfg.autoJ);
    $.rlive.setAttribute('aria-pressed', String(!cfg.skipLive));
    $.rfem.setAttribute('aria-pressed', String(!!cfg.keepFemale));
    $.rmus.setAttribute('aria-pressed', String(!!cfg.keepMusic));
    $.rj.setAttribute('aria-pressed', String(!!cfg.autoJ));
    if (typeof syncKeepUi === 'function') syncKeepUi(); // v20.0：保留对象女生/男生切换后同步计数格与提示
    panel.classList.toggle('running', cfg.enabled); // v18.4：运行态类（:has 不支持时的兜底，能量线/呼吸点/脉冲用）
    fab.classList.toggle('running', cfg.enabled); // v18.5：FAB 光晕呼吸（运行态）
  }
  // v14.1：脏标记保留（避免每次 tick 都刷 UI），但所有 state 变更处都补了 markDirty()
  let _dirty = true;
  function markDirty(){ _dirty = true; }
  // v16.0：统计数字 450ms cubic-out 滚动。代际 token：新调用使旧 rAF 循环失效，
  // 防连跳高频 +1 时新旧循环互写回跳；from 取当前显示值；隐藏页签/无 rAF/非数字时降级直接写 textContent。
  const _cntToks = new Map();
  _disposers.push(() => { _cntToks.clear(); });
  function countUp(el, to){
    const from = parseInt(el.textContent, 10) || 0;
    if (to > from && !_prm) _floatUp(el, '+' + (to - from)); // v18.4：+1 浮字（v18.9 扩到四格）
    if (from === to || document.hidden || typeof requestAnimationFrame !== 'function' || !el.isConnected) {
      el.textContent = to;
      return;
    }
    const tok = (_cntToks.get(el) || 0) + 1;
    _cntToks.set(el, tok);
    const t0 = performance.now();
    const step = t => {
      if (_cntToks.get(el) !== tok) return;
      const k = Math.min(1, (t - t0) / 450);
      el.textContent = Math.round(from + (to - from) * (1 - (1 - k) * (1 - k) * (1 - k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // v16.0：状态卡文案进出场重触发（仅内容变化时，避免定时器空刷造成闪烁）
  let _lastSm = null, _lastSs = null;
  let _lastFxV = null, _lastMile = -1; // v18.4：判定反馈/里程碑去重
  function setSt(cls, m, s){
    if ($.sm.className !== cls || $.sm.textContent !== m || _lastSm === null) {
      $.sm.className = cls;
      $.sm.textContent = m;
      $.sm.style.animation = 'none'; void $.sm.offsetWidth; $.sm.style.animation = '';
      _lastSm = m;
    }
    if ($.ss.textContent !== s || _lastSs === null) {
      $.ss.textContent = s;
      $.ss.style.animation = 'none'; void $.ss.offsetWidth; $.ss.style.animation = '';
      _lastSs = s;
    }
  }
  function render(){
    if(!_dirty) return;
    _dirty = false;
    sync();
    countUp($.nk, state.kept);
    countUp($.ns, state.skipped);
    countUp($.nl, state.liveSkipped);
    countUp($.nf, state.femaleKept);
    // v15.1：时间账本拆两行，"今日"用高亮色，避免单行超宽截断
    $.tNow.textContent = '本次 ' + fmtDur(Math.floor(_visibleMs/1000));
    $.tSave.innerHTML = '已省 今日 <span class="hi">' + fmtDur(_timeStats.today) + '</span> · 累计 ' + fmtDur(_timeStats.total);
    const r=state.lastResult||{};
    // v18.4：判定反馈粒子（绿星=保留类/红粒=跳过类，仅判定变化时）+ 每 50 跳里程碑爆彩 —— UI 层，引擎零改动
    if (r.verdict && r.verdict !== _lastFxV) {
      _lastFxV = r.verdict;
      _energyFlash(); // v18.5：每判定一次，能量线闪一下（看清引擎在干活）
      // v18.6：判定星屑粒子与星音已按用户要求移除（每刷一个视频弹一次太吵）
    }
    if (state.skipped !== _lastMile) {
      if (state.skipped > 0 && state.skipped % 50 === 0) _confetti();
      _lastMile = state.skipped;
    }
    const _tot = state.kept + state.skipped + state.liveSkipped + state.femaleKept + 1; // v18.5：迷你进度弧占比
    $.nk.parentElement.style.setProperty('--pct', Math.min(100, Math.round(state.kept / _tot * 100)));
    $.ns.parentElement.style.setProperty('--pct', Math.min(100, Math.round(state.skipped / _tot * 100)));
    $.nl.parentElement.style.setProperty('--pct', Math.min(100, Math.round(state.liveSkipped / _tot * 100)));
    $.nf.parentElement.style.setProperty('--pct', Math.min(100, Math.round(state.femaleKept / _tot * 100)));
    // v16.6 [4]：「已停止」最优先——否则空格暂停后关运行开关，面板恒显「暂停」
    //（pollPauseState 因 cfg.enabled=false 停跑，不再纠偏）；已停止/主页副文案补全（v16.6 [11]）
    if(!cfg.enabled){setSt('m cy','已停止','静默中 · 打开开关恢复');return;}
    if(commentsOpen()){setSt('m cy','评论中','自动刷已暂停');return;}
    if(state.authorPage){setSt('m cp','主页','作者主页 · 自动停刷');return;}
    if(userPauseMode){setSt('m cy','暂停','暂停中 · 按空格播放或按 S 继续');return;} // v16.0：退出方式提示（§4.6）
    if(userBackMode){setSt('m cp','回看','回看中 · 按 S 或下滚继续');return;} // v16.0：退出方式提示（§4.6）
    if(r.verdict==='userback'){setSt('m cp','回看','回看中 · 按 S 或下滚继续');return;} // v14.2：补 userback 分支，不再落到"读取中"
    // v16.0：连跳 turbo 标注（§4.6/§6，引擎拼装项）
    const _turboSs = state.consecutiveSkips >= 2 ? '连跳加速中' : null;
    // v20.0：过滤静默失效告警——连续 15 个视频赞数读不到时显式提示，不再"退化成透明人毫无察觉"
    if (cfg.enabled && cfg.autoSkip && (state.unknownStreak || 0) >= 15) {
      setSt('m cy', '读取异常', '连续 ' + state.unknownStreak + ' 个赞数读取失败 · 抖音可能改版，低赞过滤可能停摆');
      return;
    }
    if(r.verdict==='live'){setSt('m cb','直播',_turboSs||'');}
    else if(r.verdict==='game-shopping'){setSt('m cr','购物',_turboSs||'');}
    else if(r.verdict==='male-skip'){setSt('m cr','男性',_turboSs||'');}
    else if(r.verdict==='music-keep'){setSt('m cg','音乐保留',_turboSs||'汽水音乐');}
    else if(r.verdict==='female-keep'){setSt('m cp',cfg.keepGender==='m'?'男生保留':'女生保留',_turboSs||(r.hit?'命中「'+r.hit+'」':''));} // v20.0：保留对象随芯片切换，粉=保留契约
    else if(r.verdict==='keep'){setSt('m cg',fmt(r.value)+'赞',_turboSs||'达标');}
    else if(r.verdict==='low'){setSt('m cr',fmt(r.value)+'赞',_turboSs||'低赞');}
    else{setSt('m cy','读取中','');}
    // v16.6 [1]：三态角标同步块已删（因 render 各状态分支提前 return，原块本就是死代码）
  }
  function toggleOpt(key, needRecheck){
    cfg[key]=!cfg[key];saveCfg();invalidate();
    if(needRecheck){state.activeVid=null;state.handling=false;}
    markDirty();render();
  }
  $.run.onclick=()=>{
    toggleOpt('enabled',false);
    // v16.6 [4]：关停时清掉暂停/回看态（恢复运行时由 pollPauseState 重新同步真实暂停态）
    if (!cfg.enabled) { userPauseMode = false; userBackMode = false; backArmed = false; markDirty(); render(); }
  };
  $.rlive.onclick=()=>toggleOpt('skipLive',true);
  // v20.0：颜值保留芯片点击循环 女生保留→男生保留→关闭→女生保留（默认女生）
  function syncKeepUi() {
    const nf = document.getElementById('nf');
    if (nf && nf.parentElement) {
      const lab = nf.parentElement.querySelector('.l');
      if (lab) lab.textContent = cfg.keepGender === 'm' ? '男生' : '女生';
      nf.parentElement.title = cfg.keepFemale
        ? (cfg.keepGender === 'm' ? '命中男生词库而保留' : '命中女生词库而保留')
        : '颜值保留已关闭';
    }
    if ($.rfem) {
      $.rfem.setAttribute('aria-pressed', String(!!cfg.keepFemale));
      $.rfem.title = cfg.keepFemale
        ? (cfg.keepGender === 'm' ? '当前：男生保留（点击切换）' : '当前：女生保留（点击切换）')
        : '颜值保留已关闭（点击恢复女生保留）';
    }
  }
  $.rfem.onclick = () => {
    if (!cfg.keepFemale) { cfg.keepFemale = true; cfg.keepGender = 'f'; }
    else if (cfg.keepGender === 'f') cfg.keepGender = 'm';
    else cfg.keepFemale = false;
    saveCfg(); invalidate();
    state.activeVid = null; state.handling = false;
    syncKeepUi(); markDirty(); render();
  };
  $.rmus.onclick=()=>toggleOpt('keepMusic',true);
  $.rj.onclick=()=>toggleOpt('autoJ',false);
  // ═══ v18.4：全按钮音效 + 统计格解释（追加监听，不改原 onclick 逻辑）═══
  [['run','sw'],['rlive','click'],['rfem','click'],['rmus','click'],['rj','click']].forEach(p => {
    const b = document.getElementById(p[0]);
    if (b) b.addEventListener('click', () => SFX[p[1]]());
  });
  const _moreBtnSfx = document.getElementById('dy-more-btn');
  if (_moreBtnSfx) _moreBtnSfx.addEventListener('click', () => SFX.menu());
  const _gokSfx = document.getElementById('dy-guide-ok');
  if (_gokSfx) _gokSfx.addEventListener('click', () => SFX.click());
  [['dy-restart','click'],['dy-cls','warn']].forEach(p => {
    const m = document.getElementById(p[0]);
    if (m) m.addEventListener('click', () => SFX[p[1]]());
  });
  if (fab) fab.addEventListener('click', () => { if (!draggedThisPress || curPress !== pressId) SFX.tick(2); });
  // 背景透明度滑块
  const _opSl = document.getElementById('dy-opacity');
  if (_opSl) {
    try { const _sv = parseInt(localStorage.getItem('dyhlf_op') || '34'); if (_sv >= 0 && _sv <= 95) _opSl.value = _sv; } catch(e) {}
    const _applyOp = () => {
      const v = (+_opSl.value) / 100;
      panel.style.setProperty('--glass', `rgba(14,16,22,${v})`);
      try { localStorage.setItem('dyhlf_op', _opSl.value); } catch(e) {}
    };
    _opSl.addEventListener('input', _applyOp);
    _applyOp();
  }
  const _statTips = { nk: '脚本判定保留的视频数', ns: '自动跳过的低赞/购物视频数', nl: '跳过的直播场次', get nf() { return cfg.keepFemale ? (cfg.keepGender === 'm' ? '命中男生词库而保留的视频数' : '命中女生词库而保留的视频数') : '颜值保留已关闭'; } };
  ['nk','ns','nl','nf'].forEach(id => { const c = document.getElementById(id); if (c && c.parentElement) c.parentElement.title = _statTips[id]; });
  // ═══ v18.6：统计四格点击解压反馈（按下果冻+pop音，可连点；无任何功能含义）═══
  ['nk', 'ns', 'nl', 'nf'].forEach(id => {
    const c = document.getElementById(id);
    if (!c || !c.parentElement) return;
    const cell = c.parentElement;
    cell.addEventListener('pointerdown', () => {
      if (_prm || !fxOn()) return;
      cell.animate([
        { transform: 'scale(1,1)', easing: 'ease-out' },
        { transform: 'scale(.9,1.1)', offset: .3, easing: 'ease-out' },
        { transform: 'scale(1.04,.95)', offset: .6 },
        { transform: 'scale(1,1)' }
      ], { duration: 320 });
      SFX.click();
    });
    // 统计卡点击仅保留动画+音效反馈，不修改任何 state 计数
  });
  // ═══ v18.5：四策略芯片解压反馈（用户拍板）——每次按下果冻挤压+小粒子并发+音效，开关功能不变；
  //     按下动画是果冻回弹不是开关翻转；1 秒内连点同芯片≥3次触发连击彩蛋 ═══
  const _chipCombo = new Map();
  ['rlive', 'rfem', 'rmus', 'rj'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('pointerdown', () => {
      if (_prm || !fxOn()) return;
      b.animate([
        { transform: 'scale(1,1)', easing: 'ease-out' },
        { transform: 'scale(.92,1.08) translateY(1px)', offset: .25, easing: 'ease-out' },
        { transform: 'scale(1.05,.94)', offset: .5, easing: 'ease-out' },
        { transform: 'scale(.98,1.02)', offset: .75 },
        { transform: 'scale(1,1)' }
      ], { duration: 380 });
    });
    b.addEventListener('click', () => {
      const now = performance.now();
      const combo = (now - (_chipCombo.get(id) || 0) < 1000) ? ((_chipCombo.get(id + 'c') || 1) + 1) : 1;
      _chipCombo.set(id, now); _chipCombo.set(id + 'c', combo);
      if (combo >= 3) {
        _chipCombo.set(id + 'c', 0);
        try { SFX.coin(); } catch (e) {}
      }
    });
  });
  // v16.0 主题三同步（§4/§5.9）：
  //   ① load 路径旧值迁移 '255,23,68'→'255,59,92'、'21,101,255'→'78,155,255' + 脏值防御
  //     （'#'+c 历史缺陷产生的脏值映射默认主题）；
  //   ② 本文件内不再出现 '255,23,68'/'21,101,255' 默认串（基线 L1100/L1101 换新值）；
  //   ③ 主题点 data-c/data-hex 已换新值（见上方模板）。
  // v16.6 [3]：主题点保留 6 色，但主题色只派生 --ac 强调色（撤销 v16.5 ⑨ 的语义色全量着色），
  //   语义色回 CSS 写死（见 _applyTheme 内注释），保证跨主题辨识度。
  const _THEME_DEFAULT = '255,59,92';
  const _THEME_OK_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
  const _migrateTheme = v => v === '255,23,68' ? _THEME_DEFAULT : (v === '21,101,255' ? '78,155,255' : v);
  // v16.6 [3]：语义色不再由主题 HSL 派生（撤销 v16.5 ⑨）——红主题下保留/跳过/暂停几乎同色、
  // 蓝主题下 danger 变青，语义辨识度崩塌；恢复 CSS 写死六色（#dy 变量块），主题色只管 --ac 强调色
  const _applyTheme = (c, persist) => {
    if (!_THEME_OK_RE.test(c || '')) c = _THEME_DEFAULT;
    c = _migrateTheme(c);
    const hex = document.querySelector('#tm i[data-c="' + c + '"]')?.dataset.hex || '#FF3B5C';
    [panel, fab].forEach(el => {
      el.style.setProperty('--ac', hex);
      el.style.setProperty('--ac-rgb', c);
    });
    document.querySelectorAll('#tm i').forEach(el => el.classList.toggle('on', el.dataset.c === c));
    if (persist) { try { localStorage.setItem('dyhlf_theme', c); } catch(e){} }
  };
  let _savedTheme = null;
  try { _savedTheme = localStorage.getItem('dyhlf_theme'); } catch(e) {}
  _applyTheme(_savedTheme || _THEME_DEFAULT, false); // load 路径：旧值自动迁移 + 脏值防御
  document.querySelectorAll('#tm i').forEach(el => el.onclick = e => {
    _applyTheme(el.dataset.c, true);
    try { const r = el.getBoundingClientRect(); _themeRipple(r.left + r.width / 2, r.top + r.height / 2, el.dataset.c); } catch (err) {}
  }); // v18.5：换主题从点位荡开一圈色波纹
  // v18.2 模块⑤：主题即时预览 —— 悬停立即应用主题色 + 五声音阶（随色阶走），移出还原到已保存主题；
  //                原点击保存逻辑（上方 onclick → persist=true）保持不变
  const _THEME_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C D E G A C'
  let _committedTheme = _savedTheme || _THEME_DEFAULT; // _applyTheme 内做迁移+脏值防御，还原时同样归一
  const _tmBox = document.getElementById('tm');
  if (_tmBox) {
    _tmBox.querySelectorAll('i').forEach((el, i) => {
      el.addEventListener('pointerenter', () => { _applyTheme(el.dataset.c, false); SFX.note(_THEME_NOTES[i % 6]); });
      el.addEventListener('click', () => { _committedTheme = el.dataset.c; SFX.note(_THEME_NOTES[i % 6], 1); });
    });
    _tmBox.addEventListener('pointerleave', () => _applyTheme(_committedTheme, false));
  }

  (()=>{
    const rs=document.getElementById('dy-rs');let d=false;
    // v16.0：BASE_W/BASE_H 改为上方运行时量取的共享变量；MIN_Z 钳制保留
    const MIN_Z = 0.6;
    let anchorVis = null;
    rs.addEventListener('mousedown',e=>{
      d=true;_zoomDragging=true;e.preventDefault();e.stopPropagation();
      const z0 = parseFloat(panel.style.zoom)||1;
      anchorVis = { l: (parseFloat(panel.style.left)||0) * z0, t: (parseFloat(panel.style.top)||0) * z0 };
    });
    // v14.2：document/window 级监听走 onDoc/onWin 登记，stop() 可清理
    onDoc('mousemove',e=>{
      if(!d||!anchorVis)return;
      const targetZ = (e.clientX - anchorVis.l) / BASE_W; // 分母 = 运行时量取的自然宽
      const z = Math.max(MIN_Z, Math.min(maxZoom(), targetZ));
      panel.style.zoom = z;
      panel.style.left = (anchorVis.l / z) + 'px';
      panel.style.top = (anchorVis.t / z) + 'px';
    });
    onDoc('mouseup',()=>{if(d){d=false;_zoomDragging=false;anchorVis=null;const _z=parseFloat(panel.style.zoom);panel.dataset.userZoom=_z;try{localStorage.setItem('dyhlf_zoom',String(_z));}catch(e){}_measurePanel();}});
    // v14.1：resize 时不重置 zoom，只重新调整面板位置
    onWin('resize', () => {
      vw = innerWidth; vh = innerHeight;
      // v16.7 [3]：窗口变小（半屏贴靠）或浏览器放大后 FAB 可能整个落在视口外且重载依旧进不来，钳回可视区
      if (fab.style.left !== '') {
        const _fl = parseFloat(fab.style.left) || 0, _ft = parseFloat(fab.style.top) || 0;
        const _nl = Math.max(0, Math.min(vw - fab.offsetWidth, _fl));
        const _nt = Math.max(0, Math.min(vh - fab.offsetHeight, _ft));
        if (_nl !== _fl || _nt !== _ft) { fab.style.left = _nl + 'px'; fab.style.top = _nt + 'px'; saveFabPos(); }
      }
      if (panel.style.display !== 'none') placePanel();
    });
  })();
  // v17.2：载入即钳回视口——保存坐标来自更大窗口/副屏时，重载到小窗后 resize 不触发（仅尺寸变化才触发），
  // FAB/面板会整个卡在屏外进不来；界内坐标零改动，仅越界被拉回
  (() => {
    if (fab.dataset.customPos === '1') {
      const fw = fab.offsetWidth || 40, fh = fab.offsetHeight || 40;
      const fx = parseFloat(fab.style.left) || 0, fy = parseFloat(fab.style.top) || 0;
      const nx = Math.max(0, Math.min(innerWidth - fw, fx));
      const ny = Math.max(0, Math.min(innerHeight - fh, fy));
      if (nx !== fx || ny !== fy) { fab.style.left = nx + 'px'; fab.style.top = ny + 'px'; saveFabPos(); }
    }
    if (panel.style.display !== 'none') placePanel();
  })();
  onDoc('mousedown',e=>{
    if (e.target.closest && e.target.closest('#dy-fab')) return; // 16.0：点 FAB 自身不触发点外逻辑
    if (_menu && !_menu.hidden && !(e.target.closest && e.target.closest('#dy-more'))) {
      _menu.hidden = true;
      if (_moreBtn) _moreBtn.setAttribute('aria-expanded','false');
      _resetConfirm();
    }
  });
  const _dyClear = () => {
    try { window.__dyhlf?.stop(); } catch(e){}
    // v16.0 待修 #1/#3：补清 dyhlf_src（热重启源码残留）与 dyhlf_seen（首引导标记，否则清除后引导不复活）
    // v16.4：dyhlf_fab / dyhlf_open 已恢复使用（FAB 框架还原），仍不在此清除清单（用户已存值保留）
    try { ['dyhlf_cfg','dyhlf_pp','dyhlf_theme','dyhlf_zoom','dyhlf_time','dyhlf_src','dyhlf_seen'].forEach(k => localStorage.removeItem(k)); } catch(e){}
    try { document.getElementById('dy')?.remove(); } catch(e){}
    try { document.getElementById('dy-fab')?.remove(); } catch(e){}
  };
  // 热重启：直接重跑引导函数就行，闭包里有
  const _dyRestart = () => {
    try {
      if (typeof __dyhlfBoot === 'function') {
        __dyhlfBoot();
      }
    } catch (e) {
      console.warn('[FILTER] restart failed:', e);
    }
  };
  // v16.0：「⋯更多」菜单（#dy-more/#dy-more-btn/#dy-menu/#dy-restart）+ 清除 3 秒内联二次确认
  //（不用系统 confirm()，不打断刷视频心流；确认态=菜单项原地变语义红底白字，3s 超时自动还原）
  let _confirmT = null;
  const _clsMi = document.getElementById('dy-cls');
  function _resetConfirm(){
    clearTimeout(_confirmT);
    if (_clsMi) { _clsMi.classList.remove('confirm'); _clsMi.textContent = '清除程序'; }
  }
  function _closeMenu(){
    if (_menu) _menu.hidden = true;
    if (_moreBtn) _moreBtn.setAttribute('aria-expanded','false');
    _resetConfirm();
  }
  if (_moreBtn) _moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = _menu.hidden;
    _menu.hidden = !open;
    _moreBtn.setAttribute('aria-expanded', String(open));
    if (open) _resetConfirm();
  });
  if (_menu) _menu.addEventListener('click', e => e.stopPropagation());
    if (_restartMi) _restartMi.addEventListener('click', () => { _closeMenu(); _dyRestart(); });
    // v20.0：动效总开关（「更多」菜单内）——只关装饰性动效，判定/音效/功能全不受影响
    const _fxMi = document.getElementById('dy-fxmi');
    const _fxSync = () => { if (_fxMi) _fxMi.textContent = '动效：' + (cfg.fx !== false ? '开' : '关'); };
    _fxSync();
    if (_fxMi) _fxMi.addEventListener('click', () => { cfg.fx = cfg.fx === false; saveCfg(); _fxSync(); try { SFX.tick(4); } catch (e) {} });
  if (_clsMi) _clsMi.addEventListener('click', () => {
    if (!_clsMi.classList.contains('confirm')) {
      _clsMi.classList.add('confirm');
      _clsMi.textContent = '确认清除？';
      _confirmT = setTimeout(_resetConfirm, 3000);
    } else {
      _resetConfirm();
      _closeMenu();
      _dyClear();
    }
  });
  (()=>{
    const verEl = panel.querySelector('.ver');
    verEl.textContent = 'v' + VERSION; // v20.0：版本显示改读 VERSION，杜绝面板写死版本号与实际漂移
    verEl.style.cursor = 'pointer';
    verEl.onclick = _dyRestart;
    const tEl = panel.querySelector('.hd .t');
    if (tEl) { // v18.9：标题已换音量条，可能不存在
      tEl.style.cursor = 'pointer';
      let _px = 0, _py = 0, _down = false;
      tEl.addEventListener('mousedown', e => { _down = true; _px = e.clientX; _py = e.clientY; });
      tEl.addEventListener('mouseup', e => {
        if (!_down) return;
        _down = false;
        if (Math.hypot(e.clientX - _px, e.clientY - _py) > 6) return;
        _dyRestart();
      });
    }
  })();
  sync();render();
  const _restoreUI = () => {
    let changed = false;
    // FAB 被删了就重新挂
    if (!document.getElementById('dy-fab')) {
      fab.id = 'dy-fab';
      document.body.appendChild(fab);
      changed = true;
    }
    // panel 被删了就重新挂（即使 FAB 还在）
    if (!document.getElementById('dy')) {
      panel.id = 'dy';
      document.body.appendChild(panel);
      changed = true;
    }
    if (!changed) return;
    markDirty(); render();
    clearTimeout(_closeT);
    panel.classList.remove('closing');
    panel.style.display = _panelOpen ? 'block' : 'none';
  };
  const _uiObs = new MutationObserver(() => { _restoreUI(); });
  _uiObs.observe(document.body, { childList: true, subtree: false });
  window.__dyhlf={cfg,state,getState(){return{...state,threshold:cfg.threshold,enabled:cfg.enabled,vid:currentVid()};},
    stop(){
      cfg.enabled=false;
      _stopped = true;
      clearTimeout(_tickTimer);   // v14.1：停掉自调度的 tick
      clearTimeout(_saveT);
      clearTimeout(_saveTimeT);   // v15.0：时间账本防抖写盘
      clearTimeout(_bubT);        // v16.0：滑块气泡隐藏定时器
      clearTimeout(_confirmT);    // v16.0：清除确认还原定时器
      clearInterval(_pathT);      // v16.5 ③：100ms 路径监听
      _pinTimers.forEach(clearTimeout); _pinTimers.length = 0; // v16.6 [10]：FAB 吸附重试定时器补清
      if (_waveRaf) { cancelAnimationFrame(_waveRaf); _waveRaf = null; } // v19.6：海浪循环停
      // v17.1：位置落盘防抖收尾——停用/重启即刷最终位置（此刻 panel 尚未 remove，读到的是当前值）
      clearTimeout(_ppT);
      try { localStorage.setItem('dyhlf_pp', JSON.stringify({l:panel.style.left,t:panel.style.top})); } catch(e){}
      clearTimeout(_closeT); // v17.2：面板关闭淡出定时器
      _stopRumble(); // v18.2：滑块按住尽头微震动画+粒子雨定时器
      try { _fxHost.remove(); } catch (e) {} // v18.2：粒子宿主随 stop 移除，无残留
      invalidate();
      // v14.2：统一清理所有 document/window 级监听（缩放/点外关闭/resize 等）
      // v16.0：同清单含 ResizeObserver 断开与 countUp 代际 token 失效
      while (_disposers.length) { try { _disposers.pop()(); } catch(e){} }
      _uiObs.disconnect();
      panel.remove();fab.remove();style.remove();window.__dyhlf=null;
    }};
  console.log('[FILTER v' + VERSION + '] loaded');
})();
