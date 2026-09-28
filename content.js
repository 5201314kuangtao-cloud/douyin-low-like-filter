(function () {
  'use strict';
  if (window.__dyhlf?.stop) {
    try { window.__dyhlf.stop(); } catch (e) {}
  }
  // v11.2：重启/重复注入时先清理旧 DOM（保留 localStorage 配置）
  try { document.getElementById('dy')?.remove(); } catch (e) {}
  try { document.getElementById('dy-fab')?.remove(); } catch (e) {}
  try {
    document.querySelectorAll('style').forEach(el => {
      if (el.textContent && el.textContent.includes('#dy-fab{')) el.remove();
    });
  } catch (e) {}
  const cfg = {
    enabled: true,
    autoSkip: true,
    skipLive: true,
    skipAd: false,
    keepFemale: true,
    keepMusic: true,
    autoJ: false,
    threshold: 20000,
    skipSpeed: 80,     // 普通模式每条间隔
    turboSpeed: 15     // 连续跳>=2条后进入极速
  };
  try {
    const saved = JSON.parse(localStorage.getItem('dyhlf_cfg') || '{}');
    Object.assign(cfg, saved);
  } catch (e) {}
  function saveCfg() {
    try { localStorage.setItem('dyhlf_cfg', JSON.stringify(cfg)); } catch (e) {}
  }

  const LIKE_EXACT_MS = 200;
  const LIKE_HEURISTIC_MS = 300;
  const TICK_MS = 50;
  const HIST_MAX = 200;
  const JDONE_MAX = 500;

  const state = {
    activeVid: null,
    handling: false,
    kept: 0,
    skipped: 0,
    liveSkipped: 0,
    unknown: 0,
    femaleKept: 0,
    adSkipped: 0,
    userBack: 0,
    authorPage: false,
    lastResult: null,
    consecutiveSkips: 0,
    hitWord: null
  };
  const hist = [];
  const jDone = new Set();
  let hidx = -1;
  let actionToken = 0;
  let userBackMode = false;
  let userPauseMode = false;
  let syntheticDepth = 0;
  let strongBack = false;
  let weakBack = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withSynthetic = fn => {
    syntheticDepth++;
    try { return fn(); } finally { syntheticDepth--; }
  };

  let activeItemCache = null;
  let activeItemCacheAt = 0;
  // v10.13：currentVid 短缓存，避免 tick/goNext 热路径重复拼字符串+查 DOM
  let vidCacheVal = null;
  let vidCacheAt = 0;
  const invalidate = () => {
    actionToken++;
    activeItemCache = null;
    activeItemCacheAt = 0;
    vidCacheVal = null;
    vidCacheAt = 0;
  };
  const norm = s => String(s || '').replace(/[\s\u00a0\u200b\u200c\u200d]/g, '');
  // v10.14：评论区打开时暂停自动刷，避免用户看评论时被强制切视频
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

  // v10.13：作者页检测缓存。
  // 原版每次 tick(50ms) 都读 document.body.innerText，触发整页强制重排，是最大性能瓶颈。
  // 现在：pathname 正则命中直接返回；innerText 兜底检查带 400ms TTL 缓存。
  const authorPageCache = { path: '', at: 0, val: false };
  function isAuthorPage() {
    const p = location.pathname || '/';
    const now = performance.now();
    if (authorPageCache.path === p && now - authorPageCache.at < 400) return authorPageCache.val;
    let val = /^\/(user|profile|author|@)/i.test(p);
    if (!val) {
      const t = document.body.innerText || '';
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
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0;
  }
  function activeItem(force = false) {
    const now = performance.now();
    if (!force && activeItemCache && now - activeItemCacheAt < 35 && document.contains(activeItemCache)) {
      return activeItemCache;
    }
    let best = null, area = 0;
    const vw = innerWidth, vh = innerHeight;
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

  // =========================================================
  // 直播判断：当前视频右下角检测不到"倍速/清屏"即视为直播。
  // 修复：找不到 it 时返回 false（不是 true），避免加载期疯狂误跳。
  // =========================================================
  function isLiveFast(it = activeItem()) {
    if (!it) return false;
    // v10.12 修复：不能扫整页 innerText，否则侧边栏/推荐列表里的"进入直播间"会把当前视频误判成直播。
    // 只检查当前视频卡片内的文字；删掉"点击或按"这个过于宽泛的关键词。
    const text = (it.textContent || '').replace(/\s+/g,'');
    if (text.includes('进入直播间') || text.includes('点击进入直播')) return true;
    const base = it.getBoundingClientRect();
    if (!base.width || !base.height) return false;
    let has = false;
    for (const el of it.querySelectorAll('span,div,p,a,button,input,textarea')) {
      if (!visible(el)) continue;
      const t = norm(el.textContent || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (!t) continue;
      const r = el.getBoundingClientRect();
      const relX = (r.left + r.width/2 - base.left)/base.width;
      const relY = (r.top + r.height/2 - base.top)/base.height;
      if (relX < 0.62 || relY < 0.62 || relX > 1.02 || relY > 1.02) continue;
      if (t.includes('倍速') || t.includes('清屏')) { has = true; break; }
    }
    return !has;
  }

  function parseCount(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/[,，\s]/g,'').replace(/赞|喜欢|热度/g,'');
    let m = s.match(/(\d+(?:\.\d+)?)\s*(亿|万|[wW])/);
    if (m) return Math.round(parseFloat(m[1]) * (m[2]==='亿'?1e8:1e4));
    m = s.match(/(\d{2,})/);
    return m ? parseInt(m[1],10) : NaN;
  }

  // 修复：只在当前视频卡片 it 内查赞数，避免读到侧边栏/评论区；score 用 r.left 越靠右越优先。
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
    it.querySelectorAll('span,div,p,strong,em,b').forEach(el => {
      if (el.children.length || !visible(el)) return;
      const raw = (el.textContent||'').trim();
      const t = raw.replace(/[,，\s]/g,'');
      if (!t || t.length > 9 || !re.test(t)) return;
      const v = parseCount(t);
      if (Number.isNaN(v)) return;
      const r = el.getBoundingClientRect();
      if (r.left < innerWidth*0.55 || r.left > innerWidth*0.98) return;
      if (r.top < innerHeight*0.18 || r.top > innerHeight*0.86) return;
      if (r.width > 110) return;
      candidates.push({ value: v, raw, score: r.left/innerWidth*700 + (1-Math.abs(((r.top+r.height/2)/innerHeight)-0.55))*300 });
    });
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

  // v10.12：广告/带货检测。昵称或描述里命中任何电商词直接跳，优先级高于女生保留。
  const AD_RE = /广告|旗舰店|火山引擎|种草|带货|橱窗|小黄车|购物车|下单|购买|点击链接|链接在|商品|同款|专卖店|清仓|工厂直销|源头工厂|货源|批发|加盟|代理|优惠券|折扣|秒杀|专场直播|购物|查看详情|爆款|爆卖|销量|已售|限时特惠/;
  // v10.13：整页"广告"标签扫描缓存（按卡片元素+800ms TTL），避免每条视频都全页遍历叶子节点。
  const adScanCache = { it: null, at: 0, val: false };
  function hasAdMarker(it = activeItem()) {
    if (!it) return false;
    const name = norm(getNickname(it));
    const desc = norm(getDesc(it));
    if (AD_RE.test(name) || AD_RE.test(desc)) return true;
    const now = performance.now();
    if (adScanCache.it === it && now - adScanCache.at < 800) return adScanCache.val;
    // 抖音把"广告"小标签放在 feed-item DOM 外面，整页找叶子节点文本正好是"广告"的可见元素。
    // 排除自己的面板 #dy。
    let found = false;
    for (const el of document.querySelectorAll('div,span')) {
      if (el.children.length > 0) continue;
      if (!visible(el)) continue;
      if (el.closest('#dy')) continue;
      if ((el.textContent || '').trim() === '广告') { found = true; break; }
    }
    if (!found) {
      // 扫卡片内"查看详情""爆款""爆卖"等购物按钮文字。
      for (const el of it.querySelectorAll('span,div,p,a,button')) {
        if (!visible(el)) continue;
        const t = (el.textContent || '').trim();
        if (/查看详情|爆款|爆卖|已售|销量|限时/.test(t) && t.length < 15) { found = true; break; }
      }
    }
    adScanCache.it = it;
    adScanCache.at = now;
    adScanCache.val = found;
    return found;
  }
  // v10.12：购物标签实际是"购物|纯棉休闲衬衫"这种组合文本，用 includes 匹配而不是 ===。
  // 覆盖：购物、商品、橱窗、小黄车、旗舰店、专卖店、视频同款、游戏推广、广告。
  const SHOP_RE = /购物|商品|橱窗|小黄车|旗舰店|专卖店|视频同款|游戏推广|下单|点击购买|去购买/;
  function hasGameShoppingMarker(it = activeItem()) {
    if (!it) return false;
    const base = it.getBoundingClientRect();
    if (!base.width || !base.height) return false;
    for (const el of it.querySelectorAll('span,div,p,a,button')) {
      if (!visible(el)) continue;
      const t = norm(el.textContent);
      if (!t || t.length > 30) continue;
      if (!SHOP_RE.test(t)) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left+r.width/2, cy = r.top+r.height/2;
      if (cx>=base.left && cx<=base.right && cy>=base.top+base.height*0.5 && cy<=base.bottom) return true;
    }
    return false;
  }
  // 修复：返回命中的词，赋给 state.hitWord，UI 才能显示。
  const FEMALE_RE = /美女|女生|女孩|小姐姐|女神|妹子|萌妹|甜妹|辣妹|软妹|熟女|御姐|萝莉|少女|妹妹|学姐|学妹|校园|高中|初中|大学|校花|初恋|清纯|纯欲|仙女|女友|老婆|大小姐|闺蜜|姐妹|颜值|妆容|化妆|口红|素颜|自拍|随拍|对镜拍|OOTD|韩系|韩妹|日系|JK|lo裙|洛丽塔|汉服|模特|主播|好看的|颜值高|氛围感|漂亮|跳舞|舞蹈|变装|手势舞|宿舍|教室|长发|卷发|温柔|翻唱|唱歌|弹唱|对口型|理想型|宅女|恋爱|女高|女大|女初|女团|女爱豆|女偶像|女歌手|穿搭|美甲|美妆|护肤|辣妈|宝妈|旗袍|婚纱|女生日常|甜妹风|御姐风|纯欲风|氛围感美女|女生头像|闺蜜照|姐妹照|女生穿搭|辣妹风|温柔风|甜美风|仙女风|初恋风|校园风|学院风|JK制服|连衣裙|短裙|吊带|露肩|大长腿|马甲线|小蛮腰|锁骨|天鹅颈|直角肩|漫画腿|蚂蚁腰|A4腰|酒窝|梨涡|虎牙|卧蚕|双眼皮|高鼻梁|嘟嘟唇|微笑唇|素颜妆|伪素颜|纯欲妆|甜辣妆|清冷妆|氛围感妆|白开水妆|裸妆|淡妆|仙子毛|漫画睫毛|野生眉|平眉|挑眉|柳叶眉|鼻影|修容|高光|腮红|口红试色|唇釉|唇泥|镜面唇釉|哑光唇釉|丝绒唇釉|水光唇|玻璃唇|果冻唇|咬唇妆|渐变唇|欧美唇|花瓣唇|樱桃小嘴|丰唇|唇珠|唇膜|唇部护理|唇油|唇蜜|唇彩|唇冻|唇霜|唇乳|唇粉/;
  function matchFemale(it = activeItem()) {
    if (!it) return null;
    const t = norm(getNickname(it) + ' ' + getDesc(it));
    const m = t.match(FEMALE_RE);
    return m ? m[0] : null;
  }

  function pressJ() {
    if (userPauseMode || userBackMode) return;
    const data = {key:'j',code:'KeyJ',keyCode:74,which:74,bubbles:true,cancelable:true,composed:true,repeat:false};
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
    // v10.13：防止 jDone 无限增长
    if (jDone.size > JDONE_MAX) jDone.delete(jDone.values().next().value);
  }
  function clickNextArrow() {
    const el = document.querySelector('[data-e2e="video-switch-next-arrow"]');
    if (!el) return false;
    try { withSynthetic(() => el.click()); return true; } catch(e){ return false; }
  }
  function pressArrowDown() {
    if (userPauseMode || userBackMode) return;
    const data = {key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true,cancelable:true};
    withSynthetic(() => {
      [document,document.activeElement,document.body,document.documentElement].filter(Boolean).forEach(target => {
        try {
          target.dispatchEvent(new KeyboardEvent('keydown',data));
          target.dispatchEvent(new KeyboardEvent('keyup',data));
        } catch(e){}
      });
    });
  }
  // 修复：真正使用 cfg.skipSpeed / cfg.turboSpeed，而不是硬编码。
  // v10.13：循环内不再调用 isAuthorPage()（会触发整页重排），改用缓存的 state.authorPage；
  // 每次尝试翻页后清空 vid 缓存，确保能立即检测到视频切换。
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

  // 修复：整段包 try/finally，任何异常都不会让 handling 卡死。
  async function handleNewVideo(vid) {
    if (!cfg.enabled || state.authorPage || userBackMode || userPauseMode || commentsOpen()) return;
    state.handling = true;
    const token = actionToken;
    try {
      const inTurbo = state.consecutiveSkips >= 2;
      const isBack = strongBack || (!inTurbo && (hist[hidx-1]===vid || (weakBack && hist.includes(vid))));
      const isEmptyVid = !vid || vid.length < 10;
      strongBack = false; weakBack = false;
      if (isBack && !isEmptyVid) {
        hidx = hist.includes(vid) ? hist.lastIndexOf(vid) : hidx;
        state.userBack++; state.kept++;
        state.lastResult = { verdict:'userback' };
        return;
      }
      if (hidx>=0 && hidx<hist.length-1) hist.length = hidx+1;
      hist.push(vid); hidx = hist.length-1;
      // v10.13：防止 hist 无限增长
      if (hist.length > HIST_MAX) { hist.splice(0, hist.length - HIST_MAX); hidx = hist.length - 1; }

      const it = activeItem();
      let decision = 'unknown';
      let like = null;
      let hit = null;

      if (cfg.skipLive && isLiveFast(it)) {
        decision = 'live';
      } else if (hasAdMarker(it) && cfg.skipAd) {
        decision = 'ad';
      } else if (hasGameShoppingMarker(it)) {
        decision = 'game-shopping';
      } else if (norm(getNickname(it) + ' ' + getDesc(it)).includes('男')) {
        decision = 'male-skip';
      } else if (cfg.keepMusic && (it.textContent||'').includes('汽水音乐')) {
        decision = 'music-keep';
      } else if (cfg.keepFemale && (hit = matchFemale(it))) {
        decision = 'female-keep';
      } else {
        like = await readLikeAccurate(vid, state.consecutiveSkips>=2);
        if (currentVid()!==vid || userBackMode || userPauseMode || state.authorPage || token!==actionToken) return;
        if (!like) decision = 'low';
        else if (like.value >= cfg.threshold) decision = 'keep';
        else decision = 'low';
      }

      const shouldSkip = decision==='live'||decision==='ad'||decision==='game-shopping'||decision==='low'||decision==='male-skip';
      if (decision==='live') state.liveSkipped++;
      if (decision==='ad') state.adSkipped++;
      if (decision==='female-keep') state.femaleKept++;
      if (decision==='unknown') state.unknown++;
      state.hitWord = hit;
      state.lastResult = { verdict:decision, hit, value:like?.value, raw:like?.raw };

      clearScreenOnce(vid);

      if (!shouldSkip) {
        state.kept++; state.consecutiveSkips = 0;
        return;
      }
      if (cfg.autoSkip) {
        state.skipped++; state.consecutiveSkips++;
        const ok = await goNext(vid, token);
        if (!ok) state.activeVid = null;
      } else {
        state.kept++;
      }
    } catch (err) {
      console.warn('[FILTER] handle error:', err);
    } finally {
      state.handling = false;
      render();
    }
  }

  function tick() {
    updatePageMode();
    if (!cfg.enabled || state.authorPage || userBackMode || userPauseMode || state.handling) return;
    if (commentsOpen()) { state.activeVid = null; return; }
    const vid = currentVid();
    if (!vid || vid === state.activeVid) return;
    state.activeVid = vid;
    handleNewVideo(vid);
  }
  const tickTimer = setInterval(tick, TICK_MS);

  // v10.13：用户手动导航的公共处理，消除 keydown/wheel/click 三处重复代码。
  function enterUserBack() {
    userBackMode = true; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; strongBack = true; weakBack = true;
  }
  function exitUserBack() {
    userBackMode = false; userPauseMode = false; invalidate();
    state.activeVid = null; state.handling = false; strongBack = false; weakBack = false;
  }
  function onKey(e) {
    if (syntheticDepth > 0) return;
    const key = String(e.key||'').toLowerCase();
    if (key==='w' || e.key==='ArrowUp' || e.key==='PageUp') { enterUserBack(); return; }
    if (key==='s' || e.key==='ArrowDown' || e.key==='PageDown') { exitUserBack(); return; }
    if (e.code==='Space' || e.key===' ') { userPauseMode = !userPauseMode; return; }
  }
  function onWheel(e) {
    if (syntheticDepth > 0) return;
    if (e.deltaY < -10) enterUserBack();
    else if (e.deltaY > 10) exitUserBack();
  }
  function onClick(e) {
    if (syntheticDepth > 0) return;
    if (!e.target?.closest?.('[data-e2e="video-switch-prev-arrow"]')) return;
    enterUserBack();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('wheel', onWheel, {capture:true, passive:true});
  document.addEventListener('click', onClick, true);

  // ============ UI v10 ============
  const style = document.createElement('style');
  style.textContent = `
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
#dy .ft2{display:flex;justify-content:flex-end;margin-top:4px}
#dy .cls{font-size:11px;color:#6a6a70;cursor:pointer;letter-spacing:.5px;transition:color .15s}
#dy .cls:hover{color:#FF4D5E}
#dy .cpy{font-size:11px;color:#6a6a70;cursor:pointer;letter-spacing:.5px;transition:color .15s;margin-left:10px}
#dy .cpy:hover{color:#2CE8A0}
#dy .cpy.ok{color:#2CE8A0}
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
    <div class="ver">v11.2</div>
  </div>
  <div class="rs" id="dy-rs"></div>
</div>`;
  document.body.appendChild(panel);
  // v10.16：恢复上次关闭前的面板位置（v10.44：起始隐藏，由图标点击控制）
  panel.style.display = 'none';
  const fab = document.createElement('button');
  fab.id='dy-fab'; fab.textContent='';
  // v10.28：悬浮窗使用 Trark 风格图标（内嵌 SVG 矢量，任意尺寸高清）
  // v10.61：恢复固定抖音红图标，不跟随主题色
  fab.style.background = '#0000 url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23ED4B2C%22%2F%3E%3Crect%20x%3D%2226%22%20y%3D%2241%22%20width%3D%2226%22%20height%3D%228%22%20rx%3D%222%22%20fill%3D%22%23fff%22%2F%3E%3C%2Fsvg%3E") center/100% 100% no-repeat';
  fab.style.borderRadius = '14px';
  fab.style.boxShadow = '0 4px 14px rgba(0,0,0,.4)';
  fab.style.display = 'block';
  document.body.appendChild(fab);
  // v10.48：图标尺寸 44px（覆盖 30x34 音符留足余量），可随意拖动
  // v10.36：每次脚本启动，默认定位到左上角抖音 logo 的小图标处（只定位，不改大小）
  // v10.48：pinToLogo() 抽为具名函数，供"拖动吸附"与"再次校准"复用
  const findLogo = () => [...document.querySelectorAll('a')].find(a => /^(https?:)?\/\/www\.douyin\.com\//i.test(a.getAttribute('href') || ''));
  function pinToLogo(){
    const logo = findLogo();
    if (!logo) return false;
    const r = logo.getBoundingClientRect();
    if (!(r.width > 0)) return false;
    // 通用公式：按 CSS 背景图的实际渲染矩形定位音符图标，自适应任意分辨率
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
    // v11.2-fix：实测当前横版 logo SVG 为 72x68（非旧版 72x28），
    // 黑色音符图标在元素内的可见位置约为 left:17px, top:11px（元素 rect 为 0,-5 / 72x56）。
    let noteX0, noteY0;
    if (bw > 44) { // 横版 72x68
      noteX0 = bgL + bw * 0.236;
      noteY0 = bgT + bh * 0.286;
    } else {       // 竖版 30x34（或更小）
      noteX0 = bgL - 2;
      noteY0 = bgT + bh * 0.004;
    }
    fab.style.left = Math.max(0, noteX0) + 'px';
    fab.style.top = Math.max(0, noteY0) + 'px';
    return true;
  }
  (()=>{
    const tryPin = (tries) => {
      if (pinToLogo()) return;
      if (tries > 0) setTimeout(() => tryPin(tries - 1), 300);
    };
    tryPin(10);
  })();
  // v10.43：拖动与点击的判定
  // 旧版靠"移动超过2px"来标记拖动，小幅晃动卡在阈值边界 → 松手后补发的 click 仍会打开面板。
  // 现改为记录按住期间光标相对起点的最大偏离 maxDev；只要真按住动过（>2px）即判定为拖动，
  // 该判定在 mousedown 时重置、mouseup 时确定，任何幅度都不会误判为点击。
  // v10.48：拖动与点击判定
  // 旧版用 sticky 的 dragHappened 标记拦截"拖动后补发的 click"，但该标记只在 click 触发时复位，
  // 于是移动图标后紧接着的那次真实点击也被当成拖动余波拦掉了 → 要点两次。
  // 现改为按"一次按下"计数：mousedown 记一次 pressId 并在本次按下开始时清零本press的 drag 标记，
  // 拖动期间置 draggedThisPress=true，同一次 press 内产生的 click 据此拦截；下一次真实点击是新 pressId，必然放行。
  let pressId = 0, curPress = 0, draggedThisPress = false;
  // v10.48：面板打开时跟随图标移动。优先摆到图标右侧、与其顶边对齐；
  // 空间不够时依次翻转到左侧 / 下方，保证面板始终可见且不超出视口
  function placePanel(){
    const fr=fab.getBoundingClientRect();
    // 视觉尺寸（已含 zoom 缩放）
    const pr=panel.getBoundingClientRect();
    const pw=pr.width||panel.offsetWidth, ph=pr.height||panel.offsetHeight, gap=10;
    const z = parseFloat(panel.style.zoom) || 1;
    // 面板放在悬浮窗右边（避免重叠），垂直方向与悬浮窗顶部对齐
    let pl = fr.right + gap;
    if (pl + pw > innerWidth - 4) pl = Math.max(4, fr.left - gap - pw);
    if (pl + pw > innerWidth - 4) pl = Math.max(4, innerWidth - 4 - pw);
    let pt = fr.top;
    if (pt + ph > innerHeight - 4) pt = Math.max(4, innerHeight - 4 - ph);
    // 视觉坐标 → CSS 坐标（面板用 zoom 缩放，left/top 是未缩放的 CSS 像素）
    panel.style.left=(pl/z)+'px'; panel.style.top=(pt/z)+'px';
    try{localStorage.setItem('dyhlf_pp',JSON.stringify({l:panel.style.left,t:panel.style.top}))}catch(e){}
  }
  // v10.48：松手时若图标落在 logo 音符附近（阈值 60px），自动校准到精确覆盖位置
  // v10.54：判定区扩大到 160px，吸附时同时关闭面板（与点击图标的"关菜单+归位"一致）
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
    document.addEventListener('mousemove',e=>{if(!d)return;
      maxDev=Math.max(maxDev,Math.hypot(e.clientX-sx,e.clientY-sy));
      if(maxDev>2)draggedThisPress=true;
      const nx=Math.max(0,Math.min(innerWidth-fab.offsetWidth,e.clientX-fx));
      const ny=Math.max(0,Math.min(innerHeight-fab.offsetHeight,e.clientY-fy));
      fab.style.left=nx+'px';fab.style.top=ny+'px';
      if(panel.style.display!=='none')placePanel();});
    document.addEventListener('mouseup',()=>{if(d&&maxDev>2){fab.dataset.dragged='1';draggedThisPress=true;trySnap();}d=false;});
  })();
  // v10.41：触屏拖动支持（长按拖动在触屏上不会产生 mousemove 序列）
  let tId=null,tlx=0,tly=0,tmax=0;
  fab.addEventListener('touchstart',e=>{const t=e.changedTouches[0];tId=t.identifier;tlx=t.clientX;tly=t.clientY;tmax=0;curPress=++pressId;draggedThisPress=false;},{passive:true});
  fab.addEventListener('touchmove',e=>{
    for(const t of e.changedTouches){
      if(t.identifier!==tId)continue;
      const dx=t.clientX-tlx,dy=t.clientY-tly;tlx=t.clientX;tly=t.clientY;
      tmax=Math.max(tmax,Math.hypot(dx,dy));
      if(tmax>2){e.preventDefault();draggedThisPress=true;
        const cr=fab.getBoundingClientRect();
        const nx=Math.max(0,Math.min(innerWidth-fab.offsetWidth,cr.left+dx));
        const ny=Math.max(0,Math.min(innerHeight-fab.offsetHeight,cr.top+dy));
        fab.style.left=nx+'px';fab.style.top=ny+'px';
        if(panel.style.display!=='none')placePanel();}
    }
  },{passive:false});
  fab.addEventListener('touchend',e=>{if(tmax>2){draggedThisPress=true;e.preventDefault();trySnap();}tId=null;tmax=0;});
  // v10.44：点击图标切换面板开合；图标常驻可见，面板紧贴图标排开不遮挡它
  // v10.48：点图标始终开/关面板；面板打开时自动校准图标回左上角音符位置
  fab.onclick=()=>{
    // 只有"本次按下期间确实动过"的点击被拦（即拖动后浏览器补发的那次 click）；
    // 新一次按下是新的 curPress，draggedThisPress 已在按下时清零，真实点击一定放行
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
  };

  function fmt(n){return n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':String(n);}
  function sync(){
    document.getElementById('run').classList.toggle('on',cfg.enabled);
    document.getElementById('rlive').classList.toggle('on',!cfg.skipLive);
    document.getElementById('rfem').classList.toggle('on',cfg.keepFemale);
    document.getElementById('rmus').classList.toggle('on',cfg.keepMusic);
    document.getElementById('rj').classList.toggle('on',cfg.autoJ);
    document.querySelectorAll('#thg button').forEach(b=>b.classList.toggle('on',+b.dataset.v===cfg.threshold));
  }
  let _lk='';
  function render(){
    const r=state.lastResult||{};
    const k=JSON.stringify(r)+state.kept+state.skipped+state.liveSkipped+state.femaleKept+state.adSkipped+state.authorPage+cfg.enabled+cfg.skipLive+cfg.keepFemale+cfg.keepMusic+cfg.autoJ+cfg.threshold;
    if(k===_lk)return;
    _lk=k;
    sync();
    document.getElementById('nk').textContent=state.kept;
    document.getElementById('ns').textContent=state.skipped;
    document.getElementById('nl').textContent=state.liveSkipped;
    document.getElementById('nf').textContent=state.femaleKept;
    if(document.getElementById('na'))document.getElementById('na').textContent=state.adSkipped;
    const sm=document.getElementById('sm'),ss=document.getElementById('ss');
    if(commentsOpen()){sm.className='m cy';sm.textContent='评论中';ss.textContent='自动刷已暂停';return;}
    if(state.authorPage){sm.className='m cp';sm.textContent='主页';ss.textContent='';return;}
    if(userPauseMode){sm.className='m cy';sm.textContent='暂停';ss.textContent='';return;}
    if(userBackMode){sm.className='m cp';sm.textContent='回看';ss.textContent='';return;}
    if(!cfg.enabled){sm.className='m cy';sm.textContent='已停止';ss.textContent='';return;}
    if(r.verdict==='live'){sm.className='m cb';sm.textContent='直播';ss.textContent='';}
    else if(r.verdict==='ad'){sm.className='m cr';sm.textContent='广告';ss.textContent='';}
    else if(r.verdict==='game-shopping'){sm.className='m cr';sm.textContent='购物';ss.textContent='';}
    else if(r.verdict==='male-skip'){sm.className='m cr';sm.textContent='男性';ss.textContent='';}
    else if(r.verdict==='music-keep'){sm.className='m cg';sm.textContent='音乐保留';ss.textContent='汽水音乐';}
    else if(r.verdict==='female-keep'){sm.className='m cg';sm.textContent='女生保留';ss.textContent=r.hit?'命中「'+r.hit+'」':'';}
    else if(r.verdict==='keep'){sm.className='m cg';sm.textContent=fmt(r.value)+'赞';ss.textContent='达标';}
    else if(r.verdict==='low'){sm.className='m cr';sm.textContent=fmt(r.value)+'赞';ss.textContent='低赞';}
    else{sm.className='m cy';sm.textContent='读取中';ss.textContent='';}
  }
  // v10.13：四个开关按钮共用一个处理函数，消除重复。
  function toggleOpt(key, needRecheck){
    cfg[key]=!cfg[key];saveCfg();invalidate();
    if(needRecheck){state.activeVid=null;state.handling=false;}
    _lk='';render();
  }
  document.getElementById('run').onclick=()=>toggleOpt('enabled',false);
  document.getElementById('rlive').onclick=()=>toggleOpt('skipLive',true);
  document.getElementById('rfem').onclick=()=>toggleOpt('keepFemale',true);
  document.getElementById('rmus').onclick=()=>toggleOpt('keepMusic',true);
  document.getElementById('rj').onclick=()=>toggleOpt('autoJ',false);
  document.querySelectorAll('#thg button').forEach(b=>{b.onclick=()=>{cfg.threshold=+b.dataset.v;saveCfg();_lk='';render();};});
  // v10.60：主题色圆圈 —— 切换菜单强调色，并持久化
  // v10.61：悬浮图标固定抖音红，不跟随主题
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
  (()=>{const h=document.getElementById('dd');let d=false,dx=0,z=1;
    h.addEventListener('mousedown',e=>{if(e.target.id==='run')return;d=true;z=parseFloat(panel.style.zoom)||1;dx=e.clientX-panel.offsetLeft*z;});
    document.addEventListener('mousemove',e=>{if(!d)return;const zl=parseFloat(panel.style.zoom)||1;panel.style.left=Math.max(0,(e.clientX-dx)/zl)+'px';try{localStorage.setItem('dyhlf_pp',JSON.stringify({l:panel.style.left,t:panel.style.top}))}catch(e){}});
    document.addEventListener('mouseup',()=>d=false);
  })();
  // v11.2：右下角拖拽柄 —— zoom 等比缩放整个 UI；视觉右边缘 1:1 跟随鼠标，无漂移
  // 默认 zoom 让菜单从顶部覆盖到屏幕约 3/4 处（即菜单高度 ≈ 屏幕 3/4 的视觉高度）
  (()=>{
    const rs=document.getElementById('dy-rs');let d=false;
    const BASE_H = 406;  // 面板原始 CSS 高度
    const BASE_W = 200;  // 面板原始 CSS 宽度
    const MIN_Z = 0.6;
    // 上限：菜单视觉尺寸不能超过屏幕（宽高都限制）
    const maxZoom = () => Math.min(
      (window.innerHeight - 8) / BASE_H,   // 高度不超屏
      (window.innerWidth - 8) / BASE_W     // 宽度不超屏
    );
    // 默认 zoom：菜单视觉高度 ≈ 屏幕 3/4 高度
    const defaultZoom = () => {
      const target = (window.innerHeight * 0.75) / BASE_H;
      return Math.max(MIN_Z, Math.min(maxZoom(), target));
    };
    // 锁左上角视觉位置：缩放时反向调整 cssLeft/cssTop
    // 视觉左边缘 = cssLeft * zoom；若保持视觉左边缘不变，cssLeft_new = visLeft / zoom_new
    let anchorVis = null;
    rs.addEventListener('mousedown',e=>{
      d=true;e.preventDefault();e.stopPropagation();
      // 记录当前视觉左上角位置（缩放时锁定不变）
      const z0 = parseFloat(panel.style.zoom)||1;
      anchorVis = {
        l: (parseFloat(panel.style.left)||0) * z0,
        t: (parseFloat(panel.style.top)||0) * z0,
      };
    });
    document.addEventListener('mousemove',e=>{
      if(!d||!anchorVis)return;
      // 视觉右边缘 = 视觉左边缘 + BASE_W * zoom = clientX → zoom = (clientX - 视觉左边缘) / BASE_W
      const targetZ = (e.clientX - anchorVis.l) / BASE_W;
      const z = Math.max(MIN_Z, Math.min(maxZoom(), targetZ));
      panel.style.zoom = z;
      // 锁定左上角视觉位置：cssLeft = visLeft / z，cssTop = visTop / z
      panel.style.left = (anchorVis.l / z) + 'px';
      panel.style.top = (anchorVis.t / z) + 'px';
    });
    document.addEventListener('mouseup',()=>{if(d){d=false;anchorVis=null;const _z=parseFloat(panel.style.zoom);panel.dataset.userZoom=_z;try{localStorage.setItem('dyhlf_zoom',String(_z));}catch(e){}}});
    // 初始化：优先恢复用户上次保存的缩放，否则用默认值
    try {
      const _savedZ = parseFloat(localStorage.getItem('dyhlf_zoom'));
      if (_savedZ && _savedZ >= MIN_Z) { panel.style.zoom = _savedZ; panel.dataset.userZoom = _savedZ; }
      else if (!parseFloat(panel.style.zoom)) { panel.style.zoom = defaultZoom(); }
    } catch(e) { if (!parseFloat(panel.style.zoom)) panel.style.zoom = defaultZoom(); }
    window.addEventListener('resize', () => {
      // 屏幕尺寸变化时重新计算默认 zoom（仅当用户未手动调整过时）
      if (Math.abs(parseFloat(panel.style.zoom) - (parseFloat(panel.dataset.userZoom)||0)) < 0.001) {
        panel.style.zoom = defaultZoom();
      }
    });
  })();
  // v10.55：点菜单和悬浮图标以外的任意区域，自动关闭菜单
  document.addEventListener('mousedown',e=>{
    if (panel.style.display==='none') return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#dy-fab')) return;
    panel.style.display='none'; _panelOpen=false;
  });
  // v10.55：清除程序按钮 —— 停掉所有逻辑、清配置、清缓存、销毁 UI
  const _dyClear = () => {
    try { window.__dyhlf?.stop(); } catch(e){}
    try { localStorage.removeItem('dyhlf_cfg'); localStorage.removeItem('dyhlf_pp'); localStorage.removeItem('dyhlf_theme'); } catch(e){}
    try { document.getElementById('dy')?.remove(); } catch(e){}
    try { document.getElementById('dy-fab')?.remove(); } catch(e){}
    try { document.querySelectorAll('#dy,style').forEach(el=>{ if(el.id==='dy') el.remove(); }); } catch(e){}
  };
  document.getElementById('dy-cls').onclick = _dyClear;
  // v11.2：点击版本号 / 标题 = 重启程序（保留配置、重建 UI）
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
    // 标题点击重启：拖动标题时（位移>6px）不触发，避免误重启
    const tEl = panel.querySelector('.hd .t');
    tEl.style.cursor = 'pointer';
    let _px = 0, _py = 0, _down = false;
    tEl.addEventListener('mousedown', e => { _down = true; _px = e.clientX; _py = e.clientY; });
    tEl.addEventListener('mouseup', e => {
      if (!_down) return;
      _down = false;
      if (Math.hypot(e.clientX - _px, e.clientY - _py) > 6) return; // 拖动，不重启
      _dyRestart();
    });
  })();
  sync();render();
  // v10.44：登录弹窗/SPA 重绘会把 UI 从 DOM 里摘掉，观察并在被删后重建（保持可见）
  // 面板开关状态由图标点击控制，故恢复后一律关闭
  let _uiDead = false;
  let _panelOpen = false;
  const _restoreUI = () => {
    if (document.getElementById('dy-fab')) return;
    _uiDead = true;
    placePanel();
    fab.style.display = 'block';
    fab.id = 'dy-fab'; fab.textContent = '';
    fab.style.background = '#0000 url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23ED4B2C%22%2F%3E%3Crect%20x%3D%2226%22%20y%3D%2241%22%20width%3D%2226%22%20height%3D%228%22%20rx%3D%222%22%20fill%3D%22%23fff%22%2F%3E%3C%2Fsvg%3E") center/100% 100% no-repeat';
    fab.style.borderRadius = '14px';
    fab.style.boxShadow = '0 4px 14px rgba(0,0,0,.4)';
    document.body.appendChild(fab);
    if (!document.getElementById('dy')) {
      panel.id = 'dy';
      document.body.appendChild(panel);
      panel.style.display = 'none';
    }
    _lk = ''; render();
    _uiDead = false;
    panel.style.display = _panelOpen ? 'block' : 'none';
    fab.style.display = 'block';
  };
  const _uiObs = new MutationObserver(() => { if (!_uiDead) _restoreUI(); });
  _uiObs.observe(document.body, { childList: true, subtree: false });
  window.__dyhlf={cfg,state,getState(){return{...state,threshold:cfg.threshold,enabled:cfg.enabled,vid:currentVid()};},
    stop(){cfg.enabled=false;invalidate();clearInterval(tickTimer);_uiDead=false;
    document.removeEventListener('keydown',onKey,true);document.removeEventListener('wheel',onWheel,true);document.removeEventListener('click',onClick,true);
    _uiObs.disconnect();
    panel.remove();fab.remove();style.remove();window.__dyhlf=null;}};
  console.log('[FILTER v11.2] loaded');
})();
