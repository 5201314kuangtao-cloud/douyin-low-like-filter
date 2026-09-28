(function () {
  'use strict';
  if (window.__dyhlf?.stop) {
    try { window.__dyhlf.stop(); } catch (e) {}
  }
  // v14.3：精简 + 稳定性（v14.2 的 bugfix 全部保留）
  //   1) 按需求移除"广告跳过/跳过带货"按钮及全部相关代码：广告分支本就不可达，
  //      AD_RE/hasAdMarker/vidAdCache/adSkipped 一并删除；带货恢复 v14.1 的无条件跳过
  //   2) goNext 失败重试上限：同一 vid 连续跳转失败 3 次后不再重试，避免检测+跳转死循环空转
  //   3) feed 容器全文只序列化一次：isLiveFast 与"汽水音乐"判定共用 _rawText
  //   4) 删除死代码：defaultZoom()（从未调用）、.ft2/.cpy 与 .dark-text 死 CSS
  try { document.getElementById('dy')?.remove(); } catch (e) {}
  try { document.getElementById('dy-fab')?.remove(); } catch (e) {}
  try {
    document.querySelectorAll('style').forEach(el => {
      if (el.textContent && (el.textContent.includes('#dy-fab{') || el.textContent.includes('/*dyhlf'))) el.remove();
    });
  } catch (e) {}
  // v14.2：拉取自身源码，供 _dyRestart 热重启（此前 __dySrc 无人赋值，重启是死功能）
  try {
    if (window.__dySrc == null && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      fetch(chrome.runtime.getURL('content.js'))
        .then(r => { if (r.ok) return r.text(); })
        .then(src => { if (src && src.length > 1000) window.__dySrc = src; })
        .catch(() => {});
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

  const LIKE_EXACT_MS = 200;
  const LIKE_HEURISTIC_MS = 300;
  const TICK_FAST = 50;
  const TICK_IDLE = 200;
  const HIST_MAX = 200;
  const JDONE_MAX = 500;
  // v14.1：vid 级缓存 TTL，过期后允许重扫，兜底 DOM 稳定性判定失手的情况
  const VID_CACHE_TTL = 2000;

  const state = {
    activeVid: null,
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

  const invalidate = () => {
    actionToken++;
    activeItemCache = null;
    activeItemCacheAt = 0;
    vidCacheVal = null;
    vidCacheAt = 0;
    vidLiveCache.clear();
    vidShopCache.clear();
  };
  const norm = s => String(s || '').replace(/[\s\u00a0\u200b\u200c\u200d]/g, '');
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
  function isAuthorPage() {
    const p = location.pathname || '/';
    const now = performance.now();
    // v14.2：负结果（非作者页）拉长缓存到 2.5s，避免频繁全量 body.textContent
    if (authorPageCache.path === p && now - authorPageCache.at < (authorPageCache.val ? 400 : 2500)) return authorPageCache.val;
    let val = /^\/(user|profile|author|@)/i.test(p);
    if (!val) {
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
    if (!el.offsetParent) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 3 && r.height >= 3;
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
    const candidates = [];
    const re = /^\d+(?:\.\d+)?(?:亿|万|[wW])?$/;
    // TreeWalker 只遍历叶子文本节点，跳过所有容器
    const hw = document.createTreeWalker(it, NodeFilter.SHOW_TEXT, null);
    let hn;
    while ((hn = hw.nextNode())) {
      const el = hn.parentElement;
      if (!el || el.children.length || !visible(el)) continue;
      const raw = (hn.nodeValue||'').trim();
      const t = raw.replace(/[,，\s]/g,'');
      if (!t || t.length > 9 || !re.test(t)) continue;
      const v = parseCount(t);
      if (Number.isNaN(v)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < vw*0.55 || r.left > vw*0.98) continue;
      if (r.top < vh*0.18 || r.top > vh*0.86) continue;
      if (r.width > 110) continue;
      candidates.push({ value: v, raw, score: r.left/vw*700 + (1-Math.abs(((r.top+r.height/2)/vh)-0.55))*300 });
    }
    candidates.sort((a,b) => b.score - a.score);
    if (candidates.length && candidates[0].score >= 520) {
      return { value: candidates[0].value, raw: candidates[0].raw, mode: 'heuristic' };
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

  const J_INIT = Object.freeze({key:'j',code:'KeyJ',keyCode:74,which:74,bubbles:true,cancelable:true,composed:true,repeat:false});
  const DOWN_INIT = Object.freeze({key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true,cancelable:true});
  function pressJ() {
    if (userPauseMode || userBackMode) return;
    const data = J_INIT;
    try {
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
      window.focus();
    } catch(e){}
    const targets = [window,document,document.activeElement,activeItem(),document.body,document.documentElement].filter(Boolean);
    withSynthetic(() => {
      for (const target of targets) {
        for (const type of ['keydown','keypress','keyup']) {
          try { target.dispatchEvent(new KeyboardEvent(type,data)); } catch(e){}
        }
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
    withSynthetic(() => {
      [document,document.activeElement,document.body,document.documentElement].filter(Boolean).forEach(target => {
        try {
          target.dispatchEvent(new KeyboardEvent('keydown',data));
          target.dispatchEvent(new KeyboardEvent('keyup',data));
        } catch(e){}
      });
    });
  }
  async function goNext(vid, token) {
    if (!cfg.enabled || token!==actionToken || userBackMode || userPauseMode || state.authorPage) return false;
    const speed = state.consecutiveSkips >= 2 ? cfg.turboSpeed : cfg.skipSpeed;
    let tries = 0;
    while (token===actionToken && !userBackMode && !userPauseMode && !state.authorPage && !commentsOpen()) {
      clickNextArrow(); pressArrowDown();
      activeItemCache = null; activeItemCacheAt = 0;
      vidCacheVal = null; vidCacheAt = 0;
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
      if (hidx>=0 && hidx<hist.length-1) {
        hist.length = hidx+1; // v14.2：截断后统一 rebuildHistPos 重建索引
        rebuildHistPos();
      }
      hist.push(vid); histAdd(vid); hidx = hist.length-1;
      if (hist.length > HIST_MAX) {
        hist.splice(0, hist.length - HIST_MAX);
        hidx = hist.length - 1;
        rebuildHistPos();
      }

      const it = activeItem();
      // v14.1：缓存 nickname/desc，避免下面多个函数重复查 DOM
      const _nk = getNickname(it);
      const _ds = getDesc(it);
      const _fullText = norm(_nk + ' ' + _ds);
      // v14.3：feed 容器全文只序列化一次，isLiveFast 与音乐判定共用
      const _rawText = it ? (it.textContent || '') : '';
      let decision = 'unknown';
      let like = null;
      let hit = null;

      if (cfg.skipLive && isLiveFast(it, vid, _rawText)) {
        decision = 'live';
      } else if (hasGameShoppingMarker(it, vid)) {
        decision = 'game-shopping';
      } else if (_fullText.includes('男') && !MALE_EXEMPT_RE.test(_fullText)) {
        decision = 'male-skip';
      } else if (cfg.keepMusic && _rawText.includes('汽水音乐')) {
        decision = 'music-keep';
      } else if (cfg.keepFemale && (hit = matchFemale(it, _fullText))) {
        decision = 'female-keep';
      } else {
        like = await readLikeAccurate(vid, state.consecutiveSkips>=2);
        if (currentVid()!==vid || userBackMode || userPauseMode || state.authorPage || token!==actionToken) return;
        if (!like) decision = 'low';
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
  function tick() {
    if (document.hidden) {
      _tickTimer = setTimeout(tick, 500);
      return;
    }
    updatePageMode();
    render(); // v14.2：消费脏标记，暂停/回看/评论态即时刷新
    if (!cfg.enabled || state.authorPage || userBackMode || userPauseMode || state.handling) {
      _tickTimer = setTimeout(tick, TICK_IDLE);
      return;
    }
    if (commentsOpen()) { state.activeVid = null; markDirty(); _tickTimer = setTimeout(tick, TICK_IDLE); return; }
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
    markDirty();
  }
  function exitUserBack() {
    userBackMode = false; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; backArmed = false;
    markDirty();
  }
  function onKey(e) {
    if (syntheticDepth > 0) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    const key = String(e.key||'').toLowerCase();
    if (key==='w' || e.key==='ArrowUp' || e.key==='PageUp') { enterUserBack(); return; }
    if (key==='s' || e.key==='ArrowDown' || e.key==='PageDown') { exitUserBack(); return; }
    if (e.code==='Space' || e.key===' ') { userPauseMode = !userPauseMode; markDirty(); return; }
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

  // ============ UI v14.3 ============
  const style = document.createElement('style');
  style.textContent = `/*dyhlf-v14.3*/
#dy{--ac:#FF1744;--ac-b:rgba(255,23,68,.5);--ac-bg:rgba(255,23,68,.28);position:fixed;left:20px;top:90px;width:200px;z-index:2147483647;background:rgba(17,18,21,.06);backdrop-filter:blur(16px) saturate(1.6);-webkit-backdrop-filter:blur(16px) saturate(1.6);border:1px solid rgba(255,255,255,.15);border-radius:18px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#fff;overflow:hidden;user-select:none;box-shadow:0 20px 60px rgba(0,0,0,.55);text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;zoom:1}
#dy .hd{padding:14px 14px 10px;display:flex;justify-content:space-between;align-items:center}
#dy .rs{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;z-index:5;background:none;opacity:0}
#dy .hd .t{font-size:15px;font-weight:500;letter-spacing:.3px;line-height:1;color:#fff;white-space:nowrap;flex:none;overflow:hidden;text-overflow:ellipsis;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;display:flex;align-items:center;height:18px;cursor:default;position:relative;top:0}
#dy .hd .t small{font-size:11px;color:#c8c8cc;margin-left:4px}
#dy .bd{padding:0 12px 12px}
#dy .sw{position:relative;width:34px;height:18px;border-radius:9px;background:rgba(255,255,255,.15);cursor:pointer;transition:background .15s,border-color .15s;flex:none;border:1px solid rgba(0,0,0,0)}
#dy .sw.on{background:var(--ac);border-color:rgba(0,0,0,.55);box-shadow:none}
#dy .sw::after{content:'';position:absolute;top:1px;left:2px;width:14px;height:14px;border-radius:50%;background:#9a9a9f;transition:transform .15s,background .15s;box-shadow:none}
#dy .sw.on::after{transform:translateX(16px);background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.45)}
#dy .hact{display:flex;align-items:center;gap:8px;flex:none}
#dy .ver{font-size:11px;color:#8a8a90}
#dy .ft{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}#dy .ft .cls{justify-self:start}#dy .ft .tm{justify-self:center}#dy .ft .ver{justify-self:end}
#dy .cls{font-size:11px;color:#6a6a70;cursor:pointer;letter-spacing:.5px;transition:color .15s}
#dy .cls:hover{color:#FF4D5E}
#dy .tm{display:flex;align-items:center;gap:6px}
#dy .tm i{width:10px;height:10px;border-radius:50%;cursor:pointer;border:1px solid transparent;transition:transform .15s,border-color .15s,box-shadow .15s}
#dy .tm i:hover{transform:scale(1.2)}
#dy .tm i.on{border-color:#fff;transform:scale(1.15);box-shadow:none}
#dy .th{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:10px}
#dy .th button{height:26px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#c8c8cd;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#dy .th button:hover{color:#fff}
#dy .th button.on{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.35);color:var(--ac);font-weight:500}
#dy .rg{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px}
#dy .rg button{height:28px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#c8c8cd;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#dy .rg button:hover{color:#fff}
#dy .rg button.on{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.35);color:var(--ac);font-weight:500}
#dy .st{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;margin-bottom:8px}
#dy .st .m{font-size:18px;font-weight:700;line-height:1.2;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#dy .st .s{font-size:12px;color:#c0c0c4;margin-top:3px}
#dy .cg{color:#2CE8A0}.cr{color:#FF4D5E}.cb{color:#3EA6FF}.cp{color:#FF5CCB}.cy{color:#FFC53D}
#dy .nm{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}
#dy .nm div{text-align:center;padding:6px 2px;border-radius:10px;background:rgba(255,255,255,.06)}
#dy .nm .v{font-size:16px;font-weight:700;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#dy .nm .l{font-size:11px;color:#c0c0c4;margin-top:2px;font-weight:500}
#dy-fab{display:none;position:fixed;left:20px;top:90px;z-index:2147483647;width:36px;height:36px;border-radius:50%;background:#2d6a4f;border:0;color:#fff;font-size:13px;cursor:pointer}
`;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'dy';
  panel.innerHTML = `
<div class="hd" id="dd">
    <span class="t">别做算法里的困兽</span>
  <div class="hact">
    <div class="sw on" id="run" title="开始/停止"></div>
  </div>
</div>
<div class="bd">
  <div class="th" id="thg">
    <button data-v="10000">1万</button>
    <button data-v="20000">2万</button>
    <button data-v="50000">5万</button>
    <button data-v="100000">10万</button>
    <button data-v="200000">20万</button>
    <button data-v="300000">30万</button>
    <button data-v="400000">40万</button>
    <button data-v="500000">50万</button>
    <button data-v="1000000">100万</button>
  </div>
  <div class="rg">
    <button id="rfem">颜值保留</button>
    <button id="rj">自动清屏</button>
    <button id="rmus">音乐保留</button>
    <button id="rlive">保留直播</button>
  </div>
  <div class="st">
    <div class="m" id="sm">读取中</div>
    <div class="s" id="ss"></div>
  </div>
  <div class="nm">
    <div><div class="v cg" id="nk">0</div><div class="l">保留</div></div>
    <div><div class="v cr" id="ns">0</div><div class="l">跳过</div></div>
    <div><div class="v cb" id="nl">0</div><div class="l">直播</div></div>
    <div><div class="v cp" id="nf">0</div><div class="l">女生</div></div>
  </div>
  <div class="ft">
    <div class="cls" id="dy-cls">清除程序</div>
    <div class="tm" id="tm">
      <i data-c="255,23,68" data-hex="#FF1744" style="background:#FF1744"></i>
      <i data-c="21,101,255" data-hex="#1565FF" style="background:#1565FF"></i>
      <i data-c="44,232,160" data-hex="#2CE8A0" style="background:#2CE8A0"></i>
    </div>
    <div class="ver">v14.3</div>
  </div>
  <div class="rs" id="dy-rs"></div>
</div>`;
  document.body.appendChild(panel);
const fab = document.createElement('button');
  fab.id='dy-fab'; fab.textContent='';
  fab.style.background = '#0000 url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23ED4B2C%22%2F%3E%3Crect%20x%3D%2226%22%20y%3D%2241%22%20width%3D%2226%22%20height%3D%228%22%20rx%3D%222%22%20fill%3D%22%23fff%22%2F%3E%3C%2Fsvg%3E") center/100% 100% no-repeat';
  fab.style.borderRadius = '14px';
  fab.style.boxShadow = '0 4px 14px rgba(0,0,0,.4)';
  fab.style.display = 'block';
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
  function saveFabPos() {
    try {
      localStorage.setItem('dyhlf_fab', JSON.stringify({
        x: parseFloat(fab.style.left) || 0,
        y: parseFloat(fab.style.top) || 0
      }));
    } catch(e) {}
  }
  function savePanelOpen() {
    try { localStorage.setItem('dyhlf_open', panel.style.display !== 'none' ? '1' : '0'); } catch(e) {}
  }
  let _panelOpen = false;
  restorePanelLayout();
  panel.style.display = _panelOpen ? 'block' : 'none';

  const $ = {
    run: document.getElementById('run'),
    rlive: document.getElementById('rlive'),
    rfem: document.getElementById('rfem'),
    rmus: document.getElementById('rmus'),
    rj: document.getElementById('rj'),
    nk: document.getElementById('nk'),
    ns: document.getElementById('ns'),
    nl: document.getElementById('nl'),
    nf: document.getElementById('nf'),
    sm: document.getElementById('sm'),
    ss: document.getElementById('ss'),
    thg: document.getElementById('thg'),
  };

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
  const _pinTimers = []; // v14.2：登记吸附重试定时器，stop() 清理
  (()=>{
    // v14.1：如果用户自定义过 fab 位置，不自动吸到 logo
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
    // v14.2：document 级监听走 onDoc 登记，stop() 可清理
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
    }
    savePanelOpen();
  };

  function fmt(n){return n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':String(n);}
  function sync(){
    $.run.classList.toggle('on',cfg.enabled);
    $.rlive.classList.toggle('on',!cfg.skipLive);
    $.rfem.classList.toggle('on',cfg.keepFemale);
    $.rmus.classList.toggle('on',cfg.keepMusic);
    $.rj.classList.toggle('on',cfg.autoJ);
    $.thg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.v===cfg.threshold));
  }
  // v14.1：脏标记保留（避免每次 tick 都刷 UI），但所有 state 变更处都补了 markDirty()
  let _dirty = true;
  function markDirty(){ _dirty = true; }
  function render(){
    if(!_dirty) return;
    _dirty = false;
    sync();
    $.nk.textContent=state.kept;
    $.ns.textContent=state.skipped;
    $.nl.textContent=state.liveSkipped;
    $.nf.textContent=state.femaleKept;
    const r=state.lastResult||{};
    if(commentsOpen()){$.sm.className='m cy';$.sm.textContent='评论中';$.ss.textContent='自动刷已暂停';return;}
    if(state.authorPage){$.sm.className='m cp';$.sm.textContent='主页';$.ss.textContent='';return;}
    if(userPauseMode){$.sm.className='m cy';$.sm.textContent='暂停';$.ss.textContent='';return;}
    if(userBackMode){$.sm.className='m cp';$.sm.textContent='回看';$.ss.textContent='';return;}
    if(r.verdict==='userback'){$.sm.className='m cp';$.sm.textContent='回看';$.ss.textContent='';return;} // v14.2：补 userback 分支，不再落到"读取中"
    if(!cfg.enabled){$.sm.className='m cy';$.sm.textContent='已停止';$.ss.textContent='';return;}
    if(r.verdict==='live'){$.sm.className='m cb';$.sm.textContent='直播';$.ss.textContent='';}
    else if(r.verdict==='game-shopping'){$.sm.className='m cr';$.sm.textContent='购物';$.ss.textContent='';}
    else if(r.verdict==='male-skip'){$.sm.className='m cr';$.sm.textContent='男性';$.ss.textContent='';}
    else if(r.verdict==='music-keep'){$.sm.className='m cg';$.sm.textContent='音乐保留';$.ss.textContent='汽水音乐';}
    else if(r.verdict==='female-keep'){$.sm.className='m cg';$.sm.textContent='女生保留';$.ss.textContent=r.hit?'命中「'+r.hit+'」':'';}
    else if(r.verdict==='keep'){$.sm.className='m cg';$.sm.textContent=fmt(r.value)+'赞';$.ss.textContent='达标';}
    else if(r.verdict==='low'){$.sm.className='m cr';$.sm.textContent=fmt(r.value)+'赞';$.ss.textContent='低赞';}
    else{$.sm.className='m cy';$.sm.textContent='读取中';$.ss.textContent='';}
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
  $.thg.querySelectorAll('button').forEach(b=>{b.onclick=()=>{cfg.threshold=+b.dataset.v;saveCfg();markDirty();render();};});
  const _applyTheme = (c, persist) => {
    const hex = document.querySelector('#tm i[data-c="' + c + '"]')?.dataset.hex || '#' + c;
    panel.style.setProperty('--ac', hex);
    panel.style.setProperty('--ac-rgb', c);
    panel.style.setProperty('--ac-b', 'rgba(' + c + ',.5)');
    panel.style.setProperty('--ac-bg', 'rgba(' + c + ',.28)');
    document.querySelectorAll('#tm i').forEach(el => el.classList.toggle('on', el.dataset.c === c));
    if (persist) { try { localStorage.setItem('dyhlf_theme', c); } catch(e){} }
  };
  try {
    const savedTheme = localStorage.getItem('dyhlf_theme');
    _applyTheme(savedTheme || '255,23,68', false);
  } catch(e) { _applyTheme('255,23,68', false); }
  document.querySelectorAll('#tm i').forEach(el => el.onclick = () => _applyTheme(el.dataset.c, true));

  (()=>{
    const rs=document.getElementById('dy-rs');let d=false;
    const BASE_H = 406;
    const BASE_W = 200;
    const MIN_Z = 0.6;
    const maxZoom = () => Math.min((vh - 8) / BASE_H, (vw - 8) / BASE_W);
    let anchorVis = null;
    rs.addEventListener('mousedown',e=>{
      d=true;e.preventDefault();e.stopPropagation();
      const z0 = parseFloat(panel.style.zoom)||1;
      anchorVis = { l: (parseFloat(panel.style.left)||0) * z0, t: (parseFloat(panel.style.top)||0) * z0 };
    });
    // v14.2：document/window 级监听走 onDoc/onWin 登记，stop() 可清理
    onDoc('mousemove',e=>{
      if(!d||!anchorVis)return;
      const targetZ = (e.clientX - anchorVis.l) / BASE_W;
      const z = Math.max(MIN_Z, Math.min(maxZoom(), targetZ));
      panel.style.zoom = z;
      panel.style.left = (anchorVis.l / z) + 'px';
      panel.style.top = (anchorVis.t / z) + 'px';
    });
    onDoc('mouseup',()=>{if(d){d=false;anchorVis=null;const _z=parseFloat(panel.style.zoom);panel.dataset.userZoom=_z;try{localStorage.setItem('dyhlf_zoom',String(_z));}catch(e){}}});
    // v14.1：resize 时不重置 zoom，只重新调整面板位置
    onWin('resize', () => {
      vw = innerWidth; vh = innerHeight;
      if (panel.style.display !== 'none') placePanel();
    });
  })();
  onDoc('mousedown',e=>{
    if (panel.style.display==='none') return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#dy-fab')) return;
    panel.style.display='none'; _panelOpen=false; savePanelOpen();
  });
  const _dyClear = () => {
    try { window.__dyhlf?.stop(); } catch(e){}
    // v14.2：补删 dyhlf_open / dyhlf_fab
    try { ['dyhlf_cfg','dyhlf_pp','dyhlf_theme','dyhlf_zoom','dyhlf_open','dyhlf_fab'].forEach(k => localStorage.removeItem(k)); } catch(e){}
    try { document.getElementById('dy')?.remove(); } catch(e){}
    try { document.getElementById('dy-fab')?.remove(); } catch(e){}
  };
  document.getElementById('dy-cls').onclick = _dyClear;
  // v14.2：__dySrc 已在脚本启动时由 fetch(chrome.runtime.getURL('content.js')) 填充，重启真正生效
  const _dyRestart = () => {
    try {
      if (typeof window.__dySrc === 'string' && window.__dySrc.length > 1000) {
        (0, eval)(window.__dySrc);
      }
    } catch (e) {}
  };
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
    if (document.getElementById('dy-fab')) return;
    fab.style.display = 'block';
    fab.id = 'dy-fab';
    document.body.appendChild(fab);
    if (!document.getElementById('dy')) {
      panel.id = 'dy';
      document.body.appendChild(panel);
    }
    markDirty(); render();
    panel.style.display = _panelOpen ? 'block' : 'none';
    fab.style.display = 'block';
  };
  const _uiObs = new MutationObserver(() => { _restoreUI(); });
  _uiObs.observe(document.body, { childList: true, subtree: false });
  window.__dyhlf={cfg,state,getState(){return{...state,threshold:cfg.threshold,enabled:cfg.enabled,vid:currentVid()};},
    stop(){
      cfg.enabled=false;
      _stopped = true;
      clearTimeout(_tickTimer);   // v14.1：停掉自调度的 tick
      clearTimeout(_saveT);
      // v14.2：清理 fab 吸附重试定时器
      while (_pinTimers.length) clearTimeout(_pinTimers.pop());
      invalidate();
      // v14.2：统一清理所有 document/window 级监听（拖拽/缩放/点外关闭/resize 等）
      while (_disposers.length) { try { _disposers.pop()(); } catch(e){} }
      _uiObs.disconnect();
      panel.remove();fab.remove();style.remove();window.__dyhlf=null;
    }};
  console.log('[FILTER v14.3] loaded');
})();
