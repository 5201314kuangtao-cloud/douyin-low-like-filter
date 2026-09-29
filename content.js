(function __dyhlfBoot() {
  'use strict';
  const VERSION = '16.2';
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
        if (_savedSrc && _savedSrc.length > 1000 && _savedSrc.includes('FILTER v' + VERSION)) window.__dySrc = _savedSrc;
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
    keepMusic: true,
    autoJ: false,
    threshold: 20000,
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
  const THRESHOLD_PRESETS = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
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
  function commentsOpen() {
    const now = performance.now();
    if (now - commentsCache.at < 300) return commentsCache.val;
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
  function updatePageMode() {
    state.authorPage = isAuthorPage();
    if (state.authorPage) {
      invalidate();
      state.activeVid = null;
      state.handling = false;
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
  function currentVid() {
    const now = performance.now();
    if (vidCacheVal !== null && now - vidCacheAt < 25) return vidCacheVal;
    let vid;
    const it = activeItem();
    if (it) {
      const v = it.querySelector('video');
      vid = 'f|' + getNickname(it) + '|' + getDesc(it).slice(0,100) + '|' + (v?.currentSrc || v?.src || v?.poster || '');
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
        // 可见子元素太少说明右下角控件还没渲染出来，此时的"直播"判定不可信
        if (scanned < 5) stable = false;
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
        const v = parseCount(el.textContent);
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
      const r = el.getBoundingClientRect();
      if (r.left < vw*0.55 || r.left > vw*0.98) continue;
      if (r.top < vh*0.18 || r.top > vh*0.86) continue;
      if (r.width > 110) continue;
      const score = r.left/vw*700 + (1-Math.abs(((r.top+r.height/2)/vh)-0.55))*300;
      if (!best || score > best.score) best = { value: c.v, raw: c.raw, score };
    }
    if (best && best.score >= 520) {
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
  // v14.1：补回 v11.2 里被删掉的词（大小姐/欧美唇/唇膜/唇冻/唇霜/唇乳/唇粉）
  const FEMALE_HOT = new Set(['美女','女生','小姐姐','女神','甜妹','辣妹','穿搭','美妆','舞蹈','自拍','颜值','JK','校园','学姐','学妹','女高','女大','女团','白丝','清纯','变装','氛围感','口红','美甲','护肤','翻唱','对口型','宿舍','教室']);
  const FEMALE_RE = /女孩|妹子|萌妹|软妹|熟女|御姐|萝莉|少女|妹妹|高中|初中|大学|校花|初恋|纯欲|仙女|女友|老婆|大小姐|闺蜜|姐妹|妆容|化妆|素颜|随拍|对镜拍|OOTD|韩系|韩妹|日系|lo裙|洛丽塔|汉服|模特|主播|好看的|漂亮|跳舞|手势舞|长发|卷发|温柔|唱歌|弹唱|理想型|宅女|恋爱|女初|女爱豆|女偶像|女歌手|辣妈|宝妈|旗袍|婚纱|女生日常|甜妹风|御姐风|纯欲风|女生头像|闺蜜照|姐妹照|女生穿搭|辣妹风|温柔风|甜美风|仙女风|初恋风|校园风|学院风|JK制服|连衣裙|短裙|吊带|露肩|大长腿|马甲线|小蛮腰|锁骨|天鹅颈|直角肩|漫画腿|蚂蚁腰|A4腰|酒窝|梨涡|虎牙|卧蚕|双眼皮|高鼻梁|嘟嘟唇|微笑唇|素颜妆|伪素颜|纯欲妆|甜辣妆|清冷妆|氛围感妆|白开水妆|裸妆|淡妆|仙子毛|漫画睫毛|野生眉|平眉|挑眉|柳叶眉|鼻影|修容|高光|腮红|欧美唇|唇釉|唇泥|镜面唇釉|哑光唇釉|丝绒唇釉|水光唇|玻璃唇|果冻唇|咬唇妆|渐变唇|花瓣唇|樱桃小嘴|丰唇|唇珠|唇膜|唇部护理|唇油|唇蜜|唇彩|唇冻|唇霜|唇乳|唇粉/;
  function matchFemale(it = activeItem(), preText) {
    if (!it) return null;
    const t = preText || norm(getNickname(it) + ' ' + getDesc(it));
    for (const w of FEMALE_HOT) {
      if (t.includes(w)) return w;
    }
    const m = t.match(FEMALE_RE);
    return m ? m[0] : null;
  }

  // v14.2：女性向购物语境豁免，减少 male-skip 误杀（如"送男朋友的礼物"）
  const MALE_EXEMPT_RE = /男朋友|男友|送男|给男|适合男|男生礼物|男生的礼物|男士礼物|男同款/;
  // v15.2：男频词表替代单字 '男' 匹配，避免"队友""前任"等无关上下文误杀；豁免规则保留
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
    if (ae && ae !== document.body && ae !== document.documentElement && document.contains(ae)) return ae;
    const probe = document.querySelector('[data-e2e]');
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
      if (!_ready) { state.unknown++; state.lastResult = { verdict:'unknown' }; markDirty(); return; } // 就绪失败：按 unknown 保留，绝不跳过
      if (hidx>=0 && hidx<hist.length-1) {
        hist.length = hidx+1; // v14.2：截断后统一 rebuildHistPos 重建索引
        rebuildHistPos();
      }
      // v16.2 修复 #2/#3：回看/继续后、阈值调整后，当前视频需重判（低赞立即跳过、不漏判）。
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
      } else if (MALE_RE.test(_fullText) && !MALE_EXEMPT_RE.test(_fullText)) {
        decision = 'male-skip';
      } else if (cfg.keepMusic && _rawText.includes('汽水音乐')) {
        decision = 'music-keep';
      } else if (cfg.keepFemale && (hit = matchFemale(it, _fullText))) {
        decision = 'female-keep';
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
      if (decision==='live') state.liveSkipped++;
      if (decision==='female-keep') state.femaleKept++;
      if (decision==='unknown') state.unknown++;
      state.hitWord = hit;
      state.lastResult = { verdict:decision, hit, value:like?.value, raw:like?.raw };
      markDirty();

      clearScreenOnce(vid);

      if (!shouldSkip) {
        state.kept++; state.consecutiveSkips = 0;
        markDirty();
        return;
      }
      if (cfg.autoSkip) {
        state.skipped++; state.consecutiveSkips++;
        addSaved(AVG_SKIP_SEC); // v15.0：时间账本
        markDirty();
        const ok = await goNext(vid, token);
        if (ok) {
          _failVid = null; _failStreak = 0;
        } else if (_failVid === vid) {
          // v14.3：同一 vid 连续跳转失败 3 次后不再重试，避免"检测+跳转"死循环空转
          if (++_failStreak < 3) state.activeVid = null;
        } else {
          _failVid = vid; _failStreak = 1;
          state.activeVid = null;
        }
      } else {
        state.kept++;
        markDirty();
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
  function tick() {
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
      // v16.2 修复 #3：关评论后强制重判当前视频（activeVid 置空，下一轮 tick 重新进入 handleNewVideo），
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

  function enterUserBack() {
    userBackMode = true; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; backArmed = true;
    state.consecutiveSkips = 0; // v15.2：回看后不延续连跳 turbo 速度
    markDirty();
  }
  function exitUserBack() {
    userBackMode = false; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; backArmed = false;
    state.consecutiveSkips = 0; // v15.2：手动前进视为重新开始
    markDirty();
  }
  function onKey(e) {
    if (syntheticDepth > 0) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    const key = String(e.key||'').toLowerCase();
    if (key==='w' || e.key==='ArrowUp' || e.key==='PageUp') { enterUserBack(); return; }
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
    if (now - _lastWheel < 500) return;
    if (e.deltaY < -10) { _lastWheel = now; enterUserBack(); }
    else if (e.deltaY > 10) { _lastWheel = now; exitUserBack(); }
  }
  function onClick(e) {
    if (syntheticDepth > 0) return;
    if (!e.target?.closest?.('[data-e2e="video-switch-prev-arrow"]')) return;
    enterUserBack();
  }
  onDoc('keydown', onKey, true);
  onDoc('wheel', onWheel, {capture:true, passive:true});
  onDoc('click', onClick, true);
  // v16.1 ①：删除 pause/play 事件监听，改由 tick 轮询真实 video.paused（见 pollPauseState），根除事件竞态

  // ============ UI v16.0 ============
  const style = document.createElement('style');
  style.textContent = `/*dyhlf-v16.2 · 视觉草案 v2（达芬奇-视觉体验专家）
  基于：诺曼《交互规格 v16》§3.1 DOM + §5 组件规范 · 集成契约 v1（含修订：BASE 运行时量取、尺寸自由）
  落码方式：整块并入 content.js style 模板；含自清理标记（头部 dyhlf 注释 + #dy-fab 规则）
  依赖：--ac / --ac-rgb 由引擎 _applyTheme 注入（需同步扩展到 #dy-fab，1 行，见规格 §7）
  品牌色 tint 一律 rgba(var(--ac-rgb),x)，自动跟主题，零引擎改动 */
#dy{
  --w-p:224px;
  --ac:#FF3B5C;--ac-rgb:255,59,92;
  --t1:rgba(255,255,255,.96);--t2:rgba(255,255,255,.70);--t3:rgba(255,255,255,.48);
  --c-ok:#34E39C;--c-bad:#FF5C7A;--c-info:#5AB0FF;--c-pink:#FF6FA8;--c-warn:#FFC53D;--c-back:#B389FF;
  --glass:rgba(13,15,20,.26);--glass-2:rgba(255,255,255,.07);--menu:rgba(18,20,25,.58);
  --line:rgba(255,255,255,.14);--line-2:rgba(255,255,255,.10);
  --r-card:12px;--r-ctrl:10px;
  --f: -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
/* ============ 面板骨架 ============ */
#dy{position:fixed;left:20px;top:90px;width:var(--w-p);z-index:2147483647;background:var(--glass);backdrop-filter:blur(16px) saturate(2.2);-webkit-backdrop-filter:blur(16px) saturate(2.2);border-radius:20px;font:13px/1.5 var(--f);color:var(--t1);overflow:hidden;user-select:none;box-shadow:0 16px 48px rgba(0,0,0,.40),0 2px 10px rgba(0,0,0,.22);zoom:1;animation:dyIn .18s cubic-bezier(.2,.9,.3,1);text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
#dy::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 0 1px rgba(255,255,255,.05)}
#dy .bd{padding:0}
/* ============ A 状态层：标题 + 运行开关 ============ */
#dy .hd{padding:13px 14px 11px;display:flex;align-items:center;justify-content:space-between;gap:8px}
#dy .hact{display:flex;align-items:center}
#dy .hd .t{font-size:15px;font-weight:600;letter-spacing:.4px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
/* 运行呼吸灯：纯 CSS（.t::before + :has(.sw.on)），零 DOM/JS 改动 */
#dy .hd .t::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--t3);margin-right:7px;vertical-align:2px;transition:background .2s}
#dy .hd:has(.sw.on) .t::before{background:var(--ac);animation:dyBreath 2.2s ease-out infinite}
#dy .sw{position:relative;width:38px;height:20px;border-radius:10px;background:rgba(255,255,255,.14);cursor:pointer;flex:none;transition:background .18s}
#dy .sw::before{content:'';position:absolute;inset:-10px -7px}/* 命中区扩展 */
#dy .sw::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transition:transform .22s cubic-bezier(.34,1.56,.64,1)}
#dy .sw.on{background:var(--ac)}
#dy .sw.on::after{transform:translateX(18px)}
/* ============ A 状态层：状态卡 ============ */
#dy .st{position:relative;margin:0 14px 11px;padding:9px 12px 9px 15px;background:var(--glass-2);border:1px solid var(--line-2);border-radius:var(--r-card);overflow:hidden}
#dy .st::before{content:'';position:absolute;left:0;top:16%;bottom:16%;width:3px;border-radius:0 3px 3px 0;background:var(--t3)}
#dy .st:has(.m.cg)::before{background:var(--c-ok)}
#dy .st:has(.m.cr)::before{background:var(--c-bad)}
#dy .st:has(.m.cb)::before{background:var(--c-info)}
#dy .st:has(.m.cp)::before{background:var(--c-pink)}
#dy .st:has(.m.cy)::before{background:var(--c-warn)}
#dy .st .m{font-size:16px;font-weight:700;letter-spacing:.2px;line-height:1.25;font-variant-numeric:tabular-nums;color:var(--t1);animation:dyStIn .12s ease-out}
#dy .st .s{font-size:11px;color:var(--t2);margin-top:2px;animation:dyStIn .12s ease-out;min-height:0}
#dy .m.cg{color:var(--c-ok)}
#dy .m.cr{color:var(--c-bad)}
#dy .m.cb{color:var(--c-info)}
#dy .m.cp{color:var(--c-pink)}
#dy .m.cy{color:var(--c-warn)}
#dy .m.ca{color:var(--ac)}
/* ============ A 状态层：首次引导条 ============ */
#dy .guide{margin:0 14px 11px;padding:8px 10px;background:rgba(255,197,61,.08);border:1px solid rgba(255,197,61,.26);border-radius:var(--r-card);display:flex;align-items:center;gap:8px;overflow:hidden}
#dy .guide .gt{flex:1;font-size:11px;line-height:1.5;color:var(--t2)}
#dy .guide .gok{flex:none;font-family:inherit;font-size:11px;font-weight:600;color:var(--c-warn);background:rgba(255,197,61,.14);border:none;border-radius:8px;padding:3px 9px;cursor:pointer;transition:background .15s}
#dy .guide .gok:hover{background:rgba(255,197,61,.24)}
#dy .guide .gok:active{transform:scale(.95)}
/* ============ B 控制层：阈值滑块（28px 命中区 + 档位气泡）============ */
#dy .slw{padding:0 14px;margin-bottom:12px}
#dy .slh{display:flex;justify-content:space-between;align-items:center;margin-bottom:1px}
#dy .slh .lb{font-size:12px;font-weight:500;color:var(--t2)}
#dy .slh .vl{font-size:11px;font-weight:600;color:var(--ac);background:rgba(var(--ac-rgb),.16);padding:1px 8px 2px;border-radius:7px;letter-spacing:.2px}
#dy .slwrap{position:relative;height:30px;display:flex;align-items:center;cursor:pointer}
#dy .slwrap::before{content:'';position:absolute;inset:-5px 0;pointer-events:none}/* 命中区扩至 40px 高 */
#dy .sl{-webkit-appearance:none;appearance:none;display:block;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.16);outline:none;margin:0;cursor:pointer}
#dy .sl::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:none;box-shadow:0 1px 6px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.25);cursor:pointer;transition:transform .12s,box-shadow .12s}
#dy .sl:hover::-webkit-slider-thumb{transform:scale(1.12)}
#dy .sl:active::-webkit-slider-thumb{transform:scale(1.25);box-shadow:0 0 0 8px rgba(var(--ac-rgb),.18)}
#dy .sl::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#fff;border:none;box-shadow:0 1px 6px rgba(0,0,0,.5);cursor:pointer}
#dy .bub{position:absolute;bottom:calc(100% + 5px);transform:translateX(-50%);background:var(--menu);border:1px solid var(--line);border-radius:8px;padding:3px 9px;font-size:11px;font-weight:600;color:var(--t1);white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s;box-shadow:0 6px 18px rgba(0,0,0,.5)}
#dy .bub::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:var(--menu)}
#dy .bub.show{opacity:1}
#dy .sle{display:flex;justify-content:space-between;font-size:11px;color:var(--t3)}
/* ============ B 控制层：策略开关 2×2（图标化）============ */
#dy .rg{display:grid;grid-template-columns:1fr 1fr;gap:8px 6px;padding:0 14px;margin-bottom:12px}
#dy .rg button{position:relative;display:flex;align-items:center;justify-content:center;gap:5px;height:32px;border-radius:var(--r-ctrl);border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--t2);font-family:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:color .16s,border-color .16s,background .16s,transform .1s;-webkit-font-smoothing:antialiased}
#dy .rg button::after{content:'';position:absolute;inset:-4px 0;border-radius:12px}/* 命中区扩至 40px 高 */
#dy .rg button svg{width:12px;height:12px;flex:none;opacity:.75;transition:opacity .16s}
#dy .rg button:hover{color:var(--t1);border-color:rgba(255,255,255,.22)}
#dy .rg button:active{transform:scale(.95)}
#dy .rg button.on{color:var(--ac);font-weight:600;border-color:rgba(var(--ac-rgb),.5);background:rgba(var(--ac-rgb),.14)}
#dy .rg button.on svg{opacity:1}
/* ============ C 数据层：统计四格 + 时间账本 ============ */
#dy .nm{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:0 14px;margin-bottom:10px}
#dy .nm>div{background:var(--glass-2);border-radius:var(--r-ctrl);padding:7px 2px 6px;text-align:center}
#dy .nm .v{font-size:16px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
#dy .nm .l{font-size:11px;color:var(--t3);margin-top:3px;font-weight:500;letter-spacing:.5px}
#dy .cg{color:var(--c-ok)}
#dy .cr{color:var(--c-bad)}
#dy .cb{color:var(--c-info)}
#dy .cp{color:var(--c-pink)}
#dy .cy{color:var(--c-warn)}
#dy .time{display:flex;flex-direction:column;gap:3px;padding:0 14px 12px;font-size:11px;letter-spacing:.2px}
#dy #tNow{color:var(--t2)}
#dy #tSave{color:var(--t3)}
#dy .time .hi{color:var(--ac);font-weight:600;text-shadow:0 0 12px rgba(var(--ac-rgb),.45)}
/* ============ D 底部：更多菜单 + 主题点 + 版本 ============ */
#dy .ft{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 10px 10px;border-top:1px solid var(--line-2)}
#dy .more{position:relative;justify-self:start}
#dy .mbtn{position:relative;width:28px;height:28px;border-radius:9px;border:none;background:none;color:var(--t2);font-family:inherit;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s}
#dy .mbtn::after{content:'';position:absolute;inset:-6px;border-radius:12px}/* 命中区 40px */
#dy .mbtn:hover{color:var(--t1);background:rgba(255,255,255,.08)}
#dy .mbtn:active{transform:scale(.95)}
#dy .menu{position:absolute;bottom:calc(100% + 8px);left:-4px;min-width:132px;background:var(--menu);backdrop-filter:blur(14px) saturate(2.0);-webkit-backdrop-filter:blur(14px) saturate(2.0);border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 12px 40px rgba(0,0,0,.55);animation:dyMenuIn .15s ease-out}
#dy .menu .mi{font-size:12px;padding:8px 10px;border-radius:8px;color:var(--t1);cursor:pointer;white-space:nowrap;transition:background .12s}
#dy .menu .mi:hover{background:rgba(255,255,255,.08)}
#dy .menu .mi.danger{color:var(--c-bad)}
#dy .menu .mi.danger:hover{background:rgba(255,92,122,.12)}
#dy .menu .mi.danger.confirm{background:var(--c-bad);color:#fff;font-weight:600}
#dy .menu .sep{height:1px;margin:4px 8px;background:var(--line-2)}
#dy .tm{display:flex;align-items:center;gap:7px;justify-self:center}
#dy .tm i{position:relative;width:10px;height:10px;border-radius:50%;cursor:pointer;transition:transform .15s,box-shadow .15s}
#dy .tm i::after{content:'';position:absolute;inset:-9px;border-radius:50%}/* 命中区 28px */
#dy .tm i:hover{transform:scale(1.25)}
#dy .tm i.on{box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 0 4px rgba(0,0,0,.45)}
#dy .ver{font-size:11px;color:var(--t3);justify-self:end;cursor:default}
/* ============ 缩放手柄（可见化：0.35 → hover 0.7）============ */
#dy .rs{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:5;background:none;border:0;opacity:.35;transition:opacity .2s}
#dy .rs::after{content:'';position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid var(--t2);border-bottom:2px solid var(--t2);border-radius:0 0 3px 0}
#dy .rs::before{content:'';position:absolute;inset:-7px}/* 命中区扩展 */
#dy:hover .rs{opacity:.7}
#dy .rs:hover{opacity:1}
  /* ============ FAB：squircle 玻璃 + 漏斗图标 + 三态角标 ============ */
  #dy-fab{position:fixed;left:20px;top:36px;width:40px;height:40px;border-radius:13px;z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--glass);backdrop-filter:blur(16px) saturate(1.6);-webkit-backdrop-filter:blur(16px) saturate(1.6);border:1px solid rgba(255,255,255,.15);box-shadow:0 8px 24px rgba(0,0,0,.5);transition:transform .18s cubic-bezier(.34,1.56,.64,1),border-color .18s;touch-action:none;padding:0}
  #dy-fab::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
  #dy-fab:hover{transform:scale(1.07);border-color:rgba(var(--ac-rgb),.55)}
  #dy-fab:active{transform:scale(.94)}
  #dy-fab svg{width:18px;height:18px;color:var(--ac);filter:drop-shadow(0 2px 5px rgba(var(--ac-rgb),.35))}
  #dy-fab .badge{position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 2px #0b0c11;transition:opacity .2s}
  #dy-fab .badge.warn{background:var(--c-warn)}
  #dy-fab .badge.back{background:var(--c-back)}
  #dy-fab .badge.stop{background:#8A8F99}
  /* ============ 焦点可见性（键盘用户）============ */
  #dy :focus-visible,#dy-fab:focus-visible{outline:2px solid rgba(255,255,255,.55);outline-offset:2px}
  #dy .sl:focus-visible{outline-offset:6px}
/* ============ 动效 ============ */
@keyframes dyIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes dyBreath{0%{box-shadow:0 0 0 0 rgba(var(--ac-rgb),.4)}75%{box-shadow:0 0 0 5px rgba(var(--ac-rgb),0)}100%{box-shadow:0 0 0 6px rgba(var(--ac-rgb),0)}}
@keyframes dyStIn{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:none}}
@keyframes dyMenuIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  #dy{background:rgba(13,15,20,.82)}
  #dy .menu{background:rgba(18,20,25,.92)}
}
`;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'dy';
  panel.innerHTML = `
<div class="hd" id="dd">
    <span class="t" title="快捷键：W/上滚 回看 · S/下滚 继续&#10;点击标题或版本号可重启脚本">别做算法里的困兽</span>
  <div class="hact">
    <div class="sw on" id="run" role="switch" aria-checked="true" title="开始/停止"></div>
  </div>
</div>
<div class="bd">
  <div class="st">
    <div class="m" id="sm" aria-live="polite">读取中</div>
    <div class="s" id="ss"></div>
  </div>
  <div class="guide" id="dy-guide" style="display:none">
    <span class="gt">低赞视频将自动跳过 · 拖滑块调门槛 · W/S 回看/继续</span>
    <button class="gok" id="dy-guide-ok">知道了</button>
  </div>
  <div class="slw">
    <div class="slh"><span class="lb">赞数阈值</span><span class="vl" id="slv">≥2万</span></div>
    <div class="slwrap">
      <input type="range" class="sl" id="sl" min="0" max="9" step="1" aria-label="赞数阈值">
      <div class="bub" id="sl-bub" hidden>≥2万</div>
    </div>
    <div class="sle"><span>1千</span><span>100万</span></div>
  </div>
  <div class="rg">
    <button id="rfem" aria-pressed="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21l-1.5-1.35C5.4 15.1 2 12.2 2 8.35 2 5.4 4.4 3 7.35 3c1.7 0 3.35.8 4.65 2.15C13.3 3.8 14.95 3 16.65 3 19.6 3 22 5.4 22 8.35c0 3.85-3.4 6.75-8.5 11.3L12 21z"/></svg>颜值保留</button>
    <button id="rj" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3"/></svg>自动清屏</button>
    <button id="rmus" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.5L20 3.5V16"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="16" r="2.6"/></svg>音乐保留</button>
    <button id="rlive" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="2.7"/><path d="M6.3 6.3a8.1 8.1 0 0 0 0 11.4M17.7 6.3a8.1 8.1 0 0 1 0 11.4"/></svg>保留直播</button>
  </div>
  <div class="nm">
    <div><div class="v cg" id="nk">0</div><div class="l">保留</div></div>
    <div><div class="v cr" id="ns">0</div><div class="l">跳过</div></div>
    <div><div class="v cb" id="nl">0</div><div class="l">直播</div></div>
    <div><div class="v cp" id="nf">0</div><div class="l">女生</div></div>
  </div>
  <div class="time"><span id="tNow"></span><span id="tSave"></span></div>
  <div class="ft">
    <div class="more" id="dy-more">
      <button class="mbtn" id="dy-more-btn" title="更多" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu" id="dy-menu" hidden>
        <div class="mi" id="dy-restart">重启脚本</div>
        <div class="mi danger" id="dy-cls" title="将删除全部配置与时间账本，不可恢复">清除程序</div>
      </div>
    </div>
    <div class="tm" id="tm">
      <i data-c="255,59,92" data-hex="#FF3B5C" style="background:#FF3B5C"></i>
      <i data-c="78,155,255" data-hex="#4E9BFF" style="background:#4E9BFF"></i>
      <i data-c="44,232,160" data-hex="#2CE8A0" style="background:#2CE8A0"></i>
    </div>
    <div class="ver">v16.2</div>
  </div>
</div>
<div class="rs" id="dy-rs" title="拖动缩放"></div>`;
  document.body.appendChild(panel);
  const fab = document.createElement('button');
  fab.id = 'dy-fab';
  // 16.0：FAB 图标内联 SVG（漏斗，跟主题色）+ 三态角标 span（初始隐藏）
  fab.title = '点击展开筛选面板，可拖动';
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5h17l-6.8 7.7v6.1l-3.4 2v-8.1L3.5 5z"/></svg><span class="badge" id="dy-fab-badge" hidden></span>';
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
    try { localStorage.setItem('dyhlf_open', panel.style.display !== 'none' ? '1' : '0'); } catch(e) {}
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
  const _fabBadge = document.getElementById('dy-fab-badge');

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
    const w = _slwrap.clientWidth;
    const x = (+$.sl.value / (THRESHOLD_PRESETS.length - 1)) * (w - 16) + 8; // 16 = thumb 直径
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
    saveCfg(); invalidate(); markDirty(); render();
  }
  $.sl.value = presetIndex(cfg.threshold);
  $.slv.textContent = '≥' + fmtThreshold(cfg.threshold);
  paintSlider();
  $.sl.addEventListener('input', () => { applyThreshold(+$.sl.value); paintSlider(); showBub(); });

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
    try{localStorage.setItem('dyhlf_pp',JSON.stringify({l:panel.style.left,t:panel.style.top}))}catch(e){}
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
      panel.style.display = 'none';
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
  fab.onclick=()=>{
    if(draggedThisPress && curPress===pressId){fab.dataset.dragged='';return;}
    fab.dataset.dragged='';
    const open=panel.style.display!=='none';
    if(open){
      panel.style.display='none'; _panelOpen=false;
      pinToLogo();
    }else{
      panel.style.display='block';
      placePanel();
      _panelOpen=true;
      setTimeout(_measurePanel, 50);
    }
    savePanelOpen();
  };
  // v16.2：FAB 框架已还原（16.0），上面为悬浮球创建/吸附/拖拽/点击全部逻辑
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
    // v16.2：悬浮球三态角标由 render() 内 _fabBadge 同步驱动（状态卡仍完整呈现 运行/暂停/回看/评论中）
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
    if(commentsOpen()){setSt('m cy','评论中','自动刷已暂停');return;}
    if(state.authorPage){setSt('m cp','主页','');return;}
    if(userPauseMode){setSt('m cy','暂停','暂停中 · 按空格播放或按 S 继续');return;} // v16.0：退出方式提示（§4.6）
    if(userBackMode){setSt('m cp','回看','回看中 · 按 S 或下滚继续');return;} // v16.0：退出方式提示（§4.6）
    if(r.verdict==='userback'){setSt('m cp','回看','回看中 · 按 S 或下滚继续');return;} // v14.2：补 userback 分支，不再落到"读取中"
    if(!cfg.enabled){setSt('m cy','已停止','');return;}
    // v16.0：连跳 turbo 标注（§4.6/§6，引擎拼装项——库珀已裁定准予随版落码）
    const _turboSs = state.consecutiveSkips >= 2 ? '连跳加速中' : null;
    if(r.verdict==='live'){setSt('m cb','直播',_turboSs||'');}
    else if(r.verdict==='game-shopping'){setSt('m cr','购物',_turboSs||'');}
    else if(r.verdict==='male-skip'){setSt('m cr','男性',_turboSs||'');}
    else if(r.verdict==='music-keep'){setSt('m cg','音乐保留',_turboSs||'汽水音乐');}
    else if(r.verdict==='female-keep'){setSt('m ca','女生保留',_turboSs||(r.hit?'命中「'+r.hit+'」':''));}
    else if(r.verdict==='keep'){setSt('m cg',fmt(r.value)+'赞',_turboSs||'达标');}
    else if(r.verdict==='low'){setSt('m cr',fmt(r.value)+'赞',_turboSs||'低赞');}
    else{setSt('m cy','读取中','');}
    if (_fabBadge) {
      let _bk = null;
      if (!cfg.enabled) _bk = 'stop';
      else if (userBackMode) _bk = 'back';
      else if (userPauseMode || commentsOpen()) _bk = 'warn';
      if (_bk) { _fabBadge.hidden = false; _fabBadge.className = 'badge ' + _bk; }
      else { _fabBadge.hidden = true; _fabBadge.className = 'badge'; }
    }
  }
  function toggleOpt(key, needRecheck){
    cfg[key]=!cfg[key];saveCfg();invalidate();
    if(needRecheck){state.activeVid=null;state.handling=false;}
    markDirty();render();
  }
  $.run.onclick=()=>toggleOpt('enabled',false);
  $.rlive.onclick=()=>toggleOpt('skipLive',true);
  $.rfem.onclick=()=>toggleOpt('keepFemale',true);
  $.rmus.onclick=()=>toggleOpt('keepMusic',true);
  $.rj.onclick=()=>toggleOpt('autoJ',false);
  // v16.0 主题三同步（§4/§5.9）：
  //   ① load 路径旧值迁移 '255,23,68'→'255,59,92'、'21,101,255'→'78,155,255' + 脏值防御
  //     （'#'+c 历史缺陷产生的脏值映射默认主题）；
  //   ② 本文件内不再出现 '255,23,68'/'21,101,255' 默认串（基线 L1100/L1101 换新值）；
  //   ③ 主题点 data-c/data-hex 已换新值（见上方模板）。
  const _THEME_DEFAULT = '255,59,92';
  const _THEME_OK_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
  const _migrateTheme = v => v === '255,23,68' ? _THEME_DEFAULT : (v === '21,101,255' ? '78,155,255' : v);
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
  document.querySelectorAll('#tm i').forEach(el => el.onclick = () => _applyTheme(el.dataset.c, true));

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
      if (panel.style.display !== 'none') placePanel();
    });
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
    // v16.2：dyhlf_fab / dyhlf_open 已恢复使用（FAB 框架还原），仍不在此清除清单（用户已存值保留）
    try { ['dyhlf_cfg','dyhlf_pp','dyhlf_theme','dyhlf_zoom','dyhlf_time','dyhlf_src','dyhlf_seen'].forEach(k => localStorage.removeItem(k)); } catch(e){}
    try { document.getElementById('dy')?.remove(); } catch(e){}
    try { document.getElementById('dy-fab')?.remove(); } catch(e){}
  };
  // v14.2：__dySrc 已在脚本启动时由 fetch(chrome.runtime.getURL('content.js')) 填充，重启真正生效
  // v16.0 待修 #2：纯控制台/油猴注入时 dyhlf_src 不存在（只有扩展 fetch 路径写入），
  // v15.2 点标题重启实为空操作——兜底软重启：重入本引导函数（IIFE 具名，闭包内可达），
  // 不依赖源码；扩展/已有缓存源码时仍优先 eval 最新源码，保留开发者热更新路径。
  const _dyRestart = () => {
    try {
      // v16.1 ⑥：优先软重入（重入引导函数），eval 旧源码仅作兜底；避免执行 localStorage 残旧 v15.2 源码
      if (typeof __dyhlfBoot === 'function') {
        __dyhlfBoot();
      } else if (typeof window.__dySrc === 'string' && window.__dySrc.length > 1000) {
        (0, eval)(window.__dySrc);
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
    verEl.style.cursor = 'pointer';
    verEl.onclick = _dyRestart;
    const tEl = panel.querySelector('.hd .t');
    tEl.style.cursor = 'pointer';
    let _px = 0, _py = 0, _down = false;
    tEl.addEventListener('mousedown', e => { _down = true; _px = e.clientX; _py = e.clientY; });
    tEl.addEventListener('mouseup', e => {
      if (!_down) return;
      _down = false;
      if (Math.hypot(e.clientX - _px, e.clientY - _py) > 6) return;
      _dyRestart();
    });
  })();
  sync();render();
  const _restoreUI = () => {
    if (document.getElementById('dy-fab')) return; // 16.0：悬浮球已被抖音 DOM 更新误删时，重新挂载，保证任何状态下稳定存在
    fab.id = 'dy-fab';
    document.body.appendChild(fab);
    if (!document.getElementById('dy')) {
      panel.id = 'dy';
      document.body.appendChild(panel);
    }
    markDirty(); render();
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
      invalidate();
      // v14.2：统一清理所有 document/window 级监听（缩放/点外关闭/resize 等）
      // v16.0：同清单含 ResizeObserver 断开与 countUp 代际 token 失效
      while (_disposers.length) { try { _disposers.pop()(); } catch(e){} }
      _uiObs.disconnect();
      panel.remove();fab.remove();style.remove();window.__dyhlf=null;
    }};
  console.log('[FILTER v' + VERSION + '] loaded');
})();
