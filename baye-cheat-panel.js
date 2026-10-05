/* ============================================================================
   三国霸业 · 金手指 v1.0（外挂版 / 不改源码）
   ----------------------------------------------------------------------------
   适用：https://baye.bbkgames.com/index.html （平衡版2.1三国战纪 / 平衡版2.1修罗模式）
   用法：1) 打开游戏页 → 控制台粘贴本文件 → 回车；或 2) 做成书签点击
        3) 推荐：Tampermonkey 用户脚本，document-start 注入（会走 preScriptInit）

   实现原理（引擎侧已核实）：
     · 引擎在 baye.js:2658660 处 `eval(script)` 执行 lib 内嵌脚本，
       执行前会调用 window.baye.preScriptInit()  —— 这是官方预留的脚本前钩子；
     · 所有扩展点都是 baye.hooks.<名字>，引擎在 baye.js:2658773 处
       每次调用都重新查表，所以运行期替换 baye.hooks.xxx 立即生效；
     · 未注册的钩子返回 -1，引擎走默认逻辑，因此本脚本可以按需只挂一部分。

   本脚本全部钩子都采用「备份原钩子 → 包装 → 再调用原钩子」的方式挂载，
   不会覆盖 lib 自带脚本（平衡版2.1 已注册 cityMakeCommand / tacticStage1 等），
   卸载时能完整还原。
   ============================================================================ */
(function () {
    'use strict';

    /* ======================== 0. 运行环境检查 ======================== */
    if (typeof window === 'undefined') return;

    if (window.bayeCheat && window.bayeCheat.version) {
        console.log('[金手指] 已加载 v' + window.bayeCheat.version + '，本次跳过');
        return;
    }

    var CHEAT_VERSION = '1.20.4';

    function ready() {
        return window.baye && window.baye.hooks && window.baye.data;
    }

    /* 启动逻辑放在 IIFE 末尾（见文件最后的 bootstrap），
       因为 install() 依赖本文件后半部分定义的状态与函数。 */
    var TIMER = null;

    function bootstrap() {
        /* 尽早装上存档识别钩子（引擎读/写存档时立刻能知道是哪个 .sav） */
        try { hookEngineSaveIO(); } catch (e) { }
        try { hookSaveLoaders(); } catch (e) { }
        /* 页面在 lib 脚本 eval 之前尚未建立 baye.data，故分两条路径：
           · 早注入 → 挂 preScriptInit，等引擎初始化完成后再装钩子；
           · 晚注入 → 直接装钩子。 */
        if (!ready()) {
            var pre = window.baye && window.baye.preScriptInit;
            window.baye = window.baye || {};
            window.baye.preScriptInit = function () {
                try { if (pre) pre(); } catch (e) { }
                try { install(); } catch (e) { console.error('[金手指] install 失败', e); }
            };
            /* 引擎已跑过 preScriptInit 但 data 还没就绪的兜底：轮询等待 */
            TIMER = setInterval(function () {
                if (ready()) { clearInterval(TIMER); install(); }
            }, 300);
            setTimeout(function () { if (TIMER) clearInterval(TIMER); }, 60000);
            return;
        }
        install();
    }

    /* ======================== 1. 安装入口 ======================== */
    function install() {
        if (window.bayeCheat && window.bayeCheat.version) return;
        if (!ready()) return;

        setupHooks();
        buildUI();
        startSaveUiWatch();

        window.bayeCheat = {
            version: CHEAT_VERSION,
            cfg: cfg,
            save: saveCfg,
            uninstall: uninstall,
            hooks: wrappedHooks,
            api: {
                personAt: personAt,
                cityAt: cityAt,
                ownCities: ownCities,
                kingGuardPass: kingGuardPass,
                rescueLostGenerals: rescueLostGenerals,
                /* 调试辅助：查看当前待结算指令 / 某城的在野列表 / 水域缓存 */
                wildsOfCity: wildsOfCity,
                waterCache: function () { return waterCache; },
                battleMapOf: battleMapOf,
                monthReport: function () { return info.monthReport; },
                diag: function () { return diag; },
                /* 战略态势：每个势力的都城 / 各城守备战力与威胁，控制台直接看 AI 在想什么 */
                strategy: function () {
                    var cities = baye.data.g_Cities, out = [], seen = {}, c, i;
                    for (c = 0; c < cities.length; c++) {
                        var b = cities[c].Belong;
                        if (b <= 0 || b === CAPTIVE || seen[b]) continue;
                        seen[b] = 1;
                        var mine = ownCities(b), det = [];
                        for (i = 0; i < mine.length; i++) {
                            var cc = mine[i];
                            var gd = Math.round(cityGuardPower(cc, b) / 100) / 10;
                            var th = Math.round(cityThreat(cc, b) / 100) / 10;
                            det.push(cityName(cc) + ' 守' + gd + 'k/威' + th + 'k');
                        }
                        out.push(safeName(b) + '军（' + mine.length + '城）：' + det.join(' | '));
                    }
                    return out;
                },
                openDistribution: showDistribution,
                /* 铁匠铺：控制台可直接查曲线/手动强化，便于验证与批量操作 */
                forgeLv: function (pid, slot) { return forgeLv(pid, slot); },
                aiForge: function () { return aiForgeAll(); },
                forgeInfo: function () {
                    var costs = [], rates = [], muls = [], lv;
                    for (lv = 0; lv <= FORGE_MAX; lv++) {
                        costs.push(forgeCost(lv, 2));
                        rates.push(forgeRate(lv, 0));
                        muls.push(forgeDmgMul(lv));
                    }
                    return {
                        max: FORGE_MAX, costs: costs, rates: rates, muls: muls,
                        levelOf: function (pid, slot) { return forgeLv(pid, slot); },
                        table: function () { return FORGE; }
                    };
                },
                forgeOnce: forgeOnce,
                forgeOpen: showForge,
                forgeReload: reloadForge,
                /* 资源管理：控制台可直接调，便于批量操作与验证 */
                rich: doRich,
                giveAllTools: giveAllTools,
                levelUpAll: levelUpAll,
                boostExperience: boostExperience,
                capital: capitalCity,
                maxLevel: maxLevelOf,
                toolTypeName: toolTypeName,
                toolForgeable: toolForgeable,
                /* v1.11.2：道路/名册诊断（跨城进攻、君主错列都是靠这两条查的） */
                adjacencyReady: adjReady,
                isAdjacent: isAdjacent,
                adjOf: adjOf,
                launchAttack: launchAttack,
                repairRoster: repairCityRoster,
                /* v1.11.7：存档分槽（强化/阵亡跟随存档，三个档位分开；新档未保存用 tmp） */
                slot: currentSlot,
                setSlot: setSlot,
                bindCurrent: bindCurrentSlot,
                fingerprint: gameFingerprint,
                saveKeys: storageSaveKeys,
                currentSave: currentSaveId,
                engineSaves: engineSaveList,
                reeHook: hookEngineSaveIO,
                moneyCap: function () { return MONEY_SOFT_CAP; },
                food: doFood,
                resCap: function () { return { money: RES_CAP_MONEY, food: RES_CAP_FOOD, writeMax: RES_WRITE_MAX, carry: RES_CARRY }; },
                /* 手动补到上限 */
                refill: function () { return refillResources(true); },
                /* 手动跑一次「被削就补」的恢复（诊断用） */
                restoreRes: function () { recordResBase(); restoreResIfClamped(); return true; },
                /* 彻底测一次：写 65535 看引擎给多少（回答「金币上限能不能破」） */
                probeGold: function () {
                    var c = capitalCity();
                    if (c < 0) return0;
                    var city = cityAt(c), old = Number(city.Money) || 0, out = [];
                    [100000, 65535, 60000, 45000, 30001, 30000].forEach(function (v) {
                        city.Money = v;
                        var back = Number(city.Money) || 0;
                        out.push('写 ' + v + ' → ' + back + (back < v ? '（被截）' : '（写入成功）'));
                        city.Money = old;
                    });
                    var msg = '金币上限实测（' + cityName(c) + '）：\n' + out.join('\n')
                        + '\n\n结论：' + (out[1].indexOf('（写入成功）') >= 0
                            ? '引擎允许超过 30000，说明之前看到的 30000 是月结钳制，可通过月初补回绕过'
                            : '字段本身就被钳在 30000，脚本无法突破（只能改引擎 WASM）');
                    alert2(msg); log(msg);
                    return out;
                },
                resetResCarry: function () { RES_CARRY = {}; RES_SNAP = {}; return true; },
                resetResState: function () { RES_LAST = {}; return true; },
                setResLast: function (c, v) { RES_LAST[c] = v; return true; },
                /* 引擎配置一览：用来确认金币/粮草上限是不是可配置参数 */
                engineConfig: function () {
                    var ec = baye.data.g_engineConfig, out = {};
                    try { for (var k in ec) { if (ec.hasOwnProperty(k)) out[k] = ec[k]; } } catch (e) { }
                    return out;
                },
                probeMoneyCap: probeMoneyCap,
                /* 换月/读档时清空「本月已打过」账本；控制台与测试也用它复位 */
                /* 重置出征节奏（调试用：清掉冷却与加码计数） */
                /* 赛马 v2 api */
                race: function () { var r = raceRunOne(raceSeason()); return r.lines; },
                raceFull: function () { return raceRunOne(raceSeason()); },
                raceSignUp: function () { raceSignUpDialog(); return true; },
                racePool: function () { return raceMountPool(); },
                raceState: function (nm) { return mountState((baye.data.g_PlayerKing || 0) + 1, nm); },
                raceEntry: function () { return RACE_ENTRY.slice(); },
                raceHistory: function () { return RACE_HISTORY.slice(); },
                feedStable: function () { feedStableDialog(); return true; },
                selectRun: function () { return raceSelectRun(null); },
                resetRaceRhythm: function () { RACE_LAST_HELD = -1; RACE_LAST_MD = -1; RACE_COUNT = 0; return true; },
                selectDialog: function () { raceSelectDialog(); return true; },
                kingName: function (k) { return kingName(k); },
                raceMounts: function () { return myMounts(); },
                feedMounts: function () { feedMounts(); return true; },
                resetWarRhythm: function () { WAR_LAST = {}; WAR_COUNT = {}; return true; },
                warRhythm: function () { return { last: WAR_LAST, count: WAR_COUNT, mk: gameMonthIndex(), warmup: WARMUP_MONTHS, cd: WAR_COOLDOWN }; },
                resetAttackLog: function () { ATTACKED.month = ''; ATTACKED.targets = {}; return true; },
                showMonthReport: showMonthReport,
                sidePowerOf: function (pid) { return genPower(pid); }
            },
            /* 重复挂载钩子（幂等）：只在钩子已被外部改写时重装，
               供控制台在替换引擎钩子后重新包一层。 */
            reinstallHooks: function () {
                Object.keys(wrappedHooks).forEach(function (n) {
                    if (baye.hooks[n] && baye.hooks[n].__bayeCheatWrap) return;
                    delete baye.hooks[n];
                });
                wrappedHooks = {};
                setupHooks();
                log('钩子已重装');
            }
        };
        log('三国霸业·金手指 v' + CHEAT_VERSION + ' 已加载（点右上角 ⚙ 打开设置）');
    }

    function log() {
        var a = Array.prototype.slice.call(arguments);
        a.unshift('[金手指]');
        console.log.apply(console, a);
    }

    /* ---------- 存档分槽（v1.11.7） ----------
       强化等级、阵亡台账属于「存档内」数据，必须跟着存档走：三个存档位分开保存，
       新开的档在保存之前落在 'tmp' 临时槽；之后读档若能识别出真实档位，会把临时槽数据并过去。
       档位识别：引擎字段（g_SaveSlot 之类）→ URL 参数（?slot=2）→ 面板手动指定；
       都拿不到就用 'tmp'，并在控制台打印候选存档键，便于进一步确认。 */
    var SLOT_KEY = 'baye_cheat_slot_v1';         /* 面板选择：auto / tmp / 1 / 2 / 3 */
    var SLOT_MARK = 'baye_cheat_last_slot_v1';  /* 上次实际使用的槽（用于 tmp→档位 迁移） */
    /* ---------- 存档位识别（v1.11.8） ----------
       实测：引擎的存档不是 localStorage，而是文件 —— 控制台能看到
       「Loading baye/data/sango0.sav / sango2.sav / sango4.sav / sango6.sav」。
       所以这里 hook fetch / XMLHttpRequest，记录「实际被读取过的 .sav 文件」，
       最后读到的那个就是当前载入的存档；按出现顺序映射成槽1/槽2/槽3…
       引擎字段（g_SaveSlot 等）与 URL 参数仍作为优先来源。 */
    var SAVE_FILES = [];              /* 按时间顺序记录读过的存档文件（去重） */
    function noteSaveFile(url) {
        if (!url) return;
        var m = /([a-z0-9_-]+\.sav)(?:\?|#|$)/i.exec(String(url));
        if (!m) return;
        var f = m[1];
        if (SAVE_FILES.indexOf(f) < 0) {
            SAVE_FILES.push(f);
            log('检测到存档文件：' + f + '（当前 ' + SAVE_FILES.length + ' 个）');
        }
    }
    function hookSaveLoaders() {
        try {
            var of = window.fetch;
            if (typeof of === 'function' && !of.__bayeSaveHook) {
                var wrapped = function (input, init) {
                    try {
                        noteSaveFile(typeof input === 'string' ? input
                            : (input && input.url) || (input && input.toString && input.toString()));
                    } catch (e) { }
                    return of.apply(this, arguments);
                };
                wrapped.__bayeSaveHook = 1;
                window.fetch = wrapped;
            }
        } catch (e) { }
        try {
            var XO = XMLHttpRequest.prototype.open;
            if (typeof XO === 'function' && !XO.__bayeSaveHook) {
                var hooked = function (method, url) {
                    try { noteSaveFile(url); } catch (e) { }
                    return XO.apply(this, arguments);
                };
                hooked.__bayeSaveHook = 1;
                XMLHttpRequest.prototype.open = hooked;
            }
        } catch (e2) { }
        /* 已经读过的（脚本注入前发生的请求）从 Resource Timing 里补捞 */
        try {
            var es = (window.performance && performance.getEntriesByType) ? performance.getEntriesByType('resource') : [];
            for (var i = 0; i < es.length; i++) {
                if (/\.sav(\?|#|$)/i.test(es[i].name || '')) noteSaveFile(es[i].name);
            }
        } catch (e3) { }
    }
    /* 当前读到的存档 → 槽位号（按首次出现顺序编号，1 起） */
    function slotFromSaveFile() {
        if (!SAVE_FILES.length) return '';
        var idx = SAVE_FILES.length;                    /* 最后读到的那个 */
        return String(idx);
    }

    /* ---------- 存档槽位绑定（v1.11.9） ----------
       实测：.sav 是引擎（emscripten 胶水层 lcd.js）在初始化时就把 fetch/XHR 引用
       缓存住后由 WASM 内部发起的请求，JS 层的 hook 装得太晚抓不到
       （saveKeys() 返回空就是这个原因）。所以自动识别改走两条可靠路径：
         ① 指纹绑定：玩家把「当前这个档」一次性标记成槽1/2/3，之后按
            「君主 + 都城」指纹自动对上（同一君主换都城也能区分）；
         ② 带槽位的书签：书���开头先写 slot 再注入脚本，点哪个档就用哪个槽。*/
    var SLOT_BIND_KEY = 'baye_cheat_slot_bind_v1';   /* { '君主|都城': '1' | '2' | '3' } */
    function slotBindings() {
        try { return JSON.parse(localStorage.getItem(SLOT_BIND_KEY)) || {}; } catch (e) { return {}; }
    }
    function gameFingerprint() {
        try {
            var k = (baye.data.g_PlayerKing || 0);
            var king = (k >= 0 && baye.getPersonName) ? String(baye.getPersonName(k)) : ('K' + k);
            var cap = capitalCity();
            var capName = cap >= 0 ? cityName(cap) : '?';
            return king + '|' + capName;
        } catch (e) { return ''; }
    }
    function bindCurrentSlot(n) {
        var fp = gameFingerprint();
        if (!fp) { alert2('当前游戏状态读不到，无法绑定槽位'); return ''; }
        var b = slotBindings();
        /* 同一指纹只允许绑定一个槽，避免重复绑定造成歧义 */
        for (var k in b) { if (b.hasOwnProperty(k) && b[k] === n) delete b[k]; }
        b[fp] = String(n);
        try { localStorage.setItem(SLOT_BIND_KEY, JSON.stringify(b)); } catch (e) { }
        log('已把「' + fp + '」绑定到槽' + n);
        alert2('已绑定：\n君主/都城特征 = ' + fp + '\n→ 槽' + n
            + '\n\n以后只要读到带这个特征的存档，就自动使用槽' + n + ' 的强化与阵亡数据。'
            + '\n（换君主或换都城后需要重新绑定一次）');
        return fp;
    }
    function slotFromBinding() {
        var fp = gameFingerprint();
        if (!fp) return '';
        var b = slotBindings();
        return b[fp] ? String(b[fp]) : '';
    }

    function autoSlotId() {
        try {
            var d = baye.data, ks = ['g_SaveSlot', 'g_SaveIndex', 'g_SaveNo', 'g_SaveID', 'g_SlotIndex'], i, v, n;
            for (i = 0; i < ks.length; i++) {
                v = d[ks[i]];
                if (v !== undefined && v !== null && v !== '' && isFinite(Number(v))) {
                    n = Number(v);
                    return 'slot' + (n > 0 ? n : 1);
                }
            }
            var m = /[?&](?:slot|save|s)=([0-9]+)/i.exec(String((window.location && window.location.search) || ''));
            if (m) return 'slot' + m[1];
            var sb = slotFromBinding();                  /* 君主+都城 指纹绑定（最可靠） */
            if (sb) return 'slot' + sb;
            var sf = slotFromSaveFile();
            if (sf) return 'slot' + sf;
        } catch (e) { }
        return '';
    }
    /* ---------- 存档位自动绑定（v1.12.1） ----------
       引擎源码 lcd.js 的 bayeLoadFileContent(filename) 直接读
       window.localStorage['baye//data//sango0.sav']，且是全局 JS 函数 → 可直接包。
       实测读档流程（用户控制台日志）：
           存档读取 0,2,4,6（存档列表枚举）→ 目标档(0/2/4) → fread → 配对档(1/3/5) → didLoadGame
       即：偶数号与紧邻的奇数号是同一个存档的两份（0↔1、2↔3、4↔5、6↔7），
       所以统一折算到偶数号，槽位标识就用它（save_sango0 / save_sango2 / save_sango4 …），
       与游戏自己的存档 1:1 绑定，零手动操作。
       两个状态要分清：
         CUR_SAVE_SEEN   —— 最近读/写到的存档（面板显示用，可能还停在列表枚举阶段）
         CUR_SAVE_ACTIVE —— 真正在玩的存档（didLoadGame / 写入时确定；数据一律按它落盘） */
    var CUR_SAVE_SEEN = '', CUR_SAVE_ACTIVE = '', CUR_SAVE_LOGGED = '', SAVE_LOG_TIMER = null;
    function normalizeSaveId(name) {
        var m = /sango(\d+)/i.exec(String(name || ''));
        if (!m) return '';
        var n = parseInt(m[1], 10);
        if (!isFinite(n)) return '';
        return 'sango' + (n - (n % 2));           /* 折算到偶数号：sango1→sango0 */
    }
    function noteSaveName(fn, isWrite) {
        if (!fn) return '';
        var m = /(sango\d*)\.sav$/i.exec(String(fn));
        if (!m) return '';
        var id = normalizeSaveId(m[1]);
        if (!id) return '';
        if (isWrite) {
            if (CUR_SAVE_ACTIVE !== id) { CUR_SAVE_ACTIVE = id; onActiveSaveChanged(id); }
            CUR_SAVE_SEEN = id;
        } else {
            if (CUR_SAVE_SEEN !== id) { CUR_SAVE_SEEN = id; scheduleSaveLog(id); }
        }
        return id;
    }
    /* 枚举 6 个文件会连着触发 → 合并成一条日志，不要刷屏 */
    function scheduleSaveLog(id) {
        if (SAVE_LOG_TIMER) clearTimeout(SAVE_LOG_TIMER);
        SAVE_LOG_TIMER = setTimeout(function () {
            SAVE_LOG_TIMER = null;
            var line = '当前存档：' + id + '.sav　数据槽：' + currentSlot();
            if (CUR_SAVE_LOGGED !== line) { CUR_SAVE_LOGGED = line; log(line); }
            refreshSlotBtns();
        }, 500);
    }
    /* 真正在玩的存档变了 → 立刻把强化/台账切到对应槽，并同步面板 */
    function onActiveSaveChanged(id) {
        var before = currentSlot();
        try { loadSlotData(true); } catch (e) { }
        if (currentSlot() !== before) {
            log('存档切换：数据槽 ' + before + ' → ' + currentSlot() + '（已载入该存档的强化与台账）');
        }
        refreshSlotBtns();
    }
    function currentSaveId() { return CUR_SAVE_ACTIVE || CUR_SAVE_SEEN || ''; }
    function hookEngineSaveIO() {
        /* ① 包住引擎的存档读取入口。
           真实形态：lcd.js 顶层 `function bayeLoadFileContent(filename)`（window 上的全局函数），
           引擎/WASM 通过这个名字调用；个别版本会挂在 baye 对象上，两处都试。 */
        try {
            var targets = [window, (typeof baye !== 'undefined' ? baye : null)];
            for (var ti = 0; ti < targets.length; ti++) {
                var t = targets[ti];
                if (!t || typeof t.bayeLoadFileContent !== 'function') continue;
                if (t.bayeLoadFileContent.__bayeSaveHook) continue;
                var host = t, of = t.bayeLoadFileContent;
                var wrapped = function (filename) {
                    try { noteSaveName(filename, false); } catch (e) { }
                    return of.apply(this, arguments);
                };
                wrapped.__bayeSaveHook = 1;
                try { host.bayeLoadFileContent = wrapped; } catch (e2) { }
            }
        } catch (e3) { }
        /* ② 包住 localStorage 写入：引擎保存时会写自己的存档键 */
        try {
            var sp = (typeof Storage !== 'undefined') ? Storage.prototype : null;
            if (sp && typeof sp.setItem === 'function' && !sp.setItem.__bayeSaveHook) {
                var os = sp.setItem;
                var ws = function (k, v) {
                    try { noteSaveName(k, true); } catch (e2) { }
                    return os.apply(this, arguments);
                };
                ws.__bayeSaveHook = 1;
                sp.setItem = ws;
            }
        } catch (e3) { }
    }
    /* 存档文件清单（localStorage 里真实存在的） */
    function engineSaveList() {
        var out = [], i, k;
        try {
            for (i = 0; i < localStorage.length; i++) {
                k = localStorage.key(i);
                if (k && /sango\d*\.sav$/i.test(k)) {
                    out.push({ name: (/(sango\d*)\.sav$/i.exec(k) || [, '?'])[1], key: k, size: (localStorage.getItem(k) || '').length });
                }
            }
        } catch (e) { }
        return out;
    }
    /* 存档位 → 存储键里的槽标识。存档位直接用存档文件名（save_sango0），
       这样强化/台账天然跟着游戏那个存档走。 */
    function slotIdOf(saveId) { return saveId ? ('save_' + saveId) : ''; }

    function currentSlot() {
        var sel = 'auto';
        try { sel = localStorage.getItem(SLOT_KEY) || 'auto'; } catch (e) { }
        if (sel === 'tmp') return 'tmp';
        if (sel === '1' || sel === '2' || sel === '3') return 'slot' + sel;
        /* 自动：URL 参数 → 引擎字段 → 存档文件名（最可靠）→ 旧指纹绑定 → tmp */
        try {
            var m = /[?&](?:slot|save|s)=([0-9]+)/i.exec(String((window.location && window.location.search) || ''));
            if (m) return 'slot' + m[1];
            var d = baye.data, ks = ['g_SaveSlot', 'g_SaveIndex', 'g_SaveNo', 'g_SaveID', 'g_SlotIndex'], i, v, n;
            for (i = 0; i < ks.length; i++) {
                v = d[ks[i]];
                if (v !== undefined && v !== null && v !== '' && isFinite(Number(v))) {
                    n = Number(v);
                    return 'slot' + (n > 0 ? n : 1);
                }
            }
        } catch (e2) { }
        var sid = slotIdOf(currentSaveId());
        if (sid) return sid;
        try {
            var sb = slotFromBinding();
            if (sb) return 'slot' + sb;
            var sf = slotFromSaveFile();
            if (sf) return 'slot' + sf;
        } catch (e3) { }
        return 'tmp';
    }
    function skey(name) { return 'baye_cheat_' + currentSlot() + '_' + name; }
    /* 旧版无槽前缀的键：首次按当前槽落一份，避免历史强化等级/台账丢失 */
    function migrateLegacy(name, legacyKey) {
        try {
            if (localStorage.getItem(skey(name)) !== null) return;
            var old = localStorage.getItem(legacyKey);
            if (old !== null && old !== undefined) localStorage.setItem(skey(name), old);
        } catch (e) { }
    }
    function setSlot(sel) {
        try { localStorage.setItem(SLOT_KEY, sel); } catch (e) { }
        /* 手动切槽不做 tmp 迁移（手动就是明确指定，不该搬数据） */
        loadSlotData(false);
        return currentSlot();
    }
    /* 读取（或切换到）当前槽的数据：强化表 + 阵亡台账 */
    function loadSlotData(migrateTmp) {
        var cur = currentSlot();
        /* 新档期落在 tmp，之后「自动」识别到真实档位 → 把临时数据并过去（只做一次）。
           手动指定槽位时不迁移。 */
        if (migrateTmp && slotSelection() === 'auto') {
            var prev = '';
            try { prev = localStorage.getItem(SLOT_MARK) || ''; } catch (e) { }
            /* 新档期落在 tmp，之后识别到真实档位 → 把临时数据并过去（只做一次） */
            if (prev === 'tmp' && cur !== 'tmp') {
                try {
                    ['forge_v1', 'deaths_v1'].forEach(function (n) {
                        var tk = 'baye_cheat_tmp_' + n;
                        var raw = localStorage.getItem(tk);
                        if (raw === null) return;
                        if (localStorage.getItem('baye_cheat_' + cur + '_' + n) === null) {
                            localStorage.setItem('baye_cheat_' + cur + '_' + n, raw);
                        }
                        localStorage.removeItem(tk);
                    });
                    log('存档位迁移：tmp → ' + cur);
                } catch (e2) { }
            }
        }
        migrateLegacy('forge_v1', 'baye_cheat_forge_v1');
        migrateLegacy('deaths_v1', 'baye_cheat_deaths_v1');
        try { localStorage.setItem(SLOT_MARK, cur); } catch (e3) { }
        try { reloadForge(); } catch (e4) { }
        try {
            deaths = JSON.parse(localStorage.getItem(skey('deaths_v1')) || '[]') || [];
        } catch (e5) { deaths = []; }
    }
    /* 存档诊断：引擎的存档就在 localStorage 里（键名 = 存档文件名） */
    function storageSaveKeys() {
        var out = [], i, k, v, list = engineSaveList();
        for (i = 0; i < list.length; i++) {
            out.push('存档 ' + list[i].name + '.sav（' + Math.round(list[i].size / 1024) + 'KB'
                + (list[i].name === currentSaveId() ? '，← 当前' : '') + '）');
        }
        try {
            for (i = 0; i < localStorage.length; i++) {
                k = localStorage.key(i);
                if (!k || k.indexOf('baye_cheat_') === 0 || /sango\d*\.sav$/i.test(k)) continue;
                v = localStorage.getItem(k) || '';
                if (/save|slot|存档|进度/i.test(k) || (v.length > 2000 && /^\s*[{[]/.test(v))) {
                    out.push('其他 ' + k + '(' + Math.round(v.length / 1024) + 'KB)');
                }
            }
        } catch (e) { }
        if (!out.length) out.push('（localStorage 里还没有存档条目：先在游戏里保存一次）');
        return out;
    }

    /* ======================== 2. 配置（持久化） ======================== */
    var CFG_KEY = 'baye_cheat_cfg_v6';      /* v6：禁止战死改造为「战死概率倍率」 */
    var DEFAULT_CFG = {
        /* —— 截图 IMG_6451 的三个开关 —— */
        surrender: 0,        // 招降/招揽必定成功（过强，默认关，面板里自行打开）
        searchGen: 1,        // 搜寻必定成功（招到武将）
        searchTool: 1,       // 搜寻道具必定成功（优先级在武将搜寻之后）

        /* —— 需求 3/4/5 —— */
        deathRate: 0,        // 战死概率倍率：0=禁止战死；1≈原版概率；5/10/50=放大 N 倍（测试武将修复用）
        noDeathRescue: 0,    // 阵亡补救：默认关（开局未登场武将易被误判成阵亡），需要时再开
        kingGuard: 1,        // 君主免疫俘虏（有城可退时改为转移+重伤）
        autoBalance: 1,      // AI 托管战斗加权结算
        engineSettle: 0,     // 托管战斗交还引擎结算（默认关）。开启后战斗横幅不再出现双 VS，
                             // 代价：AI 托管战斗不再记月报/参战名单，也不做君主战场抢救
        noDisaster: 0,       // 城池无灾害：默认关闭，尊重原机制
        waterTactic: 1,      // 水城地形修正：水域战场按兵种水性折算战力（北海/吴/桂阳）
        forge: 1,            // 铁匠铺：装备强化（DNF 式）。强化等级独立记录，不改引擎面板数值
        forgePity: 1,        // 强化保底：连续失败 5 次后，下一次必定成功（防止无限掉级）
        forgeGuarantee: 0,   // 强化必定成功：成功率强制 100%（测试/刷满级用，费用照收）
        forgeMount: 0,
        raceOn: 1,          // 赛马大会（★必须显式给默认值：不在默认表里 flag() 会返回 falsy，功能永不启动）
        aiForge: 1,         // AI 势力强化（同上）       // 允许强化纯坐骑：默认关（纯坐骑只加移动、不加伤害，强化收益为0）
        richMode: 0,          // 【已从面板移除】每月自动加钱（保留内部开关，资源管理菜单的手动加钱不受影响）
        richAmount: 3000,     // 每次加的钱/粮：立即加钱、立即加粮、每月自动都按这个额度
        moneyCap: 0,          // 【已从面板移除】0 = 自动校准；>0 = 手动指定金币上限（控制台可用）
        allTools: 0,          // 获取全部道具：每月把全道具表塞进君主所在城
        levelBoost: 0,        // 武将等级提升：每月给己方武将加经验（全员涨级）
        levelBoostAll: 0,     // 【已从面板移除】读档即满级（保留内部开关）
        noResCap: 1,          // 解除资源上限：每月月初把己方城池金币/粮草补到引擎上限（强化要用大量金币）

        aiEmptyCity: 1,      // AI 攻占空城：原版 AI 永远不打无主城，开启后每月让相邻 AI 势力去占
        warFreq: 0,          // 出征频率（智慧引擎二级微调）：0=保守 1=正常 2=活跃（联动出击门槛 1.35/1.20/1.05）；smartAI=0 时不生效
        smartAI: 1,          // 智慧引擎：0=关 1=标准（会守家/回防/挑软柿子/多线出击）2=强势（更激进，也会趁虚打玩家）

        /* —— 结算权重（autoBalance 生效） —— */
        wGen: 1.0,           // 武将素质（武力/智力/等级）权重
        wArms: 1.0,          // 兵力权重
        wDef: 1.0,           // 城防权重
        spread: 2.5,         // 随机性：越大越看重实力差（1.2≈很随机，3≈很稳定）

        /* —— 调试 —— */
        verbose: 0
    };

    var cfg = readCfg();

    function readCfg() {
        var o = {};
        var k;
        for (k in DEFAULT_CFG) if (DEFAULT_CFG.hasOwnProperty(k)) o[k] = DEFAULT_CFG[k];
        try {
            var raw = localStorage.getItem(CFG_KEY);
            if (raw) {
                var d = JSON.parse(raw);
                for (k in DEFAULT_CFG) {
                    if (d.hasOwnProperty(k) && typeof d[k] === typeof DEFAULT_CFG[k]) o[k] = d[k];
                }
            }
        } catch (e) { }
        return o;
    }

    function saveCfg() {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { }
    }

    function flag(k) { return !!cfg[k]; }

    /* ======================== 3. 数据访问工具 ========================
       人物/城池/道具字段（取自引擎 src/baye/bind-objects.c 的绑定表）：
         Person: OldBelong Belong Level Force IQ Devotion Character Experience Thew
                 ArmsType Arms Equip[0..1] Age
         City  : State Belong SatrapId FarmingLimit Farming CommerceLimit Commerce
                 PeopleDevotion AvoidCalamity PopulationLimit Population Money Food
                 MothballArms PersonQueue Persons ToolQueue Tools
       约定：Person 的 PersID = 数组下标 + 1；Belong==0 在野，Belong==65535 俘虏。 */

    var CAPTIVE = 65535;
    var WILD = 0;

    function personAt(i) {
        var arr = baye.data.g_Persons;
        return (i >= 0 && i < arr.length) ? arr[i] : null;
    }
    function cityAt(i) {
        var arr = baye.data.g_Cities;
        return (i >= 0 && i < arr.length) ? arr[i] : null;
    }
    function personsOfCity(c) {
        var city = cityAt(c), out = [], i;
        if (!city) return out;
        for (i = city.PersonQueue; i < city.PersonQueue + city.Persons; i++) {
            var pid = baye.data.g_PersonsQueue[i];
            if (pid === undefined || pid === null) continue;
            out.push(pid);
        }
        return out;
    }
    function cityOfPerson(idx) {
        var cities = baye.data.g_Cities, i, list, j;
        for (i = 0; i < cities.length; i++) {
            list = personsOfCity(i);
            for (j = 0; j < list.length; j++) if (list[j] === idx) return i;
        }
        return 0xff;
    }
    /* 某势力的城池（Belong == 君主 PersID） */
    function ownCities(kingId) {
        var cities = baye.data.g_Cities, out = [], i;
        for (i = 0; i < cities.length; i++) if (cities[i].Belong === kingId) out.push(i);
        return out;
    }
    /* 城池中的在野武将（排除 150/150 的占位数据，与 mod 判断一致） */
    function wildsOfCity(c) {
        var list = personsOfCity(c), out = [], i;
        for (i = 0; i < list.length; i++) {
            var p = personAt(list[i]);
            if (p && p.Belong === WILD && p.Level > 0 && !(p.Force === 150 && p.IQ === 150)) out.push(list[i]);
        }
        return out;
    }
    /* 安全放置：先从所有在城位置移除，再放进目标城。
       引擎的 AddPerson 默认不去重（checkRedundantOnAddPerson 可开），重复入城会把武将搞丢。 */
    function placePerson(city, idx) {
        clearPlanCache();                          /* 人员位置变了，战略缓存立即失效 */
        var guard = 0;
        while (guard++ < 45) {
            var cur = cityOfPerson(idx);
            if (cur === 0xff || cur === city) break;
            try { if (baye.deletePersonInCity(cur, idx) !== 1) break; } catch (e) { break; }
        }
        try { if (cityOfPerson(idx) !== city) baye.putPersonInCity(city, idx); } catch (e) { }
    }

    function nameOf(idx) { try { return baye.getPersonName(idx); } catch (e) { return ('#' + idx); } }
    function cityName(c) { try { return baye.getCityName(c); } catch (e) { return ('#' + c); } }
    function rand(n) { return Math.floor(Math.random() * n); }

    /* 屏幕尺寸（平衡版2.1 是 208x128，读引擎实际值，别写死） */
    function SW() { try { return baye.data.g_screenWidth || 208; } catch (e) { return 208; } }
    function SH() { try { return baye.data.g_screenHeight || 128; } catch (e) { return 128; } }

    /* ---------- 文本安全：引擎走 GB18030 编码，遇到 emoji / 生僻符号会直接抛
       "The code point 9881 could not be encoded"，整段文本就画不出来 ----------
       所以所有要喂给 baye.* 的字符串先过一遍 gbkSafe。 */
    var _gbk = null;
    try { _gbk = new TextEncoder('GBK', { NONSTANDARD_allowLegacyEncoding: true }); } catch (e) { }

    function gbkSafe(s) {
        if (s === null || s === undefined) return '';
        s = String(s);
        if (!_gbk) return s.replace(/[^\u0000-\u00ff\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g, '');
        try { _gbk.encode(s); return s; } catch (e) { }
        var out = '';
        for (var i = 0; i < s.length; i++) {
            try { _gbk.encode(s[i]); out += s[i]; } catch (e) { /* 丢掉编码不了的字符 */ }
        }
        return out;
    }
    function safeItems(arr) {
        var out = [], i;
        for (i = 0; i < arr.length; i++) out.push(gbkSafe(arr[i]));
        return out;
    }

    /* ---------- 输出包装：统一在这里做编码过滤，业务代码不用关心 ---------- */
    /* iOS Safari 上引擎自己的弹窗实现偶尔会抛
       「baye._cbs.pop() is not a function」（引擎内部 UI 回调栈异常），
       抛错后弹窗卡死、还弹原生错误框。这里做重试 + 自绘兜底，
       保证「提示」这件事不会把游戏卡住。 */
    var ALERT_RETRY = 0;
    /* ---------- UI 队列：所有弹窗串行，绝不重叠 ----------
       引擎的 baye.alert / centerChoose 内部共用一个回调栈 baye._cbs，
       两个弹窗同时在飞（或在 setTimeout 里弹）会互相踩，
       报「baye._cbs.pop() is not a function」——这是会破坏游戏状态的严重错误。
       统一走这个队列：前一个弹窗关掉后才弹下一个。 */
    var UI_Q = [], UI_Q_BUSY = 0;
    function uiQueue(fn) {
        if (typeof fn !== 'function') return;
        UI_Q.push(fn);
        uiQueuePump();
    }
    function uiQueuePump() {
        if (UI_Q_BUSY) return;
        var fn = UI_Q.shift();
        if (!fn) return;
        UI_Q_BUSY = 1;
        var done = false;
        function next() {
            if (done) return;
            done = true;
            UI_Q_BUSY = 0;
            uiQueuePump();
        }
        try { fn(next); } catch (e) { log('UI 队列异常', e); next(); }
    }

    function alert2(msg) {
        var text = gbkSafe(msg);
        if (ALERT_RETRY > 3) { log('alert 多次失败，改用控制台输出：', text); return; }
        try {
            ALERT_RETRY++;
            baye.alert(text);
            ALERT_RETRY = 0;
        } catch (e) {
            log('alert 失败（第 ' + ALERT_RETRY + ' 次）：', e);
            setTimeout(function () { alert2(text); }, 150);
        }
    }
    function say2(pid, msg) { try { baye.say(pid, gbkSafe(msg)); } catch (e) { } }
    /* 菜单列表项上限：每行最多 30 个半角（15 个汉字）。
       超宽项先在本脚本里折行 —— 引擎对超宽行会自动换行，把列表排版搅乱。 */
    var MENU_MAX_HALF = 30;

    function fitMenuLines(items) {
        var out = [], map = [];
        for (var i = 0; i < items.length; i++) {
            var w = 0, cur = '';
            var s = gbkSafe(items[i] == null ? '' : String(items[i]));
            for (var j = 0; j < s.length; j++) {
                var cw = s.charCodeAt(j) > 255 ? 2 : 1;
                if (w + cw > MENU_MAX_HALF) { out.push(cur); map.push(i); cur = ''; w = 0; }
                cur += s[j]; w += cw;
            }
            out.push(cur);
            map.push(i);          /* 每条折行都记住它属于哪个原始条目 */
        }
        return { lines: out, map: map };
    }

    /* 全屏列表（居中）：宽高用引擎实际分辨率推导，别再用 225x135 这种超屏值。
       回调索引映射回原始条目：长行折行后列表会变长，若不映射，
       点「花钱强化？」「再强化一次？」这类按索引判断的按钮就会错位失效。 */
    function menu(items, init, cb) {
        /* 无回调也要能开菜单（查看月报/排行/图鉴/版本等都是纯展示）——
           少了这一层守卫，v1.11.1 的索引映射包装会在取消时抛
           「cb is not a function」并把引擎菜单状态机卡死。 */
        if (typeof cb !== 'function') cb = function () { };
        var fit = fitMenuLines(items);
        baye.centerChoose(SW() - 8, SH() - 8, fit.lines, init || 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) { cb(ind); return; }
            cb(fit.map[ind] === undefined ? ind : fit.map[ind]);
        });
    }
    /* 左侧详情 + 右侧城池列表（列表 30px 宽，贴右缘） */
    function listView(x, y, w, h, items, init, cb) {
        baye.choose(x, y, w, h, safeItems(items), init || 0, cb);
    }
    function drawText2(x, y, text) { try { baye.drawText(x, y, gbkSafe(text)); } catch (e) { } }
    /* 按显示宽度折行（半角 1 / 全角 2；引擎 drawText 不自动换行） */
    function wrapLines(s, maxHalf) {
        s = gbkSafe(s);
        var out = [], cur = '', w = 0, i, cw;
        for (i = 0; i < s.length; i++) {
            cw = s.charCodeAt(i) > 255 ? 2 : 1;
            if (w + cw > maxHalf) { out.push(cur); cur = s[i]; w = cw; }
            else { cur += s[i]; w += cw; }
        }
        if (cur) out.push(cur);
        return out.length ? out : [''];
    }
    function pad(s, n) {
        if (s === undefined || s === null) s = '';
        else if (typeof s !== 'string') s = String(s);   /* 数字/对象都先转字符串，别炸 .slice */
        var l = 0, i, c = 0;
        for (i = 0; i < s.length; i++) {
            var w = s.charCodeAt(i) > 255 ? 2 : 1;
            if (l + w <= n) { l += w; c = i + 1; } else break;
        }
        var r = s.slice(0, c);
        while (l < n) { r += ' '; l += 1; }
        return r;
    }

    /* 名单打包：按显示宽度（半角=1）把多个名字塞进一行，超出自动换行。
       引擎对菜单是逐行渲染的，君主多时「一人一行」会卡到没反应。 */
    function packNames(arr, maxHalf) {
        var out = [], cur = '', w = 0, i, s, cw;
        for (i = 0; i < arr.length; i++) {
            s = String(arr[i]);
            var need = 0, j;
            for (j = 0; j < s.length; j++) need += (s.charCodeAt(j) > 255 ? 2 : 1);
            if (cur && w + need + 2 > maxHalf) { out.push(cur); cur = ''; w = 0; }
            if (!cur) { cur = s; w = need; continue; }
            cur += '、' + s; w += need + 2;
        }
        if (cur) out.push(cur);
        return out;
    }

    /* ======================== 4. 钩子挂载框架 ======================== */
    var wrappedHooks = {};   /* name -> 原钩子（undefined 表示原本没有） */

    function wrapHook(name, fn) {
        var old = baye.hooks[name];                 /* 备份，避免覆盖 lib 逻辑 */
        wrappedHooks[name] = old;
        var wrapped = function (ctx) {
            var rv;
            try { rv = fn.call(this, ctx); } catch (e) { log('钩子 ' + name + ' 异常：', e); rv = undefined; }
            if (rv !== undefined) return rv;         /* 本脚本给出结论 */
            return old ? old.apply(this, arguments) : -1;
        };
        wrapped.__bayeCheatWrap = 1;
        baye.hooks[name] = wrapped;
    }

    function uninstall() {
        Object.keys(wrappedHooks).forEach(function (n) {
            if (wrappedHooks[n]) baye.hooks[n] = wrappedHooks[n]; else delete baye.hooks[n];
        });
        var el = document.getElementById('bayeCheatDock');
        if (el) el.remove();
        log('已卸载，钩子全部还原');
    }

    /* ======================== 5. 钩子实现 ======================== */
    function setupHooks() {
        wrapHook('willExecuteOrder', onWillExecuteOrder);
        wrapHook('tacticStage1', onTacticStage1);
        wrapHook('tacticStage2', onTacticStage2);
        wrapHook('tacticStage5', onTacticStage5);
        wrapHook('exitBattle', onExitBattle);
        wrapHook('enterBattle', onEnterBattle);
        wrapHook('fightCountWinner', onFightCountWinner);
        /* 伤害钩子：balance2.1 的 lib 已注册（算完写在 context.hurt），
           这里包装后在其之后乘强化系数，不改动它自己的公式 */
        /* 原版钩子由 wrapHook 备份进 wrappedHooks，这里闭包直传，
           保证「先原版、后强化」的调用顺序（详见 onCountHurt 注释） */
        /* 角色装备栏（人物属性表的「道具壹/道具贰」）显示强化等级 */
        wrapHook('getPersonPropertyValue', function (ctx) {
            return onPersonPropertyValue(ctx, wrappedHooks.getPersonPropertyValue);
        });
        wrapHook('countAttackHurt', function (ctx) {
            return onCountHurt(ctx, wrappedHooks.countAttackHurt);
        });
        wrapHook('countSkillHurt', function (ctx) {
            return onCountHurt(ctx, wrappedHooks.countSkillHurt);
        });
        wrapHook('showMainHelp', onShowMainHelp);
        wrapHook('didOpenNewGame', onDidOpenNewGame);
        wrapHook('didLoadGame', onDidLoadGame);
    }

    /* ---------- 5.1 需求3：禁止武将战死 ----------
       引擎 src/citycmdd.c TheLoserDeal()：
           rnd = gam_rand()%100;
           ... 逃跑失败时：
               if (rnd || g_engineConfig.disableFightToDeath) { HoldCaptive(); continue; }
               else { 装备掉落 + 提示「阵亡」 }   ← 战死分支
       即 disableFightToDeath=1 时，原本会战死的武将一律改判为「被俘」，不再永久消失。
       注意：engineConfig 由 lib 脚本在启动时写一次，这里每个策略阶段都重申，防止被覆盖。 */
    function applyEngineSwitches() {
        try {
            var ec = baye.data.g_engineConfig;
            if (!ec) return;
            /* deathRate=0 → 禁止战死；deathRate>0 → 也打开引擎开关（防止引擎真死），
               改由脚本按倍率在月末抽取「战死」，这样才能测试武将修复 */
            ec.disableFightToDeath = (Number(cfg.deathRate) > 0 || flag('noDeathRescue')) ? 1 : 0;
            ec.checkRedundantOnAddPerson = 1;                    /* 防止重复入城把武将搞丢 */
        } catch (e) { }
    }

    /* ---------- 5.8 月报补两类事件：投奔 + 灾害（对齐霸哥自制版） ----------
       霸哥版月报里有这两类 ours 缺失：
         [董卓] 伍习 投奔 公孙瓒   —— 武将换势力（引擎自己发生的野将投奔）
         建宁 发生 水灾                      —— 城池灾害
       都不需要引擎事件回调：每月月初拿上月的 SNAP（归属）做差分即可。 */
    /* 轻量归属快照：只记 Belong，与noDeath 开关无关（投奔差分靠它） */
    var BELONG_SNAP = null;
    function snapshotBelong() {
        var persons = baye.data.g_Persons, m = {}, i;
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (p && p.Level && p.Level > 0) m[i] = p.Belong;
        }
        BELONG_SNAP = m;
    }
    var DISASTER_SNAP = null;
    var DISASTER_NAME = { 1: '水灾', 2: '旱灾' };
    function disasterName(v) { return DISASTER_NAME[v] || ('灾害(' + v + ')'); }
    function reportDefectionsAndDisasters() {
        var out = [], persons = baye.data.g_Persons, cities = baye.data.g_Cities, i, c, p, s, nb, ob;
        /* ① 投奔：上月归属 A、本月变成 B（排除俘虏/在野/君主本人） */
        if (BELONG_SNAP) {
            for (i = 0; i < persons.length; i++) {
                p = persons[i];
                if (!p || !p.Level || p.Level <= 0) continue;
                ob = BELONG_SNAP[i];
                if (ob === undefined) continue;
                nb = p.Belong;
                if (nb === ob) continue;
                if (nb === CAPTIVE || nb === WILD || nb <= 0) continue;
                if (ob === CAPTIVE || ob === WILD || ob <= 0) continue;
                if (i + 1 === nb || i + 1 === ob) continue;
                /* 区分「城破吞并」与「主动投奔」：
                   旧主势力已灭（名下无城）或这座城已易主 → 武将是被动的，不算投奔。*/
                if (ownCities(ob).length === 0) continue;   /* 旧主已灭 → 吞并，不算投奔 */
                var here = cityOfPerson(i);
                out.push('【投奔】' + safeName(ob) + '军 ' + nameOf(i) + ' 投奔 ' + safeName(nb)
                    + (here !== 0xff ? '（' + cityName(here) + '）' : ''));
            }
        }
        /* ② 灾害：city.State 上月为 0、本月非 0 → 本月发生灾害 */
        if (DISASTER_SNAP) {
            for (c = 0; c < cities.length; c++) {
                var cd = cities[c];
                if (!cd) continue;
                var st = Number(cd.State) || 0;
                if (st !== 0 && (DISASTER_SNAP[c] || 0) === 0) {
                    log('灾害：' + cityName(c) + ' 发生 ' + disasterName(st));
                }
            }
        }
        DISASTER_SNAP = {};
        for (c = 0; c < cities.length; c++) if (cities[c]) DISASTER_SNAP[c] = Number(cities[c].State) || 0;
        if (out.length) pushReport(out);
        return out;
    }

    /* ---------- 5.2 需求3 补强：战死者按快照找回 ----------
       快照在每月月初（tacticStage1）采集：每个武将的势力/等级/兵力/体力/装备/所在城。
       下月月初比对，若某人「不在任何城池」→ 判定为永久消失（战死/被清除），
       把他放回原城池（原城已丢则放任意己方城池），兵力按 30% 结算并扣体力 = 重伤。 */
    var SNAP = {};        /* idx -> {belong, level, arms, thew, city, equip:[a,b]} */

    function snapshot() {
        SNAP = {};
        var persons = baye.data.g_Persons, cities = baye.data.g_Cities, i, c;
        /* 先建立 人 -> 城 的反查表 */
        var where = {};
        for (c = 0; c < cities.length; c++) {
            var list = personsOfCity(c);
            for (i = 0; i < list.length; i++) where[list[i]] = c;
        }
        /* 只快照「此刻在城里」的武将。
           不在城的包括：未登场（孙策/孙权这类未成年或未到年份的，赵云其实在城），
           把他们拍进去会在下月被误判成「阵亡」而塞回城里，等于强行提前登场 —— 大忌。 */
        for (i = 0; i < persons.length; i++) {
            if (where[i] === undefined) continue;
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0) continue;
            SNAP[i] = {
                belong: p.Belong, level: p.Level, arms: p.Arms, thew: p.Thew,
                city: where[i], equip: [p.Equip[0], p.Equip[1]]
            };
        }
    }

    function rescueLostGenerals(silent) {
        var persons = baye.data.g_Persons, cities = baye.data.g_Cities, i, c;
        var where = {};
        for (c = 0; c < cities.length; c++) {
            var list = personsOfCity(c);
            for (i = 0; i < list.length; i++) where[list[i]] = c;
        }
        var rescued = [];
        for (i in SNAP) {
            if (!SNAP.hasOwnProperty(i)) continue;
            i = i | 0;
            if (where[i] !== undefined) continue;               /* 还在，正常 */
            var p = persons[i];
            if (!p) continue;
            var s = SNAP[i];
            if (s.city === undefined) continue;                      /* 快照时就不在城，不归我们管 */
            if (s.belong === WILD || s.belong === CAPTIVE) continue;  /* 在野/被俘不算消失 */
            if (p.Belong === CAPTIVE) continue;                  /* 被俘由引擎管，别抢 */
            /* 选一个落点：原城 → 同势力任一城 */
            var to = (s.city !== undefined && s.city !== 0xff && cities[s.city] &&
                cities[s.city].Belong === s.belong) ? s.city : -1;
            if (to < 0) {
                var oc = ownCities(s.belong);
                to = oc.length ? oc[rand(oc.length)] : -1;
            }
            if (to < 0) continue;                                /* 势力已无城，确实灭亡了，不救 */
            placePerson(to, i);
            p.Belong = s.belong;
            p.Arms = Math.max(1, Math.floor((s.arms || 0) * 0.3));
            p.Thew = Math.max(10, (s.thew || 100) - 40);
            rescued.push(nameOf(i));
        }
        if (rescued.length && !silent) {
            alert2('【重伤撤退】以下武将本已阵亡，已按金手指规则找回：' + rescued.join('、'));
        }
        return rescued;
    }

    /* ---------- 5.3 需求4：君主免疫俘虏 ----------
       引擎 src/citycmdd.c 的两条捕获路径：
         · BattleDrv → FightResultDeal → TheLoserDeal()：败方武将 gam_rand()%100 > 智力 即被俘
         · FightResultDeal → BeOccupied()：城池沦陷时，城里 Belong==自身ID 的君主被俘(Belong=0xffff)
       随后 KingOverDeal() 触发「另立新君」，把原势力所有城池与武将改挂到继承人名下
       → 于是出现「袁绍被曹操俘后成了曹操的武将，田丰继位又俘袁绍」这种主仆倒置。

       本脚本的取舍（比一刀切禁止被俘更合理）：
         仅当「该君主所在势力还有其他城池可退」时，在 exitBattle 内把他从战场队列/守城中
         摘出来、转移到本方另一座城，并施加重伤惩罚（兵力减半、体力 -30）。
         · 势力只剩最后一座城时不再干预 → 灭国、被俘、易主照常发生，保留败局代价；
         · exitBattle 在 FightResultDeal 之前调用（Fight.c → GamFight），
           因此这里转移走的人，引擎的 TheLoserDeal/BeOccupied 根本看不到他。 */
    var FGT_COMON = 0, FGT_WON = 1, FGT_LOSE = 2, FGT_AUTO = 2;
    var appliedOnce = false;

    /* 桥接数组（BayeObject）没有 indexOf，只能手写查找；返回 0~19 的战场槽位，找不到 -1 */
    function genArraySlot(pid) {
        var arr = baye.data.g_FgtParam.GenArray, i;
        for (i = 0; i < 20; i++) if (arr[i] === pid) return i;
        return -1;
    }

    /* 战场预防：在战斗结果确定之后、FightResultDeal（战死/俘虏/沦陷结算）之前，
       把「该被清算的君主」摘出战场 —— 引擎的 TheLoserDeal 只遍历战场队列、
       BeOccupied 只遍历城内在册人员，摘走就抓不到。
       调用点有两个（这是 v1.5 的关键修复）：
         · exitBattle —— 玩家参与的战斗（FGT_AT / FGT_DF）走战斗主循环；
         · onFightCountWinner —— AI 托管战斗（FGT_AUTO）不经过主循环，
           exitBattle 根本不触发，之前就是因为漏了这条，AI 君主照样被俘。 */
    function guardBattleField(verbose) {
        if (!flag('kingGuard')) return [];
        var fp = baye.data.g_FgtParam;
        var over = baye.data.g_FgtOver;
        if (!fp || over === FGT_COMON) return [];
        var city = fp.CityIndex;
        var rescued = [];
        var i, seen = {};

        function tryRescue(idx0, fromCity, slot) {
            if (idx0 === undefined || idx0 === null || seen[idx0]) return;
            seen[idx0] = 1;
            var p = personAt(idx0);
            if (!p || !p.Level || p.Level <= 0) return;
            if (p.Belong === CAPTIVE || p.Belong === WILD) return;
            if (p.Belong !== idx0 + 1) return;            /* 不是君主（君主 Belong 指向自己） */
            var list = ownCities(p.Belong);
            var dest = -1, k;
            for (k = 0; k < list.length; k++) if (list[k] !== fromCity) { dest = list[k]; break; }
            if (dest < 0) return;                          /* 无城可退 → 保持原样，允许被俘 */
            /* 关键：把参战槽位清零。引擎的 TheLoserDeal 只遍历战场队列、不看人当前在哪座城，
               不摘出槽位的话，人虽然被搬走了照样会被 HoldCaptive 抓走 */
            if (slot !== undefined) { try { fp.GenArray[slot] = 0; } catch (e) { } }
            /* 只从「战败城」移出（这一步必须即时，否则城破时 BeOccupied 会抓到他），
               投进自己城池的动作推迟到月末 —— 见PENDING_PLACE 注释 */
            var from = cityOfPerson(idx0);
            if (from !== 0xff && from !== dest) { try { baye.deletePersonInCity(from, idx0); } catch (e) { } }
            queuePlace(idx0, dest);
            p.Belong = idx0 + 1;                           /* 仍是自家君主 */
            p.Arms = Math.max(1, Math.floor(p.Arms / 2));  /* 退兵损失 */
            p.Thew = Math.max(10, p.Thew - 30);            /* 重伤 */
            rescued.push(nameOf(idx0) + '→' + cityName(dest));
        }

        /* FGT_WON 时被清算的是守方 10~19，FGT_LOSE 时是攻方 0~9 */
        var start = (over === FGT_WON) ? 10 : 0;
        for (i = start; i < start + 10; i++) {
            var pid = fp.GenArray[i];
            if (pid) tryRescue(pid - 1, city, i);
        }
        /* 城池沦陷（我方攻城成功）时，守城君主也会被 BeOccupied 抓走；
           BeOccupied 遍历的是城内在册人员，所以把人搬出城就能躲开。
           注意 g_FgtParam.GenArray 是桥接数组（BayeObject），没有 indexOf！ */
        if (over === FGT_WON) {
            var inCity = personsOfCity(city);
            for (i = 0; i < inCity.length; i++) {
                tryRescue(inCity[i], city, genArraySlot(inCity[i] + 1));
            }
        }
        reportRescued(rescued, verbose);
        return rescued;
    }

    /* 君主抢救的「归位」延后到月末做（v1.11.4，双 VS 偶发的头号嫌疑）：
       战斗结算画面期间只做三件「不碰城池名册」的事 ——
         ① 把参战槽位清零（必须即时：TheLoserDeal/BeOccupied 只看战场队列与城内在册，
            不清零的话君主照样被 HoldCaptive 抓走，「免疫俘虏」就失效了）；
         ② 改回自有归属（纯字段写��，不涉及队列）；
         ③ 退兵损失（兵力折半 + 重伤）。
       「从战败城删人 + 投进另一座城」这种名册增删一律推迟到月末 tacticStage5 统一做，
       期间君主处于「不在任何城名册」的��军态 —— 这正是引擎表示行军部队的方式，
       不会让势力判定为灭亡。这样战斗动画期间不再有城内在册变动，
       偶发的「横幅画两遍（双 VS）」触发条件被去掉。 */
    var PENDING_PLACE = {};      /* pid -> { city: 目标城号, name: 姓名 } */
    function queuePlace(pid, city) {
        if (PENDING_PLACE[pid]) return;
        PENDING_PLACE[pid] = { city: city, name: nameOf(pid) };
    }
    function isPendingPlace(pid) { return !!PENDING_PLACE[pid]; }
    function flushPendingPlace(verbose) {
        var notes = [], k, pid, d, p, oc, city, from;
        for (k in PENDING_PLACE) {
            if (!PENDING_PLACE.hasOwnProperty(k)) continue;
            pid = Number(k);
            d = PENDING_PLACE[pid];
            p = personAt(pid);
            if (!p) { delete PENDING_PLACE[k]; continue; }
            oc = ownCities(p.Belong);
            /* 目标城若已易主，改投当前自己的第一座城 */
            city = (d && oc.indexOf(d.city) >= 0) ? d.city : (oc.length ? oc[0] : -1);
            if (city < 0) {
                notes.push(d.name + ' 无城可归（本月仍在行军态）');
                delete PENDING_PLACE[k];
                continue;
            }
            from = cityOfPerson(pid);
            if (from !== 0xff && from !== city) { try { baye.deletePersonInCity(from, pid); } catch (e) { } }
            placePerson(city, pid);
            notes.push('【退兵】' + d.name + ' 归位 ' + cityName(city));
            delete PENDING_PLACE[k];
        }
        if (notes.length) {
            pushReport(notes.join('、'));
            if (verbose) alert2('【君主归位】' + notes.join('、'));
        }
        return notes;
    }

    function reportRescued(rescued, verbose) {
        /* 同一君主同月只记一次（AI 内战频繁，不然月报全是重复的退兵记录） */
        var dedup = [], seenK = {}, k;
        for (k = 0; k < rescued.length; k++) {
            var parts = rescued[k].split('→');
            var key = monthKey() + (parts[0] || '');
            if (seenK[key]) continue;
            seenK[key] = 1;
            dedup.push(rescued[k]);
            /* 月报写明白：这是君主被俘后的「退兵转移」，不是战斗 */
            pushReport('【退兵】' + (parts[0] || '?') + ' 被俘，转移回 ' + (parts[1] || '?'));
        }
        if (dedup.length && verbose) {
            alert2('【君主退兵】为避免主仆倒置，以下君主已转移：' + dedup.join('、'));
        }
        return dedup;
    }

    /* 事后回滚：被俘的旧君主（OldBelong 指向自己是「曾经称王」的铁证）。
       放在 tacticStage5 是因为引擎的 KingOverDeal 会把势力改挂给继承人，
       而 lib 的 tacticStage5 又会把俘虏转成敌方武将 —— 必须在它之前把君主放回去。 */
    function rollbackCapturedKings(verbose) {
        if (!flag('kingGuard')) return [];
        var rescued = [];
        var persons = baye.data.g_Persons;
        var i;
        for (i = 0; i < persons.length; i++) {
            var q = persons[i];
            if (!q || q.Belong !== CAPTIVE || q.OldBelong !== i + 1) continue;
            var ll = ownCities(i + 1);
            if (!ll.length) continue;                      /* 势力已灭，保留被俘/灭亡结果 */
            var to = cityOfPerson(i);
            try { if (to !== 0xff) baye.deletePersonInCity(to, i); } catch (e) { }
            placePerson(ll[0], i);
            q.Belong = i + 1;
            q.Arms = Math.max(1, Math.floor(q.Arms / 2));
            q.Thew = Math.max(10, q.Thew - 30);
            rescued.push(nameOf(i) + '→' + cityName(ll[0]) + '(回滚被俘)');
        }
        reportRescued(rescued, verbose);
        return rescued;
    }

    /* 兼容旧调用：战场预防 + 事后回滚一起做 */
    function kingGuardPass(verbose) {
        var a = guardBattleField(verbose);
        var b = rollbackCapturedKings(verbose);
        return a.concat(b);
    }

    /* ---------- 5.7 城池名册一致性自愈（v1.11.2） ----------
       现象：君主同时出现在两座城（截图里徐州君主陶谦却出现在马腾的汉中）。
       成因：君主被俘→转移、被俘→回滚、跨城回防、俘虏转武将这几条路径，
       只要有一步没把旧城的名册条目删干净，引擎的城池名册
      （g_PersonsQueue 的切片 PersonQueue/Persons）就会留下幽灵条目；
       而引擎自己不做一致性检查，于是「某城武将列表里冒出别势力的君主」。
       每月月初扫一遍：Belong 与所在城不一致就纠正，同一人出现在多城只留一处。 */
    function repairCityRoster(verbose) {
        var cities = baye.data.g_Cities, i, j, fixed = [];
        var where = {};        /* pid -> [城号, 城号…] */
        var p, pid, list, b;
        /* 第一遍：只统计每个人出现在哪几座城的名册里，不做任何改动 */
        for (i = 0; i < cities.length; i++) {
            if (!cities[i]) continue;
            list = personsOfCity(i);
            for (j = 0; j < list.length; j++) {
                pid = list[j];
                p = personAt(pid);
                if (p && !p.Level) continue;
                if (!where[pid]) where[pid] = [];
                where[pid].push(i);
            }
        }
        /* 第二遍：按「归属」决定去留 —— 保留城池归属与其 Belong 一致的那座，
           其余从名册移除；君主（Belong 指向自己）另作归位处理。 */
        for (pid in where) {
            if (!where.hasOwnProperty(pid)) continue;
            pid = Number(pid);
            p = personAt(pid);
            list = where[pid];
            if (!p) {                                   /* 空数据：全部清掉 */
                for (j = 0; j < list.length; j++) { try { baye.deletePersonInCity(list[j], pid); } catch (e) { } }
                fixed.push('#' + pid + ' 空数据已清理');
                continue;
            }
            b = p.Belong;
            var keeper = -1, k;
            /* 君主（Belong 指向自己）：他必须待在自己势力的城里，不在就是错列 */
            var isKing = (pid + 1 === b);
            if (isKing) {
                for (k = 0; k < list.length; k++) {
                    if (cities[list[k]] && cities[list[k]].Belong === b) { keeper = list[k]; break; }
                }
                if (keeper < 0) keeper = -1;                /* 君主：没有自己势力的城 → 后面专门处理 */
            } else if (b !== WILD && b !== CAPTIVE && b !== undefined && b > 0) {
                for (k = 0; k < list.length; k++) {
                    if (cities[list[k]] && cities[list[k]].Belong === b) { keeper = list[k]; break; }
                }
            } else if (list.length) {
                keeper = list[0];                        /* 在野/俘虏：保留首个 */
            }
            /* 君主不在自己势力的任何城里 → 归位（若势力已灭就保留原状，绝不移出） */
            if (isKing && keeper < 0) {
                var oc0 = ownCities(b);
                if (oc0.length) {
                    for (k = 0; k < list.length; k++) {
                        try { baye.deletePersonInCity(list[k], pid); } catch (e0) { }
                    }
                    placePerson(oc0[0], pid);
                    fixed.push(nameOf(pid) + ' 君主归位（' + cityName(list[0]) + '→' + cityName(oc0[0]) + '）');
                } else {
                    /* 势力已灭：绝不移出城名册 —— 人一旦从所有名册消失就再也找不回来 */
                    log(nameOf(pid) + ' 君主已无城可归，保留在' + cityName(list[0]));
                }
                continue;
            }
            if (keeper < 0) keeper = list[0];
            /* 重复在册：只保留「自己势力的城」那一条。
               注意 —— 只处理君主。普通武将出现在敌方城池是**合法状态**（出征/驻防/被俘），
               强行删除会让人从名册消失（v1.13.4 前的 bug：把张济从晋阳删掉）。*/
            if (isKing) {
                for (k = 0; k < list.length; k++) {
                    if (list[k] === keeper) continue;
                    try { baye.deletePersonInCity(list[k], pid); } catch (e2) { }
                    fixed.push(nameOf(pid) + ' 君主重复在册已清理（留' + cityName(keeper) + '）');
                }
                continue;
            }
            /* 普通武将：只观察不动手。引擎允许他驻扎在任意城（含敌方城池），
               只有引擎自己结算后才会归位。我们擅自删= 让人消失。 */
            if (list.length > 1) {
                log(nameOf(pid) + ' 在' + list.map(cityName).join('/') + ' 多处（归属'
                    + safeName(b) + '）· 引擎自行结算，��脚本不动');
                continue;
            }
            /* 单一在册：君主不在自己势力的城里 → 归位（势力已灭则保留原状） */
            if (b === WILD || b === CAPTIVE || b === undefined || b <= 0) continue;
            if (cities[keeper] && cities[keeper].Belong === b) continue;
            if (pid + 1 === b) {
                var oc = ownCities(b);
                if (oc.length) {
                    try { baye.deletePersonInCity(keeper, pid); } catch (e3) { }
                    placePerson(oc[0], pid);
                    fixed.push(nameOf(pid) + ' 君主归位（' + cityName(keeper) + '→' + cityName(oc[0]) + '）');
                } else {
                    /* 势力已灭的君主：绝不能移出城名册 —— 人一旦从所有城池名册里消失，
                       就再也找不回来了（引擎只在名册里存武将）。宁可让他留在城里被俘/当在野。*/
                    log(nameOf(pid) + ' 君主已无城可归，保留在' + cityName(keeper));
                }
                continue;
            }
            /* 普通武将单独出现在一座不属于自己的城里：可能是出征/驻防/刚被俘，
               引擎自己会结算。我们**不动**（v1.13.4 前会删掉，导致武将人间蒸发）。*/
            log(nameOf(pid) + ' 在' + cityName(keeper) + '（归属' + safeName(b) + '）· 引擎自行结算');
        }
        if (fixed.length) {
            pushReport('【名册】' + fixed.slice(0, 3).join('；') + (fixed.length > 3 ? ' 等' + fixed.length + '处' : ''));
            if (verbose) alert2('【名册修复】\n' + fixed.join('\n'));
        }
        return fixed;
    }

    /* ---------- 5.4 需求5：AI 托管战斗加权结算 ----------
       引擎 src/FgtCount.c FgtCountWon()（电脑打电脑专用）只看两项：
           总兵力 FgtAllArms()（U16 求和，还会溢出）与粮草，
           完全无视武将素质与城防 → 出现「一名守将挡住七八名进攻武将」。
       引擎在 FgtInit() 里给脚本留了口子：
           IF_HAS_HOOK("fightCountWinner") { if (CALL_HOOK_A()==0 && g_FgtOver!=0) return; }
           FgtCountWon();
       即：return 0 且自己写好 g_FgtOver 就完全接管（1=攻方胜，2=守方胜）。 */

    /* ---------- 5.4b 战场水域缓存 ----------
       北海、吴、桂阳共用 5 号水域战场（dat.xml 城池的「战斗地图」字段），大部分格子是河流
       （TERRAIN_RIVER=7），没有水兵寸步难行。战场地形在引擎里是 g_FightMapData
       （尺寸 g_MapWid×g_MapHgt，值 0~7），只在真实战斗（玩家参与）时由 FgtIntMap 加载 ——
       AI 托管结算（FGT_AUTO）不加载。所以：真实战斗的 enterBattle 时统计水域占比并持久缓存
       （按「战斗地图号」记，同图的城共享），托管结算查缓存；没打过的图按 0 处理。 */
    var TERRAIN_RIVER = 7;
    var WATER_CACHE_KEY = 'baye_cheat_water_v2';
    /* 城池 → 战场地图号（提取自平衡版2.1 dat.xml，38 城共用 7 张图） */
    var CITY_BATTLE_MAP = [6, 0, 1, 6, 3, 4, 2, 5, 6, 3, 1, 0, 2, 3, 4, 0, 2, 1, 4, 6, 1, 1, 3, 5, 6, 6, 3, 3, 4, 2, 6, 6, 1, 2, 3, 4, 5, 1];
    /* 兵种水性：0骑兵 1步兵 2弓兵 3水兵 4极兵 5玄兵 —— 1 = 完全不受水影响 */
    var WATER_SKILL = { 0: 0.4, 1: 0.7, 2: 0.75, 3: 1.0, 4: 0.6, 5: 0.6 };

    var waterCache = (function () {
        try { return JSON.parse(localStorage.getItem(WATER_CACHE_KEY)) || {}; } catch (e) { return {}; }
    })();

    function battleMapOf(cityIdx) {
        return CITY_BATTLE_MAP[cityIdx] !== undefined ? CITY_BATTLE_MAP[cityIdx] : 0;
    }

    function waterRatioOf(cityIdx) {
        var r = waterCache[battleMapOf(cityIdx)];
        return (typeof r === 'number') ? r : 0;
    }

    function scanWaterRatio() {
        try {
            var w = baye.data.g_MapWid, h = baye.data.g_MapHgt, map = baye.data.g_FightMapData;
            if (!w || !h || !map || !map.length) return;
            var total = w * h, river = 0, i;
            for (i = 0; i < total && i < map.length; i++) {
                if (map[i] === TERRAIN_RIVER) river++;
            }
            var key = battleMapOf(baye.data.g_FgtParam.CityIndex);
            var ratio = river / total;
            var changed = waterCache[key] !== ratio;
            waterCache[key] = ratio;
            if (changed) {
                try { localStorage.setItem(WATER_CACHE_KEY, JSON.stringify(waterCache)); } catch (e) { }
                if (cfg.verbose) {
                    log('战场水域：' + cityName(baye.data.g_FgtParam.CityIndex) + '（图' + key + '）'
                        + w + 'x' + h + ' 河流格 ' + river + '/' + total + ' = ' + (ratio * 100).toFixed(1) + '%');
                }
            }
        } catch (e) { log('水域统计异常', e); }
    }

    /* 兵种在当前战场的水性系数：水兵 1.0 完全不受影响，骑兵 0.4 最惨 */
    function terrainFactor(armsType) {
        if (!flag('waterTactic')) return 1;
        var r = waterRatioOf(baye.data.g_FgtParam.CityIndex);
        if (r <= 0) return 1;
        var sk = WATER_SKILL[armsType];
        if (sk === undefined) sk = 0.7;
        return 1 - r * (1 - sk);
    }

    /* 权重与随机性的边界保护：负数/NaN 会让战力归零或胜率反转 */
    function safeSpread() {
        var v = Number(cfg.spread);
        if (!isFinite(v) || v < 0.2) return 2.5;
        return Math.min(10, v);
    }
    function safeWeight(k, def) {
        var v = Number(cfg[k]);
        if (!isFinite(v) || v < 0) return def;
        /* 关键金额项下限保护：iOS Safari 上输入框偶尔被表单恢复成 1，
           若不兜底，一夜暴富就变成「加 1 金」。 */
        if (k === 'richAmount' && v > 0 && v < 100) return def;
        return v;
    }

    function genPower(pid) {                 /* pid: 1-based PersonID */
        var p = personAt(pid - 1);
        if (!p) return 0;
        var arms = (p.Arms || 0);
        var thew = (p.Thew === undefined ? 100 : p.Thew);
        /* 与引擎 CountBaseAttr 同源的素质系数：(0.8*武力+0.3*智力+等级)/100 */
        var k = (0.8 * (p.Force || 0) + 0.3 * (p.IQ || 0) + (p.Level || 0)) / 100;
        var eq = 0;
        try {
            var t1 = p.Equip[0], t2 = p.Equip[1], tools = baye.data.g_Tools;
            if (t1 && tools[t1 - 1]) eq += (tools[t1 - 1].at || 0) + (tools[t1 - 1].iq || 0);
            if (t2 && tools[t2 - 1]) eq += (tools[t2 - 1].at || 0) + (tools[t2 - 1].iq || 0);
        } catch (e) { }
        k += eq / 200;
        var base = arms * (safeWeight('wArms', 1) + safeWeight('wGen', 1) * k) * (thew / 100);
        base *= terrainFactor(p.ArmsType);              /* 战场地形（水域）修正 */
        base *= personForgeMul(pid - 1);                 /* 铁匠铺强化系数（托管战斗专用通道） */
        return base;
    }

    /* 城防系数：引擎没有「城防」字段，用可用的城防相关量加权得出。
       各项都做了封顶，保证「城防优势最多把守军战力放大约 1.8 倍」，
       不会出现「一座空城挡死大军」的另一极端；系数可由 wDef 整体缩放。 */
    function cityDefFactor(cityIdx) {
        var c = cityAt(cityIdx);
        if (!c) return 1;
        var f = 0;
        try {
            f += Math.min(0.30, (c.MothballArms || 0) / 15000);   /* 后备兵力：可动员的守备池 */
            f += Math.min(0.20, (c.AvoidCalamity || 0) / 500);    /* 防灾：城防工事水平 */
            f += Math.min(0.10, (c.PeopleDevotion || 0) / 1000);  /* 民忠：民心是否肯守 */
            f += Math.min(0.15, (c.Population || 0) / 2500000);   /* 人口：城市规模 */
        } catch (e) { }
        return 1 + safeWeight('wDef', 1) * f;
    }

    function sidePower(aIdx, bIdx, defCityIdx) {
        var fp = baye.data.g_FgtParam, i, pid, pow = 0, cnt = 0;
        for (i = aIdx; i < bIdx; i++) {
            pid = fp.GenArray[i];
            if (!pid) continue;
            pow += genPower(pid);
            cnt++;
        }
        if (defCityIdx !== undefined) pow *= cityDefFactor(defCityIdx);
        return { pow: pow, cnt: cnt };
    }

    function onFightCountWinner() {
        try {
            var fp = baye.data.g_FgtParam;
            if (!fp || fp.Mode !== FGT_AUTO) return undefined;
            /* 诊断开关：完全交还引擎结算（不接管胜负）。
               AI 托管战斗一旦被我们 return 0 接管，引擎的 FgtCountWon() 就不会跑 ——
               而它除了判胜负还负责战斗结算段的收尾绘制，Skipping 后战斗动画里
               「X军 vs Y军」横幅会被画两遍（双 VS）。开着这个开关即可 A/B 验证。 */
            if (cfg.engineSettle) return undefined;
            diag.fightCountWinner += 1;

            /* 先让原版钩子跑完：lib 若注册过 fightCountWinner，它负责引擎结算前的准备工作。
               我们只覆盖它给出的胜负，这样引擎该走的收尾流程不会因为我们 return 0 被整段跳过。 */
            try {
                var origHook = wrappedHooks.fightCountWinner;
                if (typeof origHook === 'function' && !origHook.__bayeCheatWrap) {
                    origHook.call(baye.hooks, undefined);
                }
            } catch (e) { log('原版托管结算钩子异常（继续接管）：', e); }

            var mustOverride = flag('autoBalance') || Number(cfg.deathRate) > 0;
            var win;
            if (mustOverride) {
                var atk = sidePower(0, 10);
                var def = sidePower(10, 20, fp.CityIndex);
                if (!atk.cnt) { win = false; }
                else if (!def.cnt) { win = true; }
                else {
                    /* 兵力与粮草的总量对比（保留原版对粮草的部分影响） */
                    var prov = (fp.MProvender || 0) - (fp.EProvender || 0);
                    var ratio = atk.pow / Math.max(1, def.pow);
                    ratio *= 1 + Math.max(-0.15, Math.min(0.15, prov / 20000));
                    var pWin = 1 / (1 + Math.pow(ratio, -safeSpread()));
                    win = Math.random() < pWin;
                }
                if (Number(cfg.deathRate) > 0 && !flag('autoBalance') && cfg.verbose) {
                    log('战死概率已开启，AI 托管战斗强制使用自动结算以记录参战名单');
                }
            } else {
                /* 不接管胜负：让引擎自己算，但我们也无法记录名单（FGT_AUTO 没有 exitBattle），
                   所以战死概率/月报对这类战斗无效 —— 这是预期行为。 */
                return undefined;
            }

            /* 关键：AI 托管战斗（FGT_AUTO）不走战斗主循环，引擎的 exitBattle 钩子
               根本不会触发 —— 战报与参战名单必须在这里记，否则 AI 互殴一场都记不上 */
            try {
                var pids = new Array(20), gi, gv;
                for (gi = 0; gi < 20; gi++) {
                    gv = fp.GenArray[gi];
                    pids[gi] = gv ? gv - 1 : undefined;
                }
                battleRosters.push({ city: fp.CityIndex, pids: pids, month: monthKey(), result: win ? FGT_WON : FGT_LOSE });
                diag.autoBattlesRecorded += 1;

                var atkKing0 = '';
                try {
                    var ap = fp.GenArray[0] ? personAt(fp.GenArray[0] - 1) : null;
                    if (ap) atkKing0 = safeName(ap.Belong) || nameOf(fp.GenArray[0] - 1);
                } catch (e) { }
                if (!atkKing0) atkKing0 = cityName(fp.CityIndex) + '来军';
                var defKing0 = safeName(cityAt(fp.CityIndex) && cityAt(fp.CityIndex).Belong) || cityName(fp.CityIndex);
                if (!defKing0) defKing0 = cityName(fp.CityIndex) || '守方';
                pushReport('【战斗】' + atkKing0 + '军 ' + attackSrcTag(fp) + '进攻 ' + cityName(fp.CityIndex)
                    + '（' + defKing0 + '军），' + (win ? '城破' : '击退') + oddAttackTag(fp));
            } catch (e) { log('托管战报异常', e); }

            if (cfg.verbose) {
                var wr = waterRatioOf(fp.CityIndex);
                log('托管结算：攻方战力 ' + Math.round(atk.pow) + '（' + atk.cnt + '人）'
                    + ' vs 守方战力 ' + Math.round(def.pow) + '（' + def.cnt + '人，含城防×'
                    + cityDefFactor(fp.CityIndex).toFixed(2) + '、水域' + (wr * 100).toFixed(0) + '%）'
                    + ' 比值 ' + ratio.toFixed(2) + ' → 胜率 ' + (pWin * 100).toFixed(1) + '%'
                    + ' → ' + (win ? '攻方胜' : '守方胜'));
            }
            baye.data.g_FgtOver = win ? FGT_WON : FGT_LOSE;
            /* AI 托管战斗不经过战斗主循环，exitBattle 不会触发 ——
               君主保护必须在这里做：结果已定、FightResultDeal（战死/俘虏/沦陷结算）还没跑，
               此刻把该被清算的君主摘出战场，引擎就抓不到他（v1.5 修复「免疫无效」） */
            try { guardBattleField(false); } catch (e) { log('君主保护异常', e); }
            try { rollbackCapturedKings(false); } catch (e) { log('君主回滚异常', e); }
            return 0;                       /* 0 = 已处理，引擎不再走 FgtCountWon */
        } catch (e) {
            log('托管结算异常，交回引擎：', e);
            return undefined;
        }
    }

    /* ---------- 5.5c 战斗记录与阵亡检测 ----------
       exitBattle 在 FightResultDeal（战死/俘虏结算）之前调用，此刻还看不出谁死了；
       所以这里只记下「这一仗谁参加了、在哪个城、谁攻谁」，等月末（tacticStage5）
       再比对：参战者若已不在任何城池、也不是俘虏 → 判定阵亡，弹提示并记入月报。 */
    function onEnterBattle() {
        applyEngineSwitches();
        try { scanWaterRatio(); } catch (e) { }        /* 真实战斗时战场地图已加载 → 记录水域占比 */
        return undefined;
    }

    var battleRosters = [];       /* 当月每场战斗的参战名单 { city, pids, month } */
    var diag = { fightCountWinner: 0, exitBattle: 0, autoBattlesRecorded: 0, applyDeathRate: 0, deathsApplied: 0 };

    /* 战报异常标记：攻方主帅此刻在城里、且该城与目标城不相邻 → 说明这一仗越过了道路。
       行军途中的人不在任何城的名册里（cityOfPerson 返回 0xff），不会误报。
       用途：把「引擎自己打的越界仗」和「我们 AI 打的」区分开，方便定位。 */
    function oddAttackTag(fp, atkPid) {
        try {
            if (!fp || !adjReady()) return '';
            var pid = (atkPid !== undefined) ? atkPid : (fp.GenArray[0] ? fp.GenArray[0] - 1 : -1);
            if (pid < 0) return '';
            var from = cityOfPerson(pid);
            if (from === 0xff || from === fp.CityIndex) return '';
            if (isAdjacent(from, fp.CityIndex)) return '';
            return '　【异常】' + cityName(from) + '与' + cityName(fp.CityIndex) + '不相邻';
        } catch (e) { return ''; }
    }

    function onExitBattle() {
        diag.exitBattle += 1;
        /* 先记战报与参战名单 —— 后面的君主保护会把获救者从战场队列里摘走（槽位清零），
           那时再读 GenArray[0] 就变成 0，战报里会冒出「?」 */
        try {
            var fp = baye.data.g_FgtParam;
            if (fp && baye.data.g_FgtOver !== FGT_COMON && fp.GenArray) {
                var pids = new Array(20), i, pid;
                for (i = 0; i < 20; i++) {
                    pid = fp.GenArray[i];
                    pids[i] = pid ? pid - 1 : undefined;
                }
                var atkPid = fp.GenArray[0] ? fp.GenArray[0] - 1 : -1;
                var atkName = atkPid >= 0 ? nameOf(atkPid) : '?';
                var atkKing = '';
                if (atkPid >= 0) {
                    try {
                        var ap2 = personAt(atkPid);
                        if (ap2) atkKing = safeName(ap2.Belong) || nameOf(atkPid);
                    } catch (e) { }
                }
                if (!atkKing) atkKing = cityName(fp.CityIndex) + '来军';
                var defKing = safeName(cityAt(fp.CityIndex) && cityAt(fp.CityIndex).Belong) || cityName(fp.CityIndex);
                var res = baye.data.g_FgtOver === FGT_WON ? '城破' : '击退';
                battleRosters.push({ city: fp.CityIndex, pids: pids, month: monthKey(), result: baye.data.g_FgtOver });
                /* 战斗当场就写月报，每场都记（不等月末，避免一个月只留最后一场） */
                pushReport('【战斗】' + atkKing + '军 ' + attackSrcTag(fp, atkPid) + '进攻 ' + cityName(fp.CityIndex)
                    + '（' + defKing + '军），' + res + oddAttackTag(fp, atkPid));
            }
        } catch (e) { log('战斗记录异常', e); }
        applyEngineSwitches();
        try { guardBattleField(false); } catch (e) { log('君主保护异常', e); }
        try { rollbackCapturedKings(false); } catch (e) { log('君主回滚异常', e); }
        return undefined;
    }

    /* 月末比对：当月每场战斗的参战者里谁永久消失了 */
    function detectDeaths() {
        var out = [], i, k, deadSeen = {};
        /* 已在台账里的不重复记（同一人只能阵亡一次） */
        for (k = 0; k < deaths.length; k++) deadSeen[deaths[k].pid] = 1;
        var busy2 = busyFighters();                        /* 行军中的人不在城是正常的 */
        for (k = 0; k < battleRosters.length; k++) {
            var r = battleRosters[k];
            /* 不按当前 monthKey() 过滤：tacticStage5 时月份已 +1（见 applyDeathRate 注释） */
            var cities = baye.data.g_Cities, c, where = {};
            for (c = 0; c < cities.length; c++) {
                var list = personsOfCity(c);
                for (i = 0; i < list.length; i++) where[list[i]] = c;
            }
            for (i = 0; i < r.pids.length; i++) {
                var pid = r.pids[i];
                if (pid === undefined || deadSeen[pid] || busy2[pid]) continue;
                if (isPendingPlace(pid)) continue;          /* 月初刚归位中的君主（在路上）不算阵亡 */
                var p = personAt(pid);
                if (!p) continue;
                if (where[pid] !== undefined) continue;       /* 在城里，没事 */
                if (p.Belong === CAPTIVE) continue;           /* 被俘，不是阵亡 */
                /* 彻底消失 → 阵亡 */
                deadSeen[pid] = 1;
                var rec = {
                    pid: pid,
                    name: nameOf(pid),
                    king: safeName(p.Belong),
                    city: cityName(r.city),
                    date: String(r.month).replace('-', '年') + '月'
                };
                deaths.push(rec);
                out.push(rec.name + '（' + rec.king + '军，战于' + rec.city + '）');
                if (out.length >= 8) { out.push('……'); break; }
            }
        }
        battleRosters = [];
        if (out.length) {
            saveDeaths();
            alert2('【阵亡】' + out.join('、'));
        }
        return out;
    }

    /* ---------- 战死概率倍率 ----------
       引擎的战死藏在 TheLoserDeal（逃跑失败且 rnd==0 才死，约 1% 且无法改骰子）。
       做法：始终打开引擎的 disableFightToDeath（引擎绝不真死），月末由脚本对
       当月每场战斗的「败方参战者」按 deathRate% 抽取假死 —— 从城中移除（装备掉落城里）、
       记入阵亡台账并提示，可用「武将修复」逐个找回，正好用于测试该功能。
       deathRate = 0 时等价于禁止战死。 */
    function applyDeathRate() {
        diag.applyDeathRate += 1;
        var rate = Number(cfg.deathRate) || 0;
        if (rate <= 0) return [];
        var out = [], k, i;
        var deadSeen = {};
        for (k = 0; k < deaths.length; k++) deadSeen[deaths[k].pid] = 1;
        /* 注意：不要按 monthKey() 过滤 —— 引擎月循环是 PolicyExec（打仗）→
           ConditionUpdate（月份+1）→ tacticStage5（这里）。到月结时月份已 +1，
           名单里记的还是打仗那个月，按当前月过滤会全军覆没（v1.8 战死无效的真凶）。
           battleRosters 每次月结都会清空，缓冲区里全是本月该结的账。 */
        var busy = busyFighters();                         /* 已编入出征批次的人不处决 */
        for (k = 0; k < battleRosters.length; k++) {
            var r = battleRosters[k];
            if (!r.result) continue;
            /* 败方槽位：攻胜则守方（GenArray 10~19）败，反之攻方（0~9）败 */
            var loserPids = (r.result === FGT_WON) ? r.pids.slice(10, 20) : r.pids.slice(0, 10);
            for (i = 0; i < loserPids.length; i++) {
                var pid = loserPids[i];
                if (pid === undefined || deadSeen[pid] || busy[pid]) continue;
                if (rand(100) >= rate) continue;           /* 概率抽取 */
                var p = personAt(pid);
                if (!p || !p.Level || p.Level <= 0) continue;
                if (p.Belong === pid + 1) continue;        /* 君主不参与战死抽取：
                    君主保护已提供「转移+重伤」的免死通道，两套逻辑叠加会自相矛盾
                    （提示战死、人却被保护活下来），且君主战死无继承人语义 */
                var diedCity = r.city;                     /* 默认死在战斗城 */
                var from = cityOfPerson(pid);
                if (p.Belong === CAPTIVE) {
                    /* 败方被俘者：伤重不治/被处决。HoldCaptive 存了 OldBelong，
                       恢复原属，武将修复才能按快照把他找回来 */
                    if (from === 0xff) continue;
                    diedCity = from;
                    try { baye.deletePersonInCity(from, pid); } catch (e) { }
                    if (p.OldBelong && p.OldBelong !== CAPTIVE) p.Belong = p.OldBelong;
                } else {
                    if (p.Belong === WILD) continue;
                    if (from === 0xff) continue;           /* 不在任何城（比如刚被君主救援搬走），跳过 */
                    try { baye.deletePersonInCity(from, pid); } catch (e) { }
                }
                /* 装备掉落战死城（引擎战死同款：TheLoserDeal 死亡分支掉在战斗城） */
                try {
                    if (p.Equip[0]) baye.putToolInCity(diedCity, p.Equip[0] - 1, false);
                    if (p.Equip[1]) baye.putToolInCity(diedCity, p.Equip[1] - 1, false);
                } catch (e) { }
                deadSeen[pid] = 1;
                var rec = {
                    pid: pid, name: nameOf(pid), king: safeName(p.Belong),
                    city: cityName(diedCity), date: String(r.month).replace('-', '年') + '月'
                };
                deaths.push(rec);
                diag.deathsApplied += 1;
                out.push(rec.name + '（' + rec.king + '军，战于' + rec.city + '）');
                if (out.length >= 8) { out.push('……'); break; }
            }
            if (out.length >= 8) break;
        }
        if (out.length) {
            saveDeaths();
            alert2('【阵亡】' + out.join('、') + '　（可在游戏内「武将修复」找回）');
        }
        return out;
    }

    /* 阵亡台账（持久化）：姓名 / 归属君主 / 时间 / 地点 */
    var DEATHS_KEY = 'baye_cheat_deaths_v1';   /* 旧键（仅用于一次性迁移） */
    var deaths = (function () {
        try { return JSON.parse(localStorage.getItem(skey('deaths_v1'))) || []; } catch (e) { return []; }
    })();

    function saveDeaths() {
        try {
            while (deaths.length > 200) deaths.shift();
            localStorage.setItem(skey('deaths_v1'), JSON.stringify(deaths));
        } catch (e) { }
    }

    /* 单人找回：按快照放回原势力城池，重伤惩罚 */
    function rescueOne(idx) {
        var p = personAt(idx);
        var s = SNAP[idx];
        if (!p) return '查无此人';
        var belong = (s && s.belong > 0 && s.belong !== CAPTIVE) ? s.belong : p.Belong;
        var oc = ownCities(belong);
        var to = (s && s.city !== undefined && cities0()[s.city] && cities0()[s.city].Belong === belong)
            ? s.city : (oc.length ? oc[0] : -1);
        var homeless = false;
        if (to < 0) {
            /* ★ 修复：原势力已灭（名下无城）时不要直接放弃 ——
               用户截图：「该武将所属势力已无城池，无处可回」，武将就永久丢了。
               现在降级处理：送进**玩家自己的城池**，并把归属改成玩家君主。
               他依然是那个武将（等级/兵力/装备按重伤结算），只是换了个主公。*/
            var pc = ownCities((baye.data.g_PlayerKing || 0) + 1);
            if (!pc.length) {
                /* 玩家也没城（理论上不可能）→ 随便找一座有人��城 */
                var any = -1;
                for (var ci = 0; ci < cities0().length; ci++) {
                    if (cities0()[ci] && cities0()[ci].Belong > 0) { any = ci; break; }
                }
                if (any < 0) return '全军覆没，无处可安置' + nameOf(idx);
                pc = [any];
            }
            to = pc[0];
            belong = cities0()[to].Belong;                /* 改成该城的主人 */
            homeless = true;
        }
        var from = cityOfPerson(idx);
        if (from !== 0xff) { try { baye.deletePersonInCity(from, idx); } catch (e) { } }
        placePerson(to, idx);
        p.Belong = belong;
        if (s) {
            p.Arms = Math.max(1, Math.floor((s.arms || 0) * 0.3));
            p.Thew = Math.max(10, (s.thew || 100) - 40);
            try { p.Equip[0] = s.equip[0]; p.Equip[1] = s.equip[1]; } catch (e) { }
        } else {
            p.Arms = Math.max(1, Math.floor(p.Arms * 0.3));
            p.Thew = Math.max(10, p.Thew - 40);
        }
        deaths = deaths.filter(function (d) { return d.pid !== idx; });
        saveDeaths();
        return '已把 ' + nameOf(idx) + ' 重伤送回 ' + cityName(to)
            + (homeless ? '（原势力已灭，就近安置）' : '');
    }

    function cities0() { return baye.data.g_Cities; }


    /* 钩子晚注册自愈：lib 若在本脚本之后才注册 countAttackHurt/countSkillHurt/
       getPersonPropertyValue，引擎会直接覆盖我们的包装（强化静默失效且不报错）。
       每月检查一次：钩子不是我们包的就重新包一层。
       注意 getPersonPropertyValue 必须在列表里 —— 漏了它会导致
       「装备栏不显示强化等级」且没有任何报错。 */
    function forgeHookSelfHeal() {
        if (!flag('forge')) return;
        ['countAttackHurt', 'countSkillHurt', 'getPersonPropertyValue'].forEach(function (n) {
            var cur = baye.hooks[n];
            if (cur && cur.__bayeCheatWrap) return;      /* 还在，OK */
            if (!cur) return;                            /* lib 还没注册，下月再看 */
            /* 被外部改了：把它当原版重新包一层。
               注意必须按钩子名分派处理器 —— 早期版本这里一律用 onCountHurt，
               导致 getPersonPropertyValue（装备栏）被套上「普攻伤害」逻辑，
               强化等级永远加不上且不报错。 */
            var handler = (n === 'getPersonPropertyValue') ? onPersonPropertyValue : onCountHurt;
            var wrapped = (function (orig, fn) {
                return function (ctx) {
                    var rv;
                    try { rv = fn(ctx, orig); } catch (e) { rv = undefined; }
                    if (rv !== undefined) return rv;
                    return orig.apply(this, arguments);
                };
            })(cur, handler);
            wrapped.__bayeCheatWrap = 1;
            baye.hooks[n] = wrapped;
            wrappedHooks[n] = cur;
            log('铁匠铺：重新接管钩子 ' + n + '（它在本脚本之后才注册）');
        });
    }

    function onTacticStage1() {
        try { forgeHookSelfHeal(); } catch (e) { }
        /* 资源防截断：此刻引擎上个月的月结已跑完，钱被削到了 30000。
           与上月末记录的额度对比，若确认是被削（非玩家自己花掉）就补回。*/
        try { restoreResIfClamped(); } catch (e) { }
        /* 赛马提醒：距下届 ≤1 个月时弹一次（各赛季只提醒一次）。
           ★ 不用 setTimeout —— 在setTimeout 里调 baye.alert 会在引擎 UI 状态机
           之外异步弹窗，引擎此时可能在处理自己的回调栈，导致
           baye._cbs.pop() 返回 undefined → TypeError（用户截图里的报错，会破坏游戏状态）。
           改成：把提醒塞进 UI 队列，由队列在安全时机（tacticStage5 末尾）串行弹出。 */
        try {
            /* 只在 2/5/8/11 月提醒（下一个月的月末正好是赛马月） */
            var mdR = baye.data.g_MonthDate || 0;
            var isPreRace = (mdR % 3 === 2)&& (mdR > 0);
            if (flag('raceOn') && myMounts().length && isPreRace
                && RACE_REMIND_SEASON !== mdR) {
                RACE_REMIND_SEASON = mdR;
                uiQueue(function () {
                    alert2('下个月有赛马大会！\n'
                        + '现在可以去【马厩】报名（选马 + 交粮草报名费）。\n'
                        + '冠军奖金 ' + RACE_PRIZE[0] + ' 金，不报名就拿不到。');
                });
            }
        } catch (e7) { }
        /* AI 势力：先补坐骑（赛马要有马可跑），再自主强化 */
        try { aiGiveMounts(); } catch (e0) { }
        try { aiForgeAll(); } catch (e) { }
        var notes = [];
        if (appliedOnce) {
            if (flag('noDeathRescue')) {
                try { notes = notes.concat(rescueLostGenerals(false) || []); } catch (e) { }
            }
            try { notes = notes.concat(rollbackCapturedKings(true) || []); } catch (e) { }
            /* 名册自愈：君主/武将错列、重复在册（被俘转移、跨城回防等路径的残留） */
            try { repairCityRoster(false); } catch (e) { }
        }
        applyEngineSwitches();
        /* 资源补正放在月末（tacticStage5 末尾）做：引擎的月结
           Money = 1 + Money + Commerce/2.5 并夹到 30000 发生在本钩子之后，
           放在月初补会被随后的月结立刻削掉（实测 30175 → 30000 就是这个原因）。*/
        /* 投奔/灾害的差分要在 snapshot() 覆盖之前做 */
        try { if (appliedOnce) reportDefectionsAndDisasters(); } catch (e) { log('事件记录异常', e); }
        try { snapshotBelong(); } catch (e) { }
        try { if (flag('noDeath') || flag('noDeathRescue')) snapshot(); } catch (e) { }
        /* 防灾：己方城池不出饥荒/旱灾/水灾/暴动（提防灾值 + 清当前状态） */
        try {
            if (flag('noDisaster')) {
                var mine = ownCities(baye.data.g_PlayerKing + 1);
                for (var d = 0; d < mine.length; d++) {
                    var cd = cityAt(mine[d]);
                    if (!cd) continue;
                    if (cd.AvoidCalamity < 100) cd.AvoidCalamity = 100;
                    if (cd.State) cd.State = 0;
                }
            }
        } catch (e) { }
        /* 势力变更检测：新君即位（含策反/继位）与势力灭亡 */
        try { detectPowerChanges(); } catch (e) { log('势力检测异常', e); }
        if (notes.length) pushReport(notes);
        appliedOnce = true;
        return undefined;
    }

    var KING_SNAP = null;

    function snapshotKings() {
        var map = {}, cities = baye.data.g_Cities, i;
        for (i = 0; i < cities.length; i++) {
            var b = cities[i].Belong;
            if (b > 0 && b !== CAPTIVE) map[b] = (map[b] || 0) + 1;
        }
        return map;
    }

    function detectPowerChanges() {
        var cur = snapshotKings(), key;
        if (KING_SNAP) {
            for (key in cur) {
                if (cur.hasOwnProperty(key) && !KING_SNAP[key]) {
                    var kid = Number(key);
                    var oc = ownCities(kid);
                    if (kid !== baye.data.g_PlayerKing + 1 && oc.length) {
                        pushReport('【新君】' + safeName(kid) + ' 即位（都 ' + cityName(oc[0]) + '）');
                    }
                }
            }
            for (key in KING_SNAP) {
                if (KING_SNAP.hasOwnProperty(key) && !cur[key]) {
                    pushReport('【灭亡】' + safeName(Number(key)) + ' 势力覆灭');
                }
            }
        }
        KING_SNAP = cur;
    }

    function pushReport(lines) {
        if (typeof lines === 'string') lines = [lines];
        var head = monthKey().replace('-', '年') + '月';
        for (var i = lines.length - 1; i >= 0; i--) info.monthReport.unshift(head + ' ' + lines[i]);
        while (info.monthReport.length > 120) info.monthReport.pop();
    }

    /* ---------- 5.6 需求2：招降/招揽/搜寻必定成功（所见即所得版） ----------
       引擎实现（src/citycmd.c）：SearchDrv / SurrenderDrv / CanvassDrv 的成败判定
       全在 WASM 内部（gam_rand 比智力/忠诚/性格），脚本无法改骰子。
       但 willExecuteOrder 返回 0 = 「本指令已处理，引擎跳过默认执行」——
       于是开启开关后我们直接按引擎语义把结果做出来，武将当场开口说话（baye.say），
       所见即所得，不再月末补发。 */
    var ORDER_SEARCH = 3, ORDER_SURRENDER = 6, ORDER_CANVASS = 16;

    function onWillExecuteOrder(ctx) {
        if (!ctx) return undefined;
        var playerKing = baye.data.g_PlayerKing + 1;
        var p = personAt(ctx.Person);
        if (!p || p.Belong !== playerKing) return undefined;         /* 只管玩家自己的指令 */
        var id = ctx.OrderId;
        try {
            if (id === ORDER_SEARCH && (flag('searchGen') || flag('searchTool'))) {
                return doSearchNow(ctx);
            }
            if (id === ORDER_SURRENDER && flag('surrender')) {
                return doSurrenderNow(ctx);
            }
            if (id === ORDER_CANVASS && flag('surrender')) {
                return doCanvassNow(ctx);
            }
        } catch (e) {
            log('必成指令异常，交回引擎：', e);
            return undefined;
        }
        return undefined;
    }

    function monthKey() {
        return (baye.data.g_YearDate || 0) + '-' + (baye.data.g_MonthDate || 0);
    }

    /* 搜寻：保持原作「可能搜出钱粮」的手感，同时让必成开关真正即时 ——
         · searchGen 开 → **优先**当场招到城内在野武将（主线玩法，所以排第一）；
         · searchTool 开 → 其次发现城里隐藏的道具（引擎原生机制，绝不复制他人道具）；
         · 都没有产出 → 搜得银两/粮草保底（按执行者智力，同引擎公式）。
       执行者完成后回城（与引擎 SearchDrv 末尾 AddPerson 一致）。 */
    function doSearchNow(ctx) {
        var person = ctx.Person, city = ctx.City;
        var P = personAt(person);
        if (!P) return -1;
        var king = P.Belong;
        var got = false;

        /* 优先级（用户约定）：**先武将、再道具、最后钱粮保底**。
           武将优先是因为「搜索招将」才是这玩法的主线，装备只是附赠。 */

        /* ① 武将必成：当场招到城内在野（优先于道具） */
        if (flag('searchGen')) {
            var w = wildsOfCity(city);
            if (w.length) {
                var t = w[rand(w.length)];
                var tp = personAt(t);
                tp.Belong = king;
                tp.Devotion = 70 + rand(30);
                say2(t, '得遇明主，愿效犬马之劳！');
                log('搜寻：' + nameOf(t) + ' 在' + cityName(city) + '出仕');
                got = true;
            }
        }
        /* ② 道具必成：发现城里隐藏的道具（武将没有时才出） */
        if (!got && flag('searchTool')) {
            var c = cityAt(city);
            var hidden = [], i;
            if (c) {
                for (i = c.ToolQueue; i < c.ToolQueue + c.Tools; i++) {
                    var raw = baye.data.g_GoodsQueue[i];
                    if (raw !== undefined && raw !== null && (raw & 0x8000) === 0) hidden.push(i);
                }
            }
            if (hidden.length) {
                var slot = hidden[rand(hidden.length)];
                var tid = baye.data.g_GoodsQueue[slot] & 0x7fff;
                baye.data.g_GoodsQueue[slot] |= 0x8000;      /* 引擎 SetGoods 同款：置已发现 */
                say2(person, '此番搜寻，得了 ' + gbkSafe(baye.getToolName(tid)) + '！');
                log('搜寻发现 ' + gbkSafe(baye.getToolName(tid)) + '（' + cityName(city) + '）');
                got = true;
            }
        }
        /* ③ 保底：搜得钱粮（保持原作手感，不空手） */
        if (!got) {
            var bonus = 10 + rand(Math.max(1, (P.IQ || 0) * 2));
            var cb = cityAt(city);
            if (rand(2) === 0) {
                if (cb) cb.Money = Math.min(65535, (cb.Money || 0) + bonus);
                say2(person, '搜得银两 ' + bonus + '，已入库！');
            } else {
                if (cb) cb.Food = Math.min(65535, (cb.Food || 0) + bonus);
                say2(person, '搜得粮草 ' + bonus + '，已入库！');
            }
        }
        try { placePerson(city, person); } catch (e) { }    /* 与引擎一致：执行者回城 */
        return 0;                                                    /* 0 = 已处理，跳过引擎 */
    }

    /* 招降：目标必须是俘虏，直接归顺 */
    function doSurrenderNow(ctx) {
        var person = ctx.Person, city = ctx.City, ob = ctx.Object;
        var P = personAt(person), T = personAt(ob);
        if (!P || !T || T.Belong !== CAPTIVE) return -1;             /* 不是俘虏，交回引擎 */
        T.Belong = P.Belong;
        T.Devotion = 90;
        try { placePerson(city, person); } catch (e) { }    /* 执行者回城 */
        say2(ob, '愿降！从今往后，万死不辞！');
        pushReport('【投奔】' + safeName(city.Belong) + '军 ' + nameOf(ob) + ' 投奔 ' + safeName(P.Belong)
            + '（' + cityName(city) + '）' + forgeGiftTag(ob));
        return 0;
    }

    /* 收服/招揽带回来的强化等级提示。
       强化等级记在 FORGE 表里，键是「武将下标_槽位」→ **跟人走，不跟势力走**，
       所以把别家的强化武将收服过来，等级直接继承（这正是「养敌再收」的玩法基础）。 */
    function forgeGiftTag(ob) {
        try {
            var l0 = forgeLv(ob, 0), l1 = forgeLv(ob, 1), best = Math.max(l0, l1);
            if (!best) return '';
            return '　带 +' + best + (l1 > l0 ? '/+' + l1 : l0 > l1 ? '/+' + l0 : '') + ' 强化';
        } catch (e) { return ''; }
    }

    /* 招揽：把目标从原势力挖到本城 */
    function doCanvassNow(ctx) {
        var person = ctx.Person, city = ctx.City, ob = ctx.Object;
        var P = personAt(person), T = personAt(ob);
        if (!P || !T || T.Belong === P.Belong || T.Belong === WILD || T.Belong === CAPTIVE) return -1;
        var from = cityOfPerson(ob);
        if (from !== 0xff) { try { baye.deletePersonInCity(from, ob); } catch (e) { } }
        placePerson(city, ob);
        T.Belong = P.Belong;
        T.Devotion = 40 + rand(40);
        try { placePerson(city, person); } catch (e) { }    /* 执行者回城 */
        say2(ob, '良禽择木而栖，愿随明主！');
        pushReport('【投奔】' + safeName(city.Belong) + '军 ' + nameOf(ob) + ' 投奔 ' + safeName(P.Belong)
            + '（' + cityName(city) + '）' + forgeGiftTag(ob));
        return 0;
    }

    /* ---------- 5.7 AI 攻占空城 ----------
       引擎 tactic.c 的 AI 出征目标用 GetRoundEnemyCity() 挑选，其中
       `if (cp && (cp != cb))` 把 Belong==0 的无主城直接排除 —— 所以原版 AI
       永远不会去占空城（WASM 内部逻辑，脚本改不动）。
       这里在 AI 内政阶段（tacticStage2）代劳：让空城的相邻 AI 势力派一名武将
       过去占领（原版打空城本来就没有战斗，BattleDrv 里 `if (!ob)` 直接占领）。 */
    /* 城池邻接表（提取自平衡版2.1 dat.xml 的「路径」字段，38 城，顺序 = 城编号） */
    var CITY_ADJ = [[3], [2, 7, 6], [1], [8, 0], [5, 10], [6, 11, 4], [1, 12, 5], [13, 1], [9, 14, 3], [10, 8], [4, 15, 20, 14, 9], [5, 12, 15], [6, 13, 16, 11], [7, 18, 17, 12], [8, 10, 20, 19], [11, 16, 21, 10], [12, 22, 15], [13, 18, 22], [17, 13], [14, 24], [10, 21, 26, 14], [15, 22, 20], [17, 23, 29, 28, 21, 16], [22], [19, 25, 31, 30], [24], [20, 27, 33, 32], [28, 33, 26], [22, 34, 27], [34, 22], [24], [32, 24], [26, 35, 31], [27, 34, 36, 26], [29, 37, 33, 28], [36, 32], [33, 37, 35], [34, 36]];
    /* 邻接表的城市名（与 CITY_ADJ 同序，来源：city-adj.json）。
       我们是绕过引擎的指令校验直接写出征单（launchAttack 里OrderId=27），
       所以一旦 MOD/剧本换了地图或改了城名，索引就会错位 → 出现「北平的公孙瓒打梓潼」这种
       跨地图进攻。引擎不提供运行时邻接接口，只能靠城名自查：对不上就整表停用，
       宁可 AI 这个月不出征，也不能让它乱打。 */
    var CITY_ADJ_NAMES = ["西凉", "北平", "襄平", "安定", "晋阳", "平原", "南皮", "北海", "天水", "河内", "长安", "邺", "濮阳", "徐州", "汉中", "洛阳", "许昌", "小沛", "下邳", "梓潼", "宛城", "寿春", "建业", "吴", "成都", "绵竹", "襄阳", "江夏", "庐江", "会稽", "云南", "巴郡", "武陵", "长沙", "柴桑", "零陵", "桂阳", "建宁"];
    var ADJ_OK = null;
    function adjReady() {
        if (ADJ_OK !== null) return ADJ_OK;
        try {
            var n = baye.data.g_Cities.length, i, bad = [];
            /* 只比对当前地图实际存在的城；城数比内置表还多 → 地图是另一张，一律停用 */
            if (n > CITY_ADJ_NAMES.length) {
                ADJ_OK = false;
                log('当前地图 ' + n + ' 城与内置邻接表（' + CITY_ADJ_NAMES.length + ' 城）不是同一张，已停用 AI 自主出征');
                return ADJ_OK;
            }
            for (i = 0; i < n; i++) {
                if (cityName(i) !== CITY_ADJ_NAMES[i]) bad.push('#' + i + ' ' + CITY_ADJ_NAMES[i] + '≠' + cityName(i));
            }
            ADJ_OK = (bad.length === 0);
            if (!ADJ_OK) {
                log('城池邻接表与当前地图不符（' + bad.length + ' 处），已停用 AI 自主出征：' + bad.slice(0, 5).join('、'));
            }
        } catch (e) { ADJ_OK = false; }
        return ADJ_OK;
    }
    /* 取相邻城；邻接表未就绪时返回空数组（= 不出征） */
    function adjOf(c) { return adjReady() ? (CITY_ADJ[c] || []) : []; }
    function isAdjacent(a, b) {
        if (a === b) return false;
        var l = adjOf(a), i;
        for (i = 0; i < l.length; i++) if (l[i] === b) return true;
        return false;
    }
    /* 本月是否已有部队「正压着」这座城（v1.11.6：用户要求一个城市一个月内可被多次攻击，
       所以不再限制「本月打了几次」——只拦同时排两支部队打同一城，
       那种情况战斗画面会叠出两条横幅）。 */
    var ATTACKED = { month: '', targets: {} };
    function alreadyAttacked(c) {
        var mk = monthKey();
        if (ATTACKED.month !== mk) { ATTACKED.month = mk; ATTACKED.targets = {}; }
        /* 引擎指令队列里若已有攻这座城的单（我们或原版 AI 排的），
           说明这支部队还没打完，此时不再排第二支 */
        try {
            var q = baye.data.g_OrderQueue, i;
            for (i = 0; i < q.length; i++) {
                if (q[i] && q[i].OrderId === 27 && q[i].Object === c) return true;
            }
        } catch (e) { }
        return false;
    }
    function markAttacked(c) {
        var mk = monthKey();
        if (ATTACKED.month !== mk) { ATTACKED.month = mk; ATTACKED.targets = {}; }
        ATTACKED.targets[c] = (ATTACKED.targets[c] || 0) + 1;   /* 仅作台账统计 */
    }
    /* 最近一次进攻「目标城 → 出发城」台账：写出征单时记下，月报战报里回显「自 XX 进攻」 */
    var ATTACK_SRC = {};
    /* 出征节奏控制（v1.17.0）：
       用户反馈「再强势也不要第二个月就打过来，兵都还没配」。
       根因：原逻辑只��「战力门槛 gate」，**没有任何时间维度** → 开局的 190年1月建势力、
       2月就攒够兵打邻居，玩家完全没时间布防。
       现在加三道时间闸门（都在 smartPlan 的选目标环节生效）：
         ① 开局冷静期：新局前 6 个月不主动进攻（只回防）；
         ② 每战冷却：同一势力两次进攻至少间隔 N 个月（默认 3）；
         ③ 逐步加码：优势门槛随「本势力参战次数」递增（越打越谨慎），
            避免一个强国连续月月开打。 */
    var WAR_LAST = {};          /* 势力 -> 上次进攻的月份键 */
    var WAR_COUNT = {};         /* 势力 -> 累计主动进攻次数 */
    var WARMUP_MONTHS = 3;      /* 开局冷静期（月） */
    var WAR_COOLDOWN = 3;       /* 两次进攻的最小间隔（月） */
    /* 错月分散：引擎的战斗横幅是单行 UI，同一 tick 触发多场战斗会互相覆盖
       （用户截图：「董卓军 vs 王匡军… vs 刘军」文字叠在一起）。
       引擎层面改不了横幅，但可以**让各势力的进攻落在不同月份**，
       把同月并发压到最低：势力编号 % 3 决定它在本轮3 个月里的哪个月出手。
       （同时把全局月上限从 10 降到 6，进一步降低同月叠加概率） */
    var SPREAD_STATES = {};     /* 势力 -> 本轮轮到它出手的月份（0/1/2） */
    /* 本月智慧引擎排出的出征单，月末核对结果：
       出征记录是「决定出兵」，战斗记录才是「打完了」。两者对不上时（引擎延后执行、
       或这一仗没打成）要说清楚，否则玩家会以为出征没有结果。 */
    var PENDING_SORTIE = [];
    function checkSortieResults() {
        if (!PENDING_SORTIE.length) return [];
        var mk = monthKey(), out = [], i, s, hit = false, b;
        for (i = 0; i < PENDING_SORTIE.length; i++) {
            s = PENDING_SORTIE[i];
            if (s.month !== mk) continue;
            hit = false;
            for (b = 0; b < battleRosters.length; b++) {
                if (battleRosters[b].city === s.target && battleRosters[b].month === mk) { hit = true; break; }
            }
            if (!hit) out.push('攻' + cityName(s.target) + '（自' + cityName(s.src) + '）');
        }
        PENDING_SORTIE = [];
        if (out.length) {
            log('本月未见战果：' + out.join('、') + '（引擎延后执行或该仗未打成）');
            return [];
        }
        return [];
    }
    function noteAttackSrc(target, srcCity) {
        ATTACK_SRC[target] = { city: srcCity, month: monthKey() };
    }
    /* 战报里的「自 X 进攻」：优先用我们写单时记下的出发城，
       引擎自己发起的进攻则退而用攻方主帅当前所在城。 */
    function attackSrcTag(fp, atkPid) {
        try {
            if (!fp) return '自 未知 ';
            var tgt = fp.CityIndex;
            /* ① 我们自己写单时记下的 */
            var rec = ATTACK_SRC[tgt];
            if (rec && rec.month === monthKey()) return '自 ' + cityName(rec.city) + ' ';
            /* ② 引擎指令队列里攻这座城的单（引擎 AI 主动出击也会写单，能查到出发城） */
            try {
                var q = baye.data.g_OrderQueue, i;
                for (i = q.length - 1; i >= 0; i--) {
                    if (q[i] && q[i].OrderId === 27 && q[i].Object === tgt && q[i].City !== undefined
                        && q[i].City !== tgt) {
                        return '自 ' + cityName(q[i].City) + ' ';
                    }
                }
            } catch (e2) { }
            /* ③ 攻方主帅此刻所在城（兜底） */
            var pid = (atkPid !== undefined && atkPid >= 0) ? atkPid : (fp.GenArray[0] ? fp.GenArray[0] - 1 : -1);
            if (pid >= 0) {
                var from = cityOfPerson(pid);
                if (from !== 0xff) return '自 ' + cityName(from) + ' ';
            }
            /* ④ 行军途中/已撤离，出发城无从查证 —— 写「未知」保持格式统一 */
            return '自 未知 ';
        } catch (e3) { return '自 未知 '; }
    }

    function aiOccupyEmptyCities() {
        if (!flag('aiEmptyCity')) return;
        try {
            var cities = baye.data.g_Cities;
            var playerKing = baye.data.g_PlayerKing + 1;
            var occupied = 0, c, i, j;
            for (c = 0; c < cities.length && occupied < 2; c++) {
                var city = cities[c];
                if (city.Belong !== WILD) continue;              /* 只处理无主城 */
                if (rand(100) >= 50) continue;                   /* 概率性：每城每月 50%，像系统出征的随机手感 */
                var adj = adjOf(c);
                var srcCity = -1, srcKing = 0, best = -1, bestArms = 0;
                for (i = 0; i < adj.length; i++) {
                    var nc = cities[adj[i]];
                    if (!nc || nc.Belong <= 0 || nc.Belong === CAPTIVE) continue;
                    if (nc.Belong === playerKing) continue;      /* 玩家的城不代劳，自己打有乐趣 */
                    var list = personsOfCity(adj[i]);
                    for (j = 0; j < list.length; j++) {
                        var pp = personAt(list[j]);
                        if (!pp || pp.Belong !== nc.Belong) continue;
                        if ((pp.Arms || 0) > bestArms) { bestArms = pp.Arms; best = list[j]; srcCity = adj[i]; srcKing = nc.Belong; }
                    }
                }
                if (srcCity < 0 || best < 0 || bestArms < 500) continue;
                /* 派兵占领（原版打空城无战斗，直接改归属） */
                try { baye.deletePersonInCity(srcCity, best); } catch (e) { }
                placePerson(c, best);
                city.Belong = srcKing;
                city.SatrapId = best + 1;
                occupied++;
                log('空城占领：' + safeName(srcKing) + '军 ' + nameOf(best)
                    + ' 进驻空城 ' + cityName(c) + '（原属 ' + cityName(srcCity) + ' 出兵）');
            }
        } catch (e) { log('攻占空城异常', e); }
    }

    /* ---------- 5.7b 智慧引擎：让 AI 像人一样打仗 ----------
       每月（tacticStage2）对每个 AI 势力做一次完整的战略推演：
       ① 态势评估 —— 每座己方城算「威胁值」（相邻敌城能投入的战力，按 70% 且最多前 5 将折算，
          因为敌方自己也要留守）与「守备战力」（守军战力 × 城防系数），危险度 = 威胁 / 守备。
          都城（君主所在城）危险度权重加倍 —— 这就解决了「老家被掏了还几个月不管」。
       ② 回防调度 —— 危险度超标的城，从后方「安全城」抽调武将补防，直到守备 ≥ 威胁 × 安全系数。
          每座城至少留 1 人（都城留 2 人），避免抽空后方。
       ③ 出击决策 —— 自身安全且有富余的边境城，挑相邻敌城里「最软且最值钱」的目标
          （价值/防御 比最高），按守方战力配足兵力就打、配不够就不打 ——
          不再倾巢而出、不再硬啃硬骨头、不再「一大队沿路平推」。
       ④ 多线作战 —— 同一势力多座城可分别出击不同目标，不再只有一路。
       只代劳非玩家势力（玩家的城自己经营才有乐趣），与 aiOccupyEmptyCities 一致。
       开启后由智慧引擎接管 AI 出击决策（比战争频率的随机撮合聪明），战争频率自动让位。 */

    /* 单人战力估算（与 genPower 同源的简化版，不判地形，用于战略规划） */
    /* 战略推演的算力缓存（v1.11.7：君主多时「一个个算」会明显变慢。
       cityGenerals 每次都要遍历城内在册 + 按战力排序，而态势评估/回防/出击
       会在循环里反复调用同一座城 —— 用「本次推演内缓存 + 调兵后失效」把重复计算压掉。 */
    var GENS_CACHE = {}, GENS_SKIP = null, POW_CACHE = {};
    function clearPlanCache() { GENS_CACHE = {}; GENS_SKIP = null; POW_CACHE = {}; }

    function personPower(idx) {
        if (POW_CACHE[idx] !== undefined) return POW_CACHE[idx];
        var p = personAt(idx);
        if (!p || !p.Level || p.Level <= 0) return 0;
        var thew = (p.Thew === undefined ? 100 : p.Thew);
        var k = (0.8 * (p.Force || 0) + 0.3 * (p.IQ || 0) + (p.Level || 0)) / 100;
        var v = (p.Arms || 0) * (1 + safeWeight('wGen', 1) * k) * (thew / 100);
        POW_CACHE[idx] = v;
        return v;
    }

    /* 某城属于某势力的守军，按战力降序（本次推演内缓存） */
    function cityGenerals(c, king, skip) {
        if (GENS_SKIP !== skip) { GENS_CACHE = {}; GENS_SKIP = skip; }
        var key = c + '|' + king;
        if (GENS_CACHE[key]) return GENS_CACHE[key].slice();   /* 返回副本，调用方会 splice */
        var list = personsOfCity(c), out = [], i;
        for (i = 0; i < list.length; i++) {
            var p = personAt(list[i]);
            if (!p || p.Belong !== king) continue;
            if (!p.Level || p.Level <= 0) continue;
            if (skip && skip[list[i]]) continue;         /* 行军途中的人不参与调度 */
            out.push(list[i]);
        }
        out.sort(function (a, b) { return personPower(b) - personPower(a); });
        return out;
    }

    /* 某城守备战力（守军战力之和 × 城防系数） */
    function cityGuardPower(c, king, skip) {
        var g = cityGenerals(c, king, skip), i, sum = 0;
        for (i = 0; i < g.length; i++) sum += personPower(g[i]);
        return sum * cityDefFactor(c);
    }

    /* 相邻敌城对本城的威胁 */
    function cityThreat(c, king) {
        var cities = baye.data.g_Cities, adj = adjOf(c), i, j, t = 0;
        for (i = 0; i < adj.length; i++) {
            var nc = cities[adj[i]];
            if (!nc || nc.Belong <= 0 || nc.Belong === CAPTIVE || nc.Belong === king) continue;
            var g = cityGenerals(adj[i], nc.Belong), pw = 0;
            for (j = 0; j < g.length && j < 5; j++) pw += personPower(g[j]);
            t += pw * 0.7;                       /* 敌方也要留守，最多投入七成 */
        }
        return t;
    }

    /* 城池战略价值（越高越值得打） */
    function cityValue(c) {
        var city = cityAt(c);
        if (!city) return 1;
        var v = 1;
        v += Math.min(30, (city.Population || 0) / 8000);
        v += Math.min(15, (city.Money || 0) / 600);
        v += Math.min(15, (city.Food || 0) / 600);
        return v;
    }

    /* 正在行军途中的武将（已编入出征批次）：调兵遣将时要避开他们，
       否则会把在路上的人硬拉回城，引擎执行出征单时会找不到人。 */
    function busyFighters() {
        var busy = {}, idx = baye.data.FIGHTERS_IDX, f = baye.data.FIGHTERS, i, j;
        if (!idx || !f) return busy;
        for (i = 0; i < idx.length; i++) {
            if (!idx[i]) continue;
            for (j = 0; j < 10; j++) {
                var pid = f[i * 20 + j * 2] | (f[i * 20 + j * 2 + 1] << 8);
                if (pid) busy[pid - 1] = 1;
            }
        }
        return busy;
    }

    /* 写出征单（战争频率与智慧引擎共用） */
    var FGT_PLAMAX = 10;              /* 引擎每方最多 10 将（src/baye/fight.h） */
    function launchAttack(srcCity, target, team) {
        clearPlanCache();
        var idxArr = baye.data.FIGHTERS_IDX, fArr = baye.data.FIGHTERS;
        if (!idxArr || !fArr || !team || !team.length) return false;
        /* 硬约束：只能打「道路相连的相邻城池」。这张出征单是绕过引擎校验直接写进指令队列的，
           所以这里必须自己拦一道 —— 否则地图/城名对不上时会出现跨地图进攻。 */
        if (!isAdjacent(srcCity, target)) {
            log('拦截跨城进攻：' + cityName(srcCity) + '→' + cityName(target) + '（不相邻）');
            return false;
        }
        if (alreadyAttacked(target)) return false;
        if (team.length > FGT_PLAMAX) team = team.slice(0, FGT_PLAMAX);   /* 超出会被引擎静默丢弃 */
        var batch = -1, i;
        for (i = 0; i < idxArr.length; i++) if (!idxArr[i]) { batch = i; break; }
        if (batch < 0) return false;                        /* 出征批次已满 */
        writeFighters(fArr, batch, team);
        idxArr[batch] = 1;
        var q = baye.data.g_OrderQueue, no = -1;
        for (i = 0; i < q.length; i++) if (q[i].OrderId === 255) { no = i; break; }
        if (no < 0) return false;                           /* 指令队列已满 */
        var src = cityAt(srcCity);
        var o = q[no];
        o.OrderId = 27; o.Person = batch; o.City = srcCity; o.Object = target;
        o.Arms = 0; o.Food = src ? (src.Food || 0) : 0; o.Money = 0; o.Consume = 213; o.TimeCount = 0;
        markAttacked(target);
        noteAttackSrc(target, srcCity);
        return true;
    }

    /* 单个势力的月度战略推演。返回本月出击次数 */
    /* 本势力这个月能否主动进攻（时间维度闸门） */
    function warGateOpen(king) {
        var mk = gameMonthIndex();
        /* ① 开局冷静期：全局开局后的前 N 个月不主动进攻 */
        if (mk < WARMUP_MONTHS) return false;
        /* ② 冷却：距上次进攻不足 N 个月 */
        var last = WAR_LAST[king];
        if (last !== undefined && (mk - last) < WAR_COOLDOWN) return false;
        /* ③ 错月分散：把各势力摊到不同月份，避免同月多场战斗把横幅叠在一起 */
        var round3 = Math.floor(mk / 3);
        var want = ((Number(king) % 3) + 3) % 3;        /* 该势力本轮的目标月序 */
        if (SPREAD_STATES[king] !== round3) SPREAD_STATES[king] = round3;
        if ((mk % 3) !== want) return false;
        return true;
    }
    /* 全局月份序号（从 190 年 1 月算起），用于冷静期判断 */
    function gameMonthIndex() {
        var p = (baye.data.g_PIdx || 1);
        return (baye.data.g_YearDate - 190) * 12 + (baye.data.g_MonthDate || 1) + (p - 1) * 10000;
    }

    function smartPlan(king, level, maxSortie, budget, out) {
        var cities = baye.data.g_Cities;
        var mine = [], c, i, j;
        for (c = 0; c < cities.length; c++) if (cities[c].Belong === king) mine.push(c);
        if (!mine.length) return 0;

        /* 都城：君主所在城优先，其次人口最多的城 */
        var capital = -1, kingIdx = king - 1;
        var kc = cityOfPerson(kingIdx);
        if (kc !== 0xff && cities[kc] && cities[kc].Belong === king) capital = kc;
        if (capital < 0) {
            var bp = -1;
            for (i = 0; i < mine.length; i++) {
                var pop = cities[mine[i]].Population || 0;
                if (pop > bp) { bp = pop; capital = mine[i]; }
            }
        }

        var danger = {}, guard = {}, gens = {}, threat = {};
        var busy = busyFighters();                          /* 行军途中的人不动 */
        function refresh() {
            for (var m = 0; m < mine.length; m++) {
                var cc = mine[m];
                gens[cc] = cityGenerals(cc, king, busy);
                guard[cc] = cityGuardPower(cc, king, busy);
                threat[cc] = cityThreat(cc, king);
                danger[cc] = guard[cc] > 0 ? (threat[cc] / guard[cc]) : (threat[cc] > 0 ? 99 : 0);
                if (cc === capital && danger[cc] > 0) danger[cc] *= 2;   /* 都城权重加倍 */
            }
        }
        refresh();

        /* ② 回防：危险城从后方安全城抽调 */
        var needRatio = level === 2 ? 1.1 : 1.25;           /* 补足到 威胁 × 系数（留缓冲） */
        var order = mine.slice().sort(function (a, b) { return danger[b] - danger[a]; });
        var moved = [];
        for (i = 0; i < order.length; i++) {
            c = order[i];
            if (threat[c] <= 0) continue;
            var goal = threat[c] * needRatio;
            if (guard[c] >= goal) continue;
            /* 捐兵城：自身危险度低的先捐，且必须有多余人手 */
            var donors = [];
            for (j = 0; j < mine.length; j++) {
                var x = mine[j];
                if (x === c || danger[x] >= 0.5) continue;
                donors.push(x);
            }
            donors.sort(function (a, b) { return danger[a] - danger[b]; });
            for (j = 0; j < donors.length && guard[c] < goal; j++) {
                var src = donors[j];
                var sg = gens[src] || cityGenerals(src, king, busy);
                /* 都城只在真的受威胁时才多留一人，否则小势力会被自己的守备规则憋死 */
                var keep = (src === capital && danger[src] > 0.3) ? 2 : 1;
                while (sg.length > keep && guard[c] < goal) {
                    var who = sg.shift();
                    placePerson(c, who);
                    guard[c] += personPower(who);
                    moved.push(nameOf(who) + '(' + cityName(src) + '→' + cityName(c) + ')');
                }
                gens[src] = sg;
            }
            if (moved.length >= 12) break;                 /* 每月调兵上限，避免天下大搬家 */
        }
        if (moved.length) {
            log('回防：' + kingName(king) + ' ' + moved.slice(0, 4).join('、')
                + (moved.length > 4 ? ' 等 ' + moved.length + ' 人' : ''));
        }
        refresh();                                          /* 调兵后重新评估 */

        /* ③ 出击：自身安全 + 有富余 的城，挑最划算的目标 */
        var sortie = 0;
        var cands = mine.slice().sort(function (a, b) { return danger[a] - danger[b]; });
        /* ★ 时间闸门（用户要求）：再强势也不要第2 个月就打过来。
           放在出征循环内、只挡「主动进攻」；上面的回防逻辑完全不受影响。 */
        var canAttack = warGateOpen(king);
        for (i = 0; i < cands.length && sortie < maxSortie && sortie < budget; i++) {
            c = cands[i];
            if (!canAttack) break;                          /* 冷静期/冷却中 → 本月不主动打 */
            if (danger[c] > 0.85) continue;                 /* 自顾不暇，不打 */
            var gl = gens[c] || cityGenerals(c, king, busy);
            /* 同上：都城只在受威胁时才多留一人 */
            var keepC = (c === capital && danger[c] > 0.3) ? 2 : 1;
            if (gl.length <= keepC) continue;               /* 无人可调 */
            /* 挑目标：价值 ÷ 防御 最高，且打得动 */
            var adj = adjOf(c), bestT = -1, bestScore = -1;
            for (j = 0; j < adj.length; j++) {
                var tc = adj[j], nc = cities[tc];
                if (!nc || nc.Belong <= 0 || nc.Belong === CAPTIVE || nc.Belong === king) continue;
                var defP = cityGuardPower(tc, nc.Belong);
                /* 玩家与 AI 平等：同门槛，无新手保护。出征频率档位联动门槛：
                   越频繁越敢打，避免「势力均衡 → 谁都不过门槛 → 天下太平五年」的闷局 */
                /* 逐步加码：打过的次数越多，门槛越高（-0.06/次，最多 +0.3），
                   避免一个强国月月开打。 */
                var warCount = WAR_COUNT[king] || 0;
                var gate = Math.max(0.95, (level === 2 ? 1.15 : 1.35)
                    - (Number(cfg.warFreq) || 0) * 0.15 + Math.min(0.3, warCount * 0.06));
                var availP = 0, g2;
                for (g2 = 0; g2 < gl.length - keepC; g2++) availP += personPower(gl[g2]);
                if (availP < defP * gate) continue;         /* 打不动，跳过 */
                var score = cityValue(tc) / Math.max(1, defP);
                if (score > bestScore) { bestScore = score; bestT = tc; }
            }
            if (bestT < 0) continue;
            /* 配兵：从强到弱累加到够用为止，剩下的留守（不再倾巢而出） */
            var defP2 = cityGuardPower(bestT, cities[bestT].Belong);
            var gate2 = Math.max(0.95, (level === 2 ? 1.15 : 1.35)
                - (Number(cfg.warFreq) || 0) * 0.15 + Math.min(0.3, (WAR_COUNT[king] || 0) * 0.06));
            var team = [], pw = 0;
            for (j = 0; j < gl.length - keepC && team.length < FGT_PLAMAX; j++) {
                team.push(gl[j]);
                pw += personPower(gl[j]);
                if (team.length >= 2 && pw >= defP2 * gate2) break;
            }
            if (pw < defP2 * gate2) continue;
            if (launchAttack(c, bestT, team)) {
                sortie++;
                gens[c] = gl.slice(team.length);            /* 已编入军团，不再算守军 */
                guard[c] = cityGuardPower(c, king);
                /* ★ 记下本次进攻的时间与次数 → 冷却期 & 逐步加码的依据 */
                WAR_LAST[king] = gameMonthIndex();
                WAR_COUNT[king] = (WAR_COUNT[king] || 0) + 1;
                /* 记下目标，用于月末核对「出征后是否真的打了这一仗」 */
                PENDING_SORTIE.push({ target: bestT, src: c, month: monthKey() });
                log('出征：' + kingName(king) + ' 自 ' + cityName(c)
                    + ' 出兵 ' + team.length + ' 将 攻 ' + cityName(bestT));
            }
        }
        return sortie;
    }

    /* 智慧引擎主入口 */
    function smartEngine() {
        var level = Number(cfg.smartAI) || 0;
        if (level <= 0) return;
        try {
            clearPlanCache();                     /* 每次月度推演从干净缓存开始 */
            var cities = baye.data.g_Cities, playerKing = baye.data.g_PlayerKing + 1;
            var kings = {}, c;
            for (c = 0; c < cities.length; c++) {
                var b = cities[c].Belong;
                if (b <= 0 || b === CAPTIVE || b === playerKing) continue;
                kings[b] = 1;
            }
            var out = [];
            /* 出征频率（二级微调）：决定每月出击总量；智慧引擎档位决定激进程度 */
            var FREQ = [{ per: 1, glob: 3 }, { per: 2, glob: 4 }, { per: 3, glob: 6 }];   /* 上限从 10 降到 6：同月战斗越少，横幅越不容易叠 */
            var fq = FREQ[Math.max(0, Math.min(2, Number(cfg.warFreq) || 0))];
            var maxSortie = fq.per + (level === 2 ? 1 : 0);             /* 每势力每月出击数 */
            var budget = Math.round(fq.glob * (level === 2 ? 1.4 : 1)); /* 全局每月出击上限 */
            var ids = Object.keys(kings);
            /* 城少的势力先决策 —— 他们更需要回防 */
            ids.sort(function (a, b) {
                return ownCities(Number(a)).length - ownCities(Number(b)).length;
            });
            for (var i = 0; i < ids.length && budget > 0; i++) {
                budget -= smartPlan(Number(ids[i]), level, maxSortie, budget, out);
            }
            if (out.length) pushReport(out);
        } catch (e) {
            log('智慧引擎异常', e);
        }
    }

    /* ---------- 5.8 出征频率（智慧引擎二级微调） ----------
       原独立功能「战争频率」（随机撮合出兵）已并入智慧引擎：开启智慧引擎后由它统一
       决策打谁、派谁、派多少，出征频率只负责调「每月主动出击的总量」。 */
    /* 把武将名单写进出征批次：FIGHTERS 是 600 字节的 U8 数组（30 批 × 10 人 × 2 字节），
       PersonID 按小端 2 字节存放 —— 一个字节一个字节写，写完回读自校验。 */
    function writeFighters(fArr, batch, team) {
        var base = batch * 20, j, pid;
        for (j = 0; j < 10; j++) {
            pid = j < team.length ? (team[j] + 1) : 0;
            fArr[base + j * 2] = pid & 0xFF;
            fArr[base + j * 2 + 1] = (pid >> 8) & 0xFF;
        }
        /* 回读校验：解出来的第一个 PersonID 必须等于主将 */
        var back = (fArr[base] | (fArr[base + 1] << 8));
        if (team.length && back !== (team[0] + 1)) {
            log('出征批次写入校验失败：写入 ' + (team[0] + 1) + ' 读回 ' + back);
        }
        return back;
    }

    function onTacticStage2() {
        try { aiOccupyEmptyCities(); } catch (e) { }
        try {
            /* 智慧引擎接管全部 AI 战略；关闭 = 完全原版机制（不再有独立随机撮合出兵） */
            if (Number(cfg.smartAI) > 0) smartEngine();
        } catch (e) { }
        return undefined;
    }

    /* 新开局 / 读档：清空一切跨局状态（月报、阵亡台账、跟踪基线、快照、战斗名单）
       isNewGame=true 时额外清掉强化等级 —— 强化键是「武将下标_槽位」，新档的槽位上
       是完全不同的武将/道具，留着就是上一档的脏数据（用户反馈：新档残留上个档强化/阵亡）。 */
    function resetRunState(isNewGame) {
        info.monthReport.length = 0;
        deaths.length = 0;
        try { localStorage.removeItem(skey('deaths_v1')); } catch (e) { }
        TRACK.names = []; TRACK.inCity = [];
        SNAP = {};
        battleRosters = [];
        KING_SNAP = null;
        appliedOnce = false;
        diag.fightCountWinner = 0; diag.exitBattle = 0;
        diag.autoBattlesRecorded = 0; diag.applyDeathRate = 0; diag.deathsApplied = 0;
        if (isNewGame) {
            /* 新档：强化记录整表清掉（新档的「武将下标_槽位」与上一档无关） */
            var fc = 0;
            for (var fk in FORGE) { if (FORGE.hasOwnProperty(fk)) { fc++; } }
            FORGE = {};
            saveForge();
            if (fc) log('新开局：已清空上一档的强化记录 ' + fc + ' 条');
        } else {
            /* 读档：强化是长期投入，只校验槽位道具名是否还对得上（换档后自动丢弃失效记录） */
            forgeValidate();
        }
        PENDING_PLACE = {}; PENDING_SORTIE = []; BELONG_SNAP = null; DISASTER_SNAP = null;
        WAR_LAST = {}; WAR_COUNT = {};         /* 出征节奏：上次进攻月份 / 累计次数 */
        RACE_SEASON = 0; RACE_HISTORY = []; RACE_LAST_HELD = -1;
        ATTACKED.month = ''; ATTACKED.targets = {};
        ATTACK_SRC = {};                /* 进攻出发城台账 */
        log('已重置本局运行数据（月报/台账/跟踪基线' + (isNewGame ? '，强化记录已清空' : '') + '）');
    }

    /* ---------- v3.0：AI 势力自主强化（平衡的关键）----------
       问题：v2 只有玩家能强化 → 玩家 +20 时 AI 全是白板，实力差距被放大到失衡。

       做法：让每个 AI 势力也用自己的城池收入强化自己的武将。
       · 强化等级记在同一个 FORGE 表（键= 武将_槽位，与玩家共用结构）；
       · 预算上限：AI 每月强化次数 = 该势力城池数（城池越多越强，但增长缓慢）；
       · **等级滞后**：AI 最高只到「该势力城池数 + 6」级 —— 城池少的小势力练不高，
         玩家仍然可以靠经营超过它们（保留成长空间，不被 AI 反超）；
       · 真实消耗金币：AI 强化会真的扣掉该势力城池的钱，AI 的经济也会被拖慢
         （这就是天然的全局平衡器：AI 强了 → 出征变慢 → 你的压力下降）。

       平衡检查：一个 8 城的大势力每月 8 次强化机会，每次约 0.6 金（AI 按玩家的
       1/3 效率花钱），全势力月入 100+ 金 → 一年也就 100+ 次机会，
       想到 +12 需要约 80 次成功（含失败）→ 大约 1 年。玩家同样量级。相对平衡。 */
    /* pid = 武将下标（forgeKey 需要的是下标，不是对象 —— 之前传对象导致
       键变成 "[object Object]_0"，AI 的强化等级全部存丢，等于永远强化不上） */
    function aiForgeOnce(king, pid, slot, capLv) {
        try {
            var p = personAt(pid);
            if (!p) return 0;
            var rec = FORGE[forgeKey(pid, slot)] || { lv: 0, fail: 0, name: '' };
            if (rec.lv >= capLv) return 0;
            var tid1 = (p.Equip && p.Equip[slot]) || 0;
            var tid0 = tid1 ? tid1 - 1 : -1;
            if (tid0 < 0 || !toolForgeable(tid0)) {
                /* 该槽位没有可强化的装备 → 给他配一件（AI 武将普遍不带装备，
                   不配的话绝大多数 AI 将武永远强化不上，等于这个功能形同虚设） */
                var gid = aiGiveEquip(p, slot);
                if (!gid) return 0;
                tid1 = gid; tid0 = gid - 1;
            }
            var rarity = forgeRarity(tid0);
            if (rarity <= 0) return 0;
            var cost = Math.round(forgeCost(rec.lv, rarity) * AI_FORGE_COST_RATE);
            if (cost < 1) return 0;
            /* 扣钱：从该势力所有城池里找钱够的 */
            var cities = ownCities(king), i, c, city;
            for (i = 0; i < cities.length; i++) {
                city = cityAt(cities[i]);
                if (city && (Number(city.Money) || 0) >= cost) {
                    city.Money = (Number(city.Money) || 0) - cost;
                    break;
                }
            }
            if (i >= cities.length) return 0;         /* 全势力都掏不出 → 下个月再说 */
            /* 成功率比玩家低一档（AI 不该比玩家强） */
            var rate = Math.max(2, forgeRateAt(rec.lv) - AI_FORGE_RATE_PENALTY);
            if (Math.random() * 100 >= rate) {
                rec.fail = (rec.fail || 0) + 1;
                if (rec.lv < FORGE_SAFE_LV) rec.lv = Math.max(0, rec.lv - 1);
                FORGE[forgeKey(pid, slot)] = { lv: rec.lv, fail: rec.fail, name: rec.name };
                return -1;                            /* -1 = 失败 */
            }
            rec.lv = rec.lv + 1;
            rec.fail = 0;
            FORGE[forgeKey(pid, slot)] = { lv: rec.lv, fail: rec.fail, name: rec.name };
            return 1;
        } catch (e) { return 0; }
    }
    /* 给 AI 武将的指定槽位配一件可强化的装备（从道具表里找属性和够高的） */
    function aiGiveEquip(p, slot, wantMount, exclude) {
        try {
            var tools = baye.data.g_Tools, i, t, score, nm2, cand = [];
            var skip = exclude || null;
            for (i = 1; i < tools.length && i < 200; i++) {
                t = tools[i];
                if (!t || t.useflag) continue;
                score = (t.at || 0) * 2 + (t.iq || 0) + (t.move || 0);
                if (score <= 0) continue;
                if (wantMount) {
                    /* 要坐骑：只在 29 匹战马里挑（文档清单） */
                    try { nm2 = gbkSafe(baye.getToolName(i)) || ''; } catch (e3) { nm2 = ''; }
                    if (!isMountName(nm2)) continue;
                    /* ★ 排除已分配过的坐骑名（道具下标是共享的，
                       不按名字去重就会「多个势力拿到同一款」） */
                    if (skip && skip[nm2]) continue;
                } else if (toolTypeName(i) === '纯坐骑') {
                    continue;                                   /* 兵器/兵书：不要纯坐骑 */
                }
                cand.push(i);
            }
            if (!cand.length) return 0;
            /* ★ 随机取，不能「取最高分」—— 否则每次都挑同一件道具，
               会让所有势力都拿到同款（实测 6 匹马里出现 3 匹的卢）。
               坐骑：纯随机；兵器/兵书：在最高分档里随机。 */
            var best;
            if (wantMount) {
                best = cand[rand(cand.length)];
            } else {
                var top = [], maxSc = -1, tt2, sc2;
                for (i = 0; i < cand.length; i++) {
                    tt2 = tools[cand[i]];
                    sc2 = (tt2.at || 0) * 2 + (tt2.iq || 0) + (tt2.move || 0);
                    if (sc2 > maxSc) { maxSc = sc2; top = [cand[i]]; }
                    else if (sc2 === maxSc) top.push(cand[i]);
                }
                best = top.length ? top[rand(top.length)] : cand[rand(cand.length)];
            }
            if (!p.Equip) p.Equip = [0, 0];
            p.Equip[slot] = best + 1;
            return best + 1;
        } catch (e) { return 0; }
    }

    /* AI 强化：每月给所有 AI 势力跑一遍 */
    var AI_FORGE_COST_RATE = 0.34;   /* AI 花钱只按 34% 计价（它们的效率低于玩家） */
    var AI_FORGE_RATE_PENALTY = 8;   /* AI 成功率比玩家低 8 个百分点 */
    /* 给 AI 势力配坐骑：v1.20.4 起赛马只认「真实在武将身上的马」，
       所以 AI 势力也得真的有几匹马。每势力最多 2匹（挂在不同武将上），
       坐骑名从 29 匹里随机（全局唯一，已分配过的不再给）。 */
    /* 已发过坐骑的势力（记在 localStorage，跟档走）—— 每月重复发放会累积出
       同名马（实测出现两个势力的里飞沙），所以每个势力只发一次。 */
    var AI_MOUNT_DONE = null;
    function aiMountDone() {
        if (AI_MOUNT_DONE) return AI_MOUNT_DONE;
        AI_MOUNT_DONE = {};
        try {
            var raw = localStorage.getItem(skey('aimount_v1'));
            if (raw) AI_MOUNT_DONE = JSON.parse(raw) || {};
        } catch (e) { AI_MOUNT_DONE = {}; }
        return AI_MOUNT_DONE = AI_MOUNT_DONE || {};
    }
    function saveAiMount() {
        try { localStorage.setItem(skey('aimount_v1'), JSON.stringify(AI_MOUNT_DONE || {})); } catch (e) { }
    }
    function aiGiveMounts() {
        if (!flag('raceOn')) return 0;
        var DONE = aiMountDone();
        var cities = baye.data.g_Cities, persons = baye.data.g_Persons;
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        /* 先收集已经被占用的马名（玩家 + 已有AI 马），保证全局唯一 */
        var used = {}, i, s2, tid0, nm, t, p;
        for (i = 0; i < persons.length; i++) {
            p = persons[i];
            if (!p || !p.Level || p.Level <= 0 || !p.Equip) continue;
            for (s2 = 0; s2 < 2; s2++) {
                if (!p.Equip[s2]) continue;
                tid0 = p.Equip[s2] - 1;
                t = baye.data.g_Tools[tid0];
                if (!t) continue;
                try { nm = gbkSafe(baye.getToolName(tid0)) || ''; } catch (e) { nm = ''; }
                if (isMountName(nm)) used[nm] = 1;
            }
        }
        var free = [];
        for (i = 0; i < MOUNT_NAMES.length; i++) if (!used[MOUNT_NAMES[i]]) free.push(MOUNT_NAMES[i]);
        if (!free.length) return 0;
        var given = 0;
        for (i = 0; i < cities.length && free.length; i++) {
            var c = cities[i];
            if (!c || c.Belong <= 0 || c.Belong === WILD || c.Belong === CAPTIVE) continue;
            if (c.Belong === myKing) continue;                /* 玩家自己的不碰 */
            if (DONE[c.Belong]) continue;                     /* 该势力已发过，不再重复发 */
            var list = personsOfCity(i);
            var got = 0;
            for (var j = 0; j < list.length && got < 2; j++) {
                var q = personAt(list[j]);
                if (!q || q.Belong !== c.Belong || !q.Level) continue;
                if (!q.Equip) q.Equip = [0, 0];
                /* 挑一个还空着的槽 */
                var slot = (q.Equip[0] ? (q.Equip[1] ? -1 : 1) : 0);
                if (slot < 0) continue;
                if (q.Equip[slot]) continue;
                /* 70% 概率给坐骑，30% 给兵器/兵书（让 AI 也有强化的装备） */
                if (Math.random() < 0.3 && free.length === 0) continue;
                var gid = aiGiveEquip(q, slot, true, used);
                if (!gid) { gid = aiGiveEquip(q, slot, false, null); }
                if (gid) {
                    try { nm = gbkSafe(baye.getToolName(gid - 1)) || ''; } catch (e4) { nm = ''; }
                    if (isMountName(nm)) {
                        used[nm] = 1;                 /* ★ 立刻标记，后续势力不再拿到同款 */
                        var at = free.indexOf(nm); if (at >= 0) free.splice(at, 1);
                    }
                    got++; given++;
                }
            }
            if (got > 0) { DONE[c.Belong] = 1; saveAiMount(); }   /* 打标：本势力不再发 */
        }
        return given;
    }

    function aiForgeAll() {
        if (!flag('aiForge')) return [];
        var persons = baye.data.g_Persons, kings = {}, i, notes = [];
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (p && p.Level > 0 && p.Belong > 0 && p.Belong !== CAPTIVE && p.Belong !== WILD) {
                kings[p.Belong] = 1;
            }
        }
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var ids = Object.keys(kings);
        for (var ki = 0; ki < ids.length; ki++) {
            var king = Number(ids[ki]);
            if (king === myKing) continue;                /* 玩家自己不参与 */
            var cities = ownCities(king);
            if (!cities.length) continue;
            /* 等级上限 = 城池数 + 6：小势力练不高，玩家仍可超越 */
            var capLv = Math.min(18, cities.length + 6);
            /* 每月强化次数 = 城池数（上限 8），但每城只能强化 1 个槽位 */
            var tries = Math.min(8, cities.length);
            var got = 0, fail = 0;
            for (var t = 0; t < tries; t++) {
                var city = cities[(t + monthKey().length) % cities.length];
                var list = personsOfCity(city);
                if (!list.length) continue;
                /* 优先强化已经高强的（集中资源），其次随机 */
                var bestP = -1, bestLv = -1, p2, lv2;
                for (var j = 0; j < list.length; j++) {
                    p2 = list[j];
                    var P2 = personAt(p2);
                    /* ★ 必须校验归属：城里可能住着别势力的武将（战争/名册错列），
                       不校验的话 AI 会去强化玩家的武将，甚至强化在野武将 */
                    if (!P2 || p2 === 0 || P2.Belong !== king) continue;
                    lv2 = Math.max(forgeLv(p2, 0), forgeLv(p2, 1));
                    if (lv2 > bestLv) { bestLv = lv2; bestP = p2; }
                }
                if (bestP < 0) continue;
                var slot = forgeLv(bestP, 0) >= forgeLv(bestP, 1) ? 0 : 1;
                var r = aiForgeOnce(king, bestP, slot, capLv);
                if (r === 1) got++;
                else if (r === -1) fail++;
            }
            if (got + fail > 0 && flag('verbose')) {
                log('AI强化 ' + kingName(king) + '：成功 ' + got + ' 失败 ' + fail + '（等级上限 +' + capLv + '）');
            }
        }
        saveForge();
        return notes;
    }

    function onDidOpenNewGame() {
        /* 新开局：在第一次保存之前没有存档身份 → 回到临时槽 */
        CUR_SAVE_ACTIVE = '';
        resetRunState(true);
        refreshSlotBtns();
        return undefined;
    }

    function onDidLoadGame() {
        /* 读档：把「真正在玩的存档」定下来（此时引擎刚读完目标档与其配对档），
           数据槽随之切换 —— 全自动，玩家无需任何操作 */
        try { hookEngineSaveIO(); } catch (e) { }
        /* 换档：出征节奏重置（上一局的冷却/加码不该延续到新存档） */
        WAR_LAST = {}; WAR_COUNT = {};
        var seen = CUR_SAVE_SEEN;
        if (seen && CUR_SAVE_ACTIVE !== seen) {
            CUR_SAVE_ACTIVE = seen;
            onActiveSaveChanged(seen);
        } else {
            try { loadSlotData(true); } catch (e2) { }
        }
        /* 「全员满级」是读档即生效的（不是每月累积），所以放在这里 */
        try { if (flag('levelBoostAll')) levelUpAll(false, true); } catch (e) { }
        resetRunState(false);
        return undefined;
    }
        setTimeout(function () { try { selfCheckFlags(); } catch (e) { } }, 800);

    /* ---------- 启动自检：把「开关没生效」这类问题直接暴露在控制台 ----------
       教训（v1.20）：raceOn / aiForge 因为没写进 DEFAULT_CFG，flag() 一直返回falsy，
       赛马和 AI 强化**从头到尾没运行过**，而界面上完全看不出异常。
       现在每次读档都核对一遍「UI 里列出的开关」是否都在默认表里有值。 */
    function selfCheckFlags() {
        try {
            var missing = [], i, k;
            if (typeof UI_ROWS === 'undefined' || !UI_ROWS) return missing;   /* UI_ROWS 声明在后面，运行时可能还没到*/
            for (i = 0; i < UI_ROWS.length; i++) {
                k = UI_ROWS[i].k;
                if (typeof DEFAULT_CFG[k] === 'undefined') missing.push(k);
            }
            if (missing.length) {
                log('★ 自检：以下开关缺少默认值，功能处于关闭状态 → ' + missing.join(', ')
                    + '（请在设置里手动打开一次）');
            }
            if (typeof raceSeason === 'function' && flag('raceOn')) log('自检：赛马大会已开启，本月第 '
                + (baye.data.g_MonthDate || 1) + ' 月，当前第 ' + (raceSeason() + 1)
                + ' 届，' + (RACE_LAST_HELD === raceSeason() ? '本届已办过' : '本届还没办（月末自动举办）'));
            return missing;
        } catch (e) { return []; }
    }


    function onTacticStage5() {
        var notes = [];
        /* 君主归位（v1.11.4）：战斗期间只从战败城摘人、投进自己城池的动作统一挪到月末。
           同样卡在 lib 的 tacticStage5 之前执行（wrapHook 先跑本函数再跑原钩子）。 */
        try { notes = notes.concat(flushPendingPlace(false) || []); } catch (e) { log('君主归位异常', e); }
        /* 必须在 lib 的 tacticStage5「敌方俘虏入城」之前把君主放回去 ——
           wrapHook 先跑本函数再跑原钩子，正好卡在这个位置。 */
        /* 先记下月结前的资源值：引擎这一步会把超过 30000 的部分夹掉，
           记下来才能在下月初把差额结转回去（真·解除上限） */
        try { notes = notes.concat(rollbackCapturedKings(false) || []); } catch (e) { log('君主回滚异常', e); }
        /* 战死概率抽取（倍率>0 时）+ 阵亡检测 */
        try {
            var dead = applyDeathRate();
            dead = dead.concat(detectDeaths());
            if (dead.length) notes.push('【阵亡】' + dead.join('、'));
        } catch (e) { log('阵亡检测异常', e); }
        /* 资源包：一夜暴富 / 道具全收 / 经验注入（月结时统一执行并记月报） */
        try { notes = notes.concat(monthlyBoon() || []); } catch (e2) { log('资源包异常', e2); }
        /* 出征结果核对：出征记录是决定出兵，战斗记录才是结果；对不上要说明 */
        try { notes = notes.concat(checkSortieResults() || []); } catch (e3) { }
        /* 赛马大会 v2：每 3 个月（3/6/9/12 月）月末自动举办。
           ★ 关键修复：原来只把结果塞进月报，玩家完全看不到（用户反馈「压根没举办」）。
           现在月末弹窗播报「赛况动画 + 完整排名」，弹窗点确认后才回到游戏。*/
        try {
            if (flag('raceOn')) {
                /* ★★ 月末时序（v1.20.3 修，用户实测「2、3 月都举办、次年 2 月报错」）：
                     tacticStage5 跑在引擎月结**之前**，所以此刻 g_MonthDate 还是「当月」。
                     而 raceSeason() 用的是 gameMonthIndex()（含 g_MonthDate）——
                     于是 2 月末时 season 已经跨到下一届，判定「该办」，
                     结果变成 **2/5/8/11 月末**举办（玩家看到的就是「2 月也办」）。
                   正确做法：赛季号要用「**下一个月**」算，即 (md + 1) 对齐 3/6/9/12 月末。
                   例：2 月末 → seasonOf(3) → floor(3/3)=1；3 月末 → seasonOf(4)=1 → 与上次相同 → 不办。*/
                /* ★ 用「显式赛马月」判断（v1.20.3 定稿）：
                   tacticStage5 跑在引擎月结之前，g_MonthDate 就是当月 —— 所以
                   直接判 md % 3 === 0（即 3/6/9/12 月末）最直白、最不会错。
                   之前用赛季号 floor((mk+1)/3) 是错的：赛季号在季首月就跳变，
                   导致 2/5/8/11 月末被误判成「新赛季开始」而提前办赛。
                   RACE_COUNT 做二次兜底：同一个月绝不可能办两届。 */
                var md = baye.data.g_MonthDate || 0;
                if (md > 0 && md % 3 === 0 && RACE_LAST_MD !== md) {
                    var rr = raceRunOne(raceSeason());
                    RACE_LAST_MD = md;                      /* 记录本月（防重复） */
                    RACE_ENTRY = [];                        /* 本届结束清空报名 */
                    /* 结果写月报（月报是文字版）+ 弹窗（动画版，一次只显示一段） */
                    notes = notes.concat(rr.lines || []);
                    /* 走 UI 队列：避免与同月其他弹窗（提醒/自检）撞在一起 */
                    uiQueue(function (next) {
                        try { playRaceAnim(rr.anim || [], rr.lines || [], next); }
                        catch (e5) { log('赛马弹窗失败', e5); next && next(); }
                    });
                }
            }
        } catch (e4) { log('赛马大会异常', e4); }
        if (notes.length) pushReport(notes);
        /* 资源补正：引擎的月结（Money=1+Money+Commerce/2.5 并夹到 30000）跑在所有钩子之后，
           所以这里补等于白补。延迟到月结完成后再写 —— 这是「30175 又变回30000」的真正原因。 */
        if (flag('noResCap')) {
            /* 在「钱还没被引擎削」的时刻记下每座城的额度。
               引擎月结跑在所有钩子之后 → 真正的恢复放到下月 tacticStage1。*/
            recordResBase();
        }
        return undefined;
    }
    function resMoneySnapshot() {
        var mine = ownCities((baye.data.g_PlayerKing || 0) + 1), m = {}, i;
        for (i = 0; i < mine.length; i++) {
            var city = cityAt(mine[i]);
            if (city) m[mine[i]] = Number(city.Money) || 0;
        }
        return m;
    }

    /* ======================== 6. 需求2：菜单功能 ========================
       挂在引擎的「帮助」入口 showMainHelp（游戏内帮助键）。原钩子存在时，先跑我们的
       菜单，取消后再交给原逻辑。 */

    var info = {
        monthReport: [],
        lastSnapshot: {},
        version: '金手指 v' + CHEAT_VERSION + ' · 适配 balance2.01 / balance2.01-max'
    };

    function onShowMainHelp() {
        var items = ['查看月报', '势力分布', '装备分布', '武力排行', '智力排行',
            '宝物图鉴', '武将跟踪', '武将修复', '铁匠铺', '马厩', '资源管理', '显示版本'];
        var hasOrigin = !!wrappedHooks.showMainHelp;
        if (hasOrigin) items.push('原版帮助');
        /* 主菜单用小窗（56x66），和霸哥版手感一致 —— 别占满屏 */
        baye.centerChoose(56, 66, safeItems(items), 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            try {
                if (ind === 0) showMonthReport();
                else if (ind === 1) showDistribution('power');
                else if (ind === 2) showDistribution('tool');
                else if (ind === 3) menu(rankBy('Force'));
                else if (ind === 4) menu(rankBy('IQ'));
                else if (ind === 5) menu(toolCodex());
                else if (ind === 6) menu(trackPersons());
                else if (ind === 7) repairPersonDialog();
                else if (ind === 8) showForge();
                else if (ind === 9) stableDialog();
                else if (ind === 10) showResourceMenu();
                else if (ind === 11) showVersion();
                else if (ind === 12 && hasOrigin) wrappedHooks.showMainHelp.apply(baye.hooks, [undefined]);
            } catch (e) {
                log('菜单项异常', e);
                alert2('执行出错：' + e.message);
            }
        });
        return 0;         /* 0 = 已处理；原版帮助通过最后一项进入 */
    }

    /* 月报：只列记录，不加说明（玩家要的是简洁，看不懂说明说明程序有问题） */
    function showMonthReport() {
        menu(info.monthReport.length ? info.monthReport : ['（暂无记录）']);
    }

    /* 每行别超过 30 个半角（引擎会把超宽行自动折行，列表会乱） */
    function showVersion() {
        menu([
            '金手指 v' + CHEAT_VERSION,
            '适配：三国战纪 / 修罗',
            '',
            '托管结算 fightCountWinner',
            '君主保护 exitBattle',
            '必成开关 willExecuteOrder',
            '阵亡快照 tacticStage1',
            '',
            '入口：右上角悬浮按钮'
        ]);
    }

    /* 势力分布 / 装备分布：左侧详情 + 右侧城池列表。
       布局必须按引擎实际分辨率算 —— 平衡版2.1 是 208x128，
       之前照抄霸哥版的 209/225/135 坐标全跑到了屏幕外面，所以什么都看不见。 */
    function showDistribution(kind) {
        var cities = baye.data.g_Cities;
        var names = [], i;
        for (i = 0; i < cities.length; i++) names.push(cityName(i));

        var listW = 24;                          /* 右侧列表宽：2 个汉字/行，同霸哥版 */
        var listX = SW() - listW - 2;
        var pad2 = 3;
        /* LCD 字库半角 6px、全角 12px：详情区每行可容纳的半角数 = 可用像素 / 6
           （之前把像素宽直接当半角数用，折行完全没生效，长行溢出压到列表上） */
        var innerHalf = Math.floor((listX - pad2 * 2) / 6);
        var lineH = 13;
        var maxLines = Math.floor((SH() - 8) / lineH);

        function detail(index) {
            var w = SW(), h = SH();
            baye.clearRect(0, 0, w, h);
            baye.drawRect(0, 0, w, h);
            baye.drawRect(2, 2, w - 3, h - 3);
            var lines = kind === 'power' ? cityPowerLines(index, innerHalf) : cityToolLines(index);
            var y = pad2, k, j;
            for (k = 0; k < lines.length && y < h - 6; k++) {
                var wrapped = wrapLines(lines[k], innerHalf);
                for (j = 0; j < wrapped.length && y < h - 6; j++) {
                    drawText2(pad2, y, wrapped[j]);
                    y += lineH;
                }
            }
        }

        /* willChangeMenuSelection 是全局单例，必须在 willCloseMenu 里清掉 */
        /* 幂等：若上一次菜单的钩子还没被引擎清掉（玩家中途切界面），先还原，避免包装套娃 */
        if (baye.hooks.willCloseMenu && baye.hooks.willCloseMenu.__bayeCheatMenu) {
            baye.hooks.willCloseMenu = baye.hooks.willCloseMenu.__prev || undefined;
        }
        var oldClose = baye.hooks.willCloseMenu;
        baye.hooks.willChangeMenuSelection = function (option) {
            if (option && option.index !== 65535) { baye.clearScreen(); detail(option.index); }
        };
        var closeWrap = function () {
            baye.hooks.willChangeMenuSelection = undefined;
            baye.hooks.willCloseMenu = oldClose;
            if (oldClose) oldClose.apply(this, arguments);
        };
        closeWrap.__bayeCheatMenu = 1;
        closeWrap.__prev = oldClose;
        baye.hooks.willCloseMenu = closeWrap;
        /* 顺序铁律：drawText/画框都会改写 g_asyncActionStringParam（引擎菜单的数据源），
           所以必须「先画详情、最后调 choose」—— 之前 detail(0) 放在 choose 之后，
           把菜单数据覆盖成了详情文本，右栏才会显示出一堆详情碎片。
           初始详情交给 willChangeMenuSelection 首次触发（与霸哥版一致）。 */
        baye.clearScreen();
        listView(listX, 4, listW, SH() - 8, names, 0, function (sid) {
            if (sid !== 65535) detail(sid);
        });
    }

    /* 名单完整列出（v1.11.1：不要「等共N人」，全部姓名列出，超宽自动折行） */
    function briefList(arr) {
        return arr.join('、');
    }

    /* maxHalf：详情区每行可容纳的半角数（由调用方按分辨率传入，默认菜单宽 30） */
    function cityPowerLines(c, maxHalf) {
        var W = maxHalf || MENU_MAX_HALF;
        var city = cityAt(c);
        var out = ['【' + cityName(c) + '】'];
        out.push('君主:' + safeName(city.Belong) + ' 太守:' + safeName(city.SatrapId));
        var gen = [], pris = [], wild = [];
        var list = personsOfCity(c);
        for (var i = 0; i < list.length; i++) {
            var p = personAt(list[i]);
            if (!p) continue;
            if (p.Belong === CAPTIVE) pris.push(nameOf(list[i]));
            else if (p.Belong === WILD) { if (p.Level > 0 && !(p.Force === 150 && p.IQ === 150)) wild.push(nameOf(list[i])); }
            else gen.push(nameOf(list[i]));
        }
        out = out.concat(wrapLines('武将' + gen.length + ':' + briefList(gen), W));
        out = out.concat(wrapLines('俘虏' + pris.length + ':' + briefList(pris), W));
        out = out.concat(wrapLines('在野' + wild.length + ':' + briefList(wild), W));
        out.push('粮:' + city.Food + ' 钱:' + city.Money);
        out.push('后备兵:' + city.MothballArms);
        return out;
    }

    function cityToolLines(c) {
        var city = cityAt(c);
        var out = ['【' + cityName(c) + '】装备'];
        var idle = [], eq = [];
        for (var i = city.ToolQueue; i < city.ToolQueue + city.Tools; i++) {
            var raw = baye.data.g_GoodsQueue[i];
            if (raw === undefined || raw === null) continue;
            var tid = raw & 0x7fff;            /* 0x8000 = 已发现标志（引擎 AddGoodsEx），不剥掉名字会越界 */
            var nm = gbkSafe(baye.getToolName(tid) || ('#' + tid));
            if (nm) idle.push(nm);
        }
        var list = personsOfCity(c);
        for (var j = 0; j < list.length; j++) {
            var p = personAt(list[j]);
            if (!p) continue;
            var t = [];
            /* 名称后缀强化等级（+N）—— 引擎道具本身没有这个字段，靠本脚本的 FORGE 表 */
            var lv0 = forgeLv(list[j], 0);
            var lv1 = forgeLv(list[j], 1);
            if (p.Equip[0]) t.push(gbkSafe(baye.getToolName(p.Equip[0] - 1)) + (lv0 > 0 ? ' +' + lv0 : ''));
            if (p.Equip[1]) t.push(gbkSafe(baye.getToolName(p.Equip[1] - 1)) + (lv1 > 0 ? ' +' + lv1 : ''));
            if (t.length) eq.push(t.join('+') + '(' + nameOf(list[j]) + ')');
        }
        out.push('闲置' + idle.length + ':' + briefList(idle, 4));
        out.push('已装' + eq.length + ':' + briefList(eq, 3));
        return out;
    }

    function safeName(id) {
        try { return baye.getPersonNameByID(id); } catch (e) { return '-'; }
    }
    /* ---------- 势力君主查询（v1.20.4 重写）----------
       引擎里的确定事实（源码实证）：
         city.SatrapId == g_PlayerKing + 1   ⇔  这座城是「君主所在城」
         city.SatrapId = personID + 1（新建城时写入）
       所以君主 = 「SatrapId 对得上」的那座城里的君主。
       之前的错法：假设「君主下标 = 势力编号 - 1」—— 势力编号是行政编号（1,2,11,12…），
       跟武将在 g_Persons 的下标毫无关系，必然查错。
       现在按引擎的真实规则来：遍历城池找 SatrapId === king 的，再取该城里的君主。 */
    /* 该势力的君主武将下标；找不到返回 -1 */
    function kingPid(king) {
        var k = Number(king);
        var cities = baye.data.g_Cities, persons = baye.data.g_Persons;
        var i, c, list, j, p;
        /* ① 优先：找 SatrapId === king 的城（君主所在城） */
        for (i = 0; i < cities.length; i++) {
            c = cities[i];
            if (!c || c.Belong !== k) continue;
            if (c.SatrapId !== k) continue;                 /* 不是君主所在城 */
            list = personsOfCity(i);
            for (j = 0; j < list.length; j++) {
                p = personAt(list[j]);
                if (!p || p.Belong !== k) continue;
                if (p.Level <= 0) continue;
                return list[j];                             /* 君主所在城里的第一个本势力武将 */
            }
        }
        /* ② 兜底：全势力扫，取等级最高者 */
        var best = -1, bestLv = -1;
        for (i = 0; i < persons.length; i++) {
            p = persons[i];
            if (!p || p.Level <= 0 || p.Belong !== k) continue;
            if (p.Belong === WILD || p.Belong === CAPTIVE) continue;
            if (p.Level > bestLv) { bestLv = p.Level; best = i; }
        }
        return best;
    }
    /* 势力编号 → 君主名字 */
    function kingName(king) {
        try {
            var pid = kingPid(king);
            return pid >= 0 ? nameOf(pid) : ('势力' + king);
        } catch (e) { return '势力' + king; }
    }

    function rankBy(field) {
        var persons = baye.data.g_Persons, arr = [], i;
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p[field] || p[field] <= 0) continue;
            arr.push({ n: nameOf(i), v: p[field] });
        }
        arr.sort(function (a, b) { return b.v - a.v; });
        var out = [pad('  姓名', 16) + (field === 'Force' ? '武力值' : '智力值')];
        for (i = 0; i < arr.length; i++) out.push(pad(' ' + arr[i].n, 16) + arr[i].v);
        return out;
    }

    function toolCodex() {
        /* 不再遍历整张道具表 —— 表里大量槽位没有道具名，getToolName 会吐出
           “#32812” 这类内码垃圾。改为收集「当前地图上真实存在」的道具：
           各城闲置的 + 武将身上的，去重后附上属性。 */
        var seen = {}, out = [];
        var cities = baye.data.g_Cities, persons = baye.data.g_Persons, tools = baye.data.g_Tools;

        function collect(tid0) {                     /* tid0：0-based 道具下标（剥掉 0x8000 发现标志） */
            if (tid0 === undefined || tid0 === null) return;
            tid0 = tid0 & 0x7fff;
            if (tid0 < 0) return;
            var nm;
            try { nm = baye.getToolName(tid0); } catch (e) { return; }
            nm = gbkSafe(nm);
            if (!nm || seen[nm]) return;
            var t = tools[tid0];
            if (!t) return;
            seen[nm] = tid0;
        }

        var c, i, list, j;
        for (c = 0; c < cities.length; c++) {
            var city = cities[c];
            for (i = city.ToolQueue; i < city.ToolQueue + city.Tools; i++) {
                collect(baye.data.g_GoodsQueue[i]);
            }
            list = personsOfCity(c);
            for (j = 0; j < list.length; j++) {
                var p = personAt(list[j]);
                if (!p || !p.Equip) continue;
                if (p.Equip[0]) collect(p.Equip[0] - 1);   /* Equip 是 1-based */
                if (p.Equip[1]) collect(p.Equip[1] - 1);
            }
        }
        /* 在野/俘虏身上的也扫一遍（他们不在城里队列时装备还在身上） */
        for (i = 0; i < persons.length; i++) {
            var q = persons[i];
            if (!q || !q.Equip) continue;
            if (q.Belong !== WILD && q.Belong !== CAPTIVE) continue;
            if (q.Equip[0]) collect(q.Equip[0] - 1);
            if (q.Equip[1]) collect(q.Equip[1] - 1);
        }
        /* 按类型分组 + 主属性降序（用户要求）：
           有武力=兵器类，否则有智力=兵书类，否则有移动=坐骑类 */
        function typeOf(t) {
            if (t.at > 0) return 0;
            if (t.iq > 0) return 1;
            return 2;
        }
        var groups = [[], [], []];
        var names2 = {};
        for (var k in seen) {
            if (!seen.hasOwnProperty(k)) continue;
            var tid2 = seen[k];
            var t2 = tools[tid2];
            var label = gbkSafe(baye.getToolName(tid2));
            if (!label) continue;
            var parts = [];
            if (t2.at > 0) parts.push('武力+' + t2.at);
            if (t2.iq > 0) parts.push('智力+' + t2.iq);
            if (t2.move > 0) parts.push('移动+' + t2.move);
            /* 已强化的同名道具在图鉴里标 +N（取该道具所有槽位里的最高等级） */
            var bestLv = 0, bk;
            for (bk in FORGE) {
                if (!FORGE.hasOwnProperty(bk)) continue;
                var rr = FORGE[bk];
                if (rr && rr.name === label && rr.lv > bestLv) bestLv = rr.lv;
            }
            /* 使用类道具三项属性全0 → 不要拼出「名称:」这种空冒号（用户吐槽点） */
            var head = label + (bestLv > 0 ? ' +' + bestLv : '');
            var txt = parts.length ? (head + '　' + parts.join('')) : head;
            groups[typeOf(t2)].push({
                n: label, tid: tid2, at: t2.at || 0, iq: t2.iq || 0, mv: t2.move || 0,
                txt: txt
                    + (bestLv > 0 ? '　伤害+' + Math.round((forgeDmgMul(bestLv) - 1) * 100) + '%' : '')
            });
        }
        /* 分类与「可否强化」都按《平衡版2.1道具效果大全》的五类口径：
             效果类武器 / 兵书 / 使用类 / 坐骑 / 无效果武器
           前三类里可强化的是：效果武器、兵书、无效果武器（使用类是消耗品、坐骑无特效）。 */
        var CAT_ORDER = ['效果武器', '兵书', '无效果武器', '坐骑(车)', '坐骑', '混合坐骑', '使用类', '无属性', '未知'];
        /* 把原来三组的条目按文档分类重新归堆 */
        var allItems = groups[0].concat(groups[1], groups[2]);
        var sorted2 = [];
        for (var ci = 0; ci < CAT_ORDER.length; ci++) {
            var bucket = allItems.filter(function (it) { return toolCategory(it.tid) === CAT_ORDER[ci]; });
            if (!bucket.length) continue;
            bucket.sort(function (a, b3) {
                return (b3.at - a.at) || (b3.iq - a.iq) || (b3.mv - a.mv) || (a.n < b3.n ? -1 : 1);
            });
            sorted2.push({ cat: CAT_ORDER[ci], items: bucket });
        }
        var out2 = [];
        sorted2.forEach(function (grp) {
            var canF = grp.cat === '效果武器' || grp.cat === '兵书' || grp.cat === '无效果武器' || grp.cat === '混合坐骑';
            out2.push('【' + grp.cat + '】' + grp.items.length + ' 件'
                + (canF ? '　（可强化）' : (grp.cat === '使用类' ? '　（消耗品）' : '')));
            for (var q2 = 0; q2 < grp.items.length; q2++) out2.push(' ' + grp.items[q2].txt);
            out2.push('');
        });
        if (!sorted2.length) return ['（当前地图上没有道具）'];
        return out2;
    }

    /* 武将跟踪：逐月比对，列出消失/新增/换城的武将 + 阵亡台账。
       口径说明：在城武将 = 此刻在城池队列里的有效人物；未登场 = 剧本有效但不在任何
       城池（未成年的孙策/孙权、特定年份才自动出现的马岱/侯选，他们被引擎挂在
       登场计划表里，不在城的 lostPersons 池），这些不是丢失。 */
    var TRACK = { names: [], inCity: [] };

    function trackPersons() {
        var persons = baye.data.g_Persons, cities = baye.data.g_Cities;
        var names = [], inCity = [], i, c;
        /* 人 -> 城 反查 */
        var where = {};
        for (c = 0; c < cities.length; c++) {
            var list = personsOfCity(c);
            for (i = 0; i < list.length; i++) where[list[i]] = c;
        }
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0) continue;
            var nm = nameOf(i);
            if (where[i] !== undefined) {
                names.push(nm);
                inCity.push(nm + '(' + cityName(where[i]) + ')');
            }
        }
        /* 未登场 = 剧本有效人物但不在任何城池队列 */
        var notYet = [], seenName = {}, k;
        for (k = 0; k < names.length; k++) seenName[names[k]] = 1;
        for (i = 0; i < persons.length; i++) {
            var q = persons[i];
            if (!q || !q.Level || q.Level <= 0) continue;
            if (where[i] !== undefined) continue;
            var n2 = nameOf(i);
            if (n2 && !seenName[n2]) { seenName[n2] = 1; notYet.push(n2); }
        }
        names.sort(); inCity.sort(); notYet.sort();
        var out = [monthKey().replace('-', '年') + '月 · 在城 ' + names.length
            + ' · 未登场 ' + notYet.length
            + ' · 阵亡' + deaths.length];
        /* 未登场全员名单（用户要求直接列人：含未成年的孙策/孙权、特定年份才出现的马岱/侯选，
           以及作者彩蛋「通宵虫」「南方小鬼」—— 他们武力智力都是 150，此前被误当占位数据过滤）。
           v1.11.7：原先一人一行，君主多时列表能到几百行，引擎逐行渲染卡到半天没反应；
           现在按每行 30 个半角自动打包，一行能放好几个名字，整体行数降到个位数。 */
        if (notYet.length) {
            out.push('【未登场 ' + notYet.length + ' 人】');
            var packed = packNames(notYet, MENU_MAX_HALF);
            for (k = 0; k < packed.length && out.length < 40; k++) out.push(' ' + packed[k]);
        }
        if (deaths.length) {
            out.push('【阵亡台账】共 ' + deaths.length + ' 人');
            for (k = deaths.length - 1; k >= 0 && out.length < 46; k--) {
                out.push(' ' + deaths[k].name + '(' + deaths[k].king + ')'
                    + ' ' + deaths[k].city + ' ' + deaths[k].date);
            }
        }
        if (TRACK.names.length) {
            var gone = diff(TRACK.names, names), add = diff(names, TRACK.names);
            var openCity = diff(TRACK.inCity, inCity), moveCity = diff(inCity, TRACK.inCity);
            if (gone.length) log('武将跟踪·本月消失：' + briefList(gone, 10));
            if (add.length) log('武将跟踪·新增：' + briefList(add, 10));
            if (openCity.length) log('武将跟踪·离开：' + briefList(openCity, 6));
            if (moveCity.length) log('武将跟踪·迁入：' + briefList(moveCity, 6));
        } else {
            out.push('（首次记录基线，下月起可查看变化）');
        }
        TRACK.names = names; TRACK.inCity = inCity;
        return out;
    }

    function diff(a, b) {
        var out = [];
        for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) out.push(a[i]);
        return out;
    }

    /* 武将修复：列出「疑似阵亡/消失」的武将，由玩家逐个选择找回（不再是一个开关）。
       候选 = 阵亡台账 ∪ 上月快照在城、现在消失的人。 */
    function repairPersonDialog() {
        var candidates = {}, order = [];
        var i;
        for (i = 0; i < deaths.length; i++) {
            if (candidates[deaths[i].pid] === undefined) {
                candidates[deaths[i].pid] = deaths[i];
                order.push(deaths[i].pid);
            }
        }
        /* 上月快照在城、现在消失的（不含俘虏/在野） */
        var cities = baye.data.g_Cities, where = {}, c;
        for (c = 0; c < cities.length; c++) {
            var list = personsOfCity(c);
            for (i = 0; i < list.length; i++) where[list[i]] = c;
        }
        for (i in SNAP) {
            if (!SNAP.hasOwnProperty(i)) continue;
            i = i | 0;
            if (where[i] !== undefined || candidates[i] !== undefined) continue;
            var s = SNAP[i];
            if (s.city === undefined) continue;
            if (s.belong === WILD || s.belong === CAPTIVE) continue;
            var p = personAt(i);
            if (!p || p.Belong === CAPTIVE) continue;
            candidates[i] = { pid: i, name: nameOf(i), king: safeName(s.belong), city: cityName(s.city), date: monthKey().replace('-', '年') + '月' };
            order.push(i);
        }
        if (!order.length) {
            alert2('没有可找回的武将。\n（有武将阵亡时会自动记入台账，这里就能选人找回）');
            return;
        }
        var items = [], pidList = [];
        for (i = 0; i < order.length; i++) {
            var d = candidates[order[i]];
            items.push(d.name + ' ' + d.king + ' ' + d.city + ' ' + d.date);
            pidList.push(d.pid);
        }
        menu(items, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            var msg = rescueOne(pidList[ind]);
            /* alert 与菜单都是引擎的异步 UI，必须串行：确认完提示再弹下一个选择 */
            try { baye.alert(gbkSafe(msg), function () { repairPersonDialog(); }); } catch (e) { }
        });
    }




    /* ======================== 7.5 铁匠铺（装备强化 · DNF 式） ========================
       设计要点（三国霸业适配，与 DNF 的差异都经过权衡）：

       1) 不改引擎面板。用户要求「强化不直接增加装备武力/智力」——
          引擎的 g_Tools[tid].at/iq 是全局静态表，一旦改了会同时污染：
          ① 别人的同款装备（AI 武将 / 其他玩家城里的闲置道具全都变强）；
          ② 存档里的道具详情显示（原版道具面板会多出数值，玩家看到的是"外挂改数"）。
          所以强化等级记在本地 FORGE 表（localStorage），按「道具名 + 武将槽位」索引，
          引擎数据一个字节都不动。

       2) 加成走「伤害系数」而不是「面板数值」。原版伤害公式（lib 的 countAttackHurt）：
              hurt = at / df * (Arms >> 3) * 克制度
          at 里已经含装备武力，所以直接加 at 会和兵力(>>3)产生乘积放大，
          高强武器会让伤害指数爆炸。这里改成在公式外面乘一个温和的系数：

              最终伤害 = 原版伤害 × forgeDmgMul(等级)

          forgeDmgMul 用「饱和曲线」而不是线性：
              mul(L) = 1 + L × FORGE_STEP × (1 + FORGE_GROWTH × L)   ← v2，永不饱和
          好处：低等级收益明显（+1 就有感），高等级收益递减（+13 接近上限），
          不会出现「+1 变强 2%、+13 变强 200%」的失控曲线，也不会让一件武器
          盖过武将本身的武力/智力差异（武将素质差异是 0.8*武力+0.3*智力，
          +13 大约只等于一个中等武将的加成）。

       3) 费用与成功率按 DNF 的「越高越贵、越高越难」：
          费用   = 30 × 稀有度系数(1.0~2.2) × (等级+1)^1.3
          成功率 = 高等级递减，且 +10 后进入「噩梦区」
          失败掉 1 级（用户指定）+ 连败 5 次保底 + **+8 起高阶保护（失败不降级）**。
          高阶保护是必需的：蒙特卡洛实测显示，只有「掉级」没有「保护」时，
          +13 的期望花费是 597 万金 / 2.7 万个月 —— 玩家永远打不到顶。

       4) 只强化「装备类」道具（useflag=0），消耗品（useflag=1）不参与。 */

    var FORGE_KEY = 'baye_cheat_forge_v1';      /* 旧键（仅用于一次性迁移） */
    /* ================= 强化系统 v3.0（无上限 · 全势力可强化）=================
       v2 的两个问题（用户指出）：
         ① +20 就封顶，限制了高强玩法；
         ② **只有玩家能强化 → 玩家到 +20 就是碾压**，AI 全是白板。

       v3 的设计（参考 DNF / 梦幻 / 天牢的成熟做法）：

       【原则一】等级不设上限，收益永不归零
         +1~+20 陡升段（每级增量 5%→16%），+20 之后缓升段（每级仍 +1.2%）。
         「追求极致」始终有回报，但边际递减。

       【原则二】费用指数增长 —— 这是平衡的主闸门
         费用 = 40 × 稀有度 × 1.32^等级（封顶单城可承受范围）。
         收益线性、费用指数 → 高等级自然变成"奢侈品"。
         按引擎经济（单城月入≈10 金，全势力 100~300 金/月）折算：
           +10 单次约 900 金 ≈ 全势力 1 年收入；
           +20 单次约 4500 金 ≈ 3 年；
           +30 单次约 22000 金 ≈ 15 年。
         → 自然形成「普遍 +10、精英 +20、极限 +30」的分层，不会遍地高强。

       【原则三】全势力共享同一套强化经济（AI 也强化）
         智慧引擎每月给各势力分配「强化预算」，AI 用自己的城池收入强化自己的武将。
         玩家 +20 时 AI 也在成长 → **相对平衡**，且世界看起来真实。

       【原则四】防刷分
         每人最多 2 件装备参与计算（取最高的一件）—— 已实现，
         避免"一人两把高强 = 双倍战力"的失控。 */

    /* 等级不设上限：用「费用指数」自然锁死，999 仅为读档容错软顶 */
    var FORGE_MAX = 999;
    var FORGE_SOFT_CAP = 20;         /* 收益分段拐点：+20 后进入缓升段 */

    var FORGE_BASE_COST = 40;        /* +1 的费用（普通兵器，稀有度 1.0） */
    var FORGE_COST_RATIO = 1.32;     /* 每级费用倍率（指数增长 = 平衡主闸门） */
    var FORGE_COST_MAX = 30000;      /* 单次费用封顶 = 单城金币上限 */

    /* 收益两段：+1~+20 陡升= 1 + L×0.05×(1+0.055L)
                +20 之后缓升 = 每级 +1.2%（永不归零） */
    var FORGE_STEP = 0.05;           /* 陡升段每级基础增量 */
    var FORGE_GROWTH = 0.055;        /* 陡升段的二次修正 */
    var FORGE_TAIL_STEP = 0.012;     /* 缓升段每级增量（永不归零，但不会爆炸） */
    var FORGE_MUL_CAP = 8.0;         /* mul 上限，防溢出（+20≈3.1，+200≈5.3） */

    /* 难度阶梯：+1~+4 保底易得，+15 以后是噩梦区（4%）。 */
    var FORGE_SAFE_LV = 10;          /* 达到此级后失败不降级 */
    var FORGE_PITY_STREAK = 8;       /* 连败 8 次后下一次必成 */
    var FORGE_RATE = [100, 100, 96, 92, 86, 78, 70, 62, 54, 46, 38, 31, 25, 20, 16, 13, 10, 8, 6, 5, 4];
    function forgeRateAt(lv) { return FORGE_RATE[Math.min(lv, FORGE_RATE.length - 1)]; }

    /* FORGE[槽位键] = { lv: 等级, fail: 连败次数, name: 道具名 } */
    var FORGE = (function () {
        var o = {};
        try {
            var raw = localStorage.getItem(skey('forge_v1'));
            if (raw) {
                var d = JSON.parse(raw);
                for (var k in d) {
                    if (!d.hasOwnProperty(k)) continue;
                    var v = d[k];
                    if (!v || typeof v !== 'object') continue;
                    var lv = parseInt(v.lv, 10);
                    if (!isFinite(lv) || lv < 0) continue;
                    o[k] = { lv: Math.min(FORGE_MAX, lv), fail: parseInt(v.fail, 10) || 0, name: String(v.name || '') };
                }
            }
        } catch (e) { }
        return o;
    })();

    function saveForge() {
        try { localStorage.setItem(skey('forge_v1'), JSON.stringify(FORGE)); } catch (e) { }
    }

    /* 从 localStorage 重新加载强化表。
       内存里的 FORGE 只在脚本注入时读一次，多标签页/外部改档后需要重载；
       读档（didLoadGame）也必须重载，否则换存档后拿到的是上一局的强化等级。 */
    function reloadForge() {
        FORGE = {};
        try {
            var raw = localStorage.getItem(skey('forge_v1'));
            if (raw) {
                var d = JSON.parse(raw);
                for (var k in d) {
                    if (!d.hasOwnProperty(k)) continue;
                    var v = d[k];
                    if (!v || typeof v !== 'object') continue;
                    var lv = parseInt(v.lv, 10);
                    if (!isFinite(lv) || lv < 0) continue;
                    FORGE[k] = { lv: Math.min(FORGE_MAX, lv), fail: parseInt(v.fail, 10) || 0, name: String(v.name || '') };
                }
            }
        } catch (e) { }
        return FORGE;
    }

    /* 清理历史脏键：早期版本给 forgeKey 传了对象而不是下标，
       存下了一堆 "[object Object]_N" 的无效强化记录。 */
    function cleanForgeDirty() {
        try {
            var n = 0;
            for (var k in FORGE) {
                if (!FORGE.hasOwnProperty(k)) continue;
                if (k.indexOf('object') >= 0) { delete FORGE[k]; n++; }
            }
            if (n) { saveForge(); log('已清理 ' + n + ' 条无效强化记录'); }
        } catch (e) { }
    }

    /* 槽位键：同一件装备只跟随武将的某个槽位。
       用「武将下标_槽位」而不是道具名 —— 同名装备可以并存，各强化各的，
       也避免换装后强化等级串到别人身上。 */
    function forgeKey(pid, slot) { return pid + '_' + slot; }

    function forgeLv(pid, slot) {
        var r = FORGE[forgeKey(pid, slot)];
        return r ? r.lv : 0;
    }

    /* 伤害系数：饱和曲线，见文件头「设计要点 2」 */
    /* 等级 → 战力倍率（v3 两段式，永不归零）
       +1~+20 陡升段：mul = 1 + L × FORGE_STEP × (1 + FORGE_GROWTH × L)
       +20 之后缓升段：在 +20 的基础上每级再加 FORGE_TAIL_STEP
       高强化永远有回报（只是每级收益很小），满足「追求极致」的乐趣。 */
    function forgeDmgMul(lv) {
        if (!lv || lv <= 0) return 1;
        var base = FORGE_SOFT_CAP * FORGE_STEP * (1 + FORGE_GROWTH * FORGE_SOFT_CAP)
                 + FORGE_SOFT_CAP * FORGE_TAIL_STEP;
        if (lv <= FORGE_SOFT_CAP) {
            return Math.min(FORGE_MUL_CAP, 1 + lv * FORGE_STEP * (1 + FORGE_GROWTH * lv));
        }
        var m = 1 + base + (lv - FORGE_SOFT_CAP) * FORGE_TAIL_STEP;
        return Math.min(FORGE_MUL_CAP, m);
    }

    /* 该武将身上所有已强化装备的合成系数（多件不叠加，取最高的一件）——
       与 genPower 的设计一致：避免「武将 A 拿两把 +13 = 双倍」这种失控。 */
    function personForgeMul(pid) {
        if (!flag('forge')) return 1;
        var best = 0;
        for (var slot = 0; slot < 2; slot++) {
            var lv = forgeLv(pid, slot);
            if (lv > best) best = lv;
        }
        return forgeDmgMul(best);
    }

    /* ---------- 道具类型判定 ----------
       引擎的道具结构里**没有类型字段**，只有三个数值属性：
       g_Tools[tid] = { at: 武力加成, iq: 智力加成, move: 移动加成, useflag: 装备/消耗 }
       所以按数值组合反推类型（与「宝物图鉴」里的分组同一口径）：
         TYPE_WEAPON 兵器    at > 0
         TYPE_BOOK   兵书    iq > 0
         TYPE_MOUNT  坐骑    move > 0（可同时带 at/iq → 混合型）
         TYPE_JUNK   无属性  三项全 0
       纯坐骑（只有 move、at/iq 均为 0）只影响移动与先手顺序，
       伤害系数乘在普攻/技能伤害上对它毫无收益 —— 所以默认不给强化（forgeMount 开关可开）。 */
    var TYPE_JUNK = 0, TYPE_WEAPON = 1, TYPE_BOOK = 2, TYPE_MOUNT = 3;

    function toolType(tid0) {
        var t = baye.data.g_Tools[tid0];
        if (!t) return TYPE_JUNK;
        if (t.at > 0) return TYPE_WEAPON;
        if (t.iq > 0) return TYPE_BOOK;
        if (t.move > 0) return TYPE_MOUNT;
        return TYPE_JUNK;
    }
    /* 名字判定必须独立算，不能只看 toolType 的返回值 ——
       toolType 按 at→iq→move 的顺序短路，「坐骑+智力」会在 iq 分支就返回 BOOK，
       靠 toolType 永远识别不出混合型（这是之前实测发现的死代码）。 */
    function toolTypeName(tid0) {
        var t = baye.data.g_Tools[tid0];
        if (!t) return '无';
        var a = t.at || 0, iq = t.iq || 0, mv = t.move || 0;
        if (a + iq + mv <= 0) return '无属性';
        /* 同时带移动与武力/智力 → 混合型（坐骑附带的攻防，可强化） */
        if (mv > 0 && (a > 0 || iq > 0)) return '混合';
        if (mv > 0) return '纯坐骑';
        if (a > 0) return '兵器';
        if (iq > 0) return '兵书';
        return '无属性';
    }
    /* 该道具是否可强化（纯坐骑默认不可） */

    /* ================= 道具分类（按《平衡版2.1道具效果大全》核对）=================
       文档共 101 个道具，分 5 类：
         效果类武器 29 · 兵书 16 · 使用类 15 · 坐骑 30 · 无效果武器 11
       **可强化**：效果类武器 + 兵书 + 无效果武器 = 56 个（都是装备，挂在槽位上）
       **不可强化**：
         · 使用类 15 个（经验之书/等级之书/兵符/武力果…）—— 消耗品，不占槽位
         · 坐骑 30 个 —— 文档明确「均无特效」，只有移动力加成；
           伤害系数乘在普攻/技能伤害上，对纯坐骑无收益 → 强化是纯烧钱。
           ⚠ 四轮车虽在坐骑分类里，但它是诸葛亮座驾（智力>95），
             按用户要求不算马匹（马厩不显示）。
       以前靠「at/iq/move 数值组合」反推类型，边界模糊（带攻防的混合坐骑
       会被判成兵器）。现在改成**按名字查表**，与文档口径一致。 */
    var CAT_EFFECT_WEAPON = ['方天画戟','七星宝刀','倚天剑','狂歌戟','青龙偃月刀','丈八蛇矛','骠骑玄铁枪','青虹剑','追风洗银枪','火云裂空刀','截头大刀','浑铁双戟','铁蒺藜骨朵','錾金虎头枪','双股剑','龙牙斩马刀','赤霄剑','青锋剑','张陵剑','劈波钩拒','烈水三叉戟','九节杖','破阵霸王枪','惊天射日弓','螭纹龙舌弓','厚背长刀','铁脊蛇矛','钩镰刀','开山斧'];        /* 效果类武器 29 */
    var CAT_BOOK = ['孙子兵法','六韬','三略','鬼谷子','孙膑兵法','范蠡兵法','司马法','吴子兵法','墨子','商君书','尉缭子','神仙笔','天师符','太平要术','遁甲天书','金匮要略'];                 /* 兵书 16 */
    var CAT_USABLE = ['经验之书','等级之书','史记残页','将军印','士别三日','刮目相看','步战兵符','马战兵符','弓箭兵符','铁骑兵符','太玄兵符','水战兵符','武力果','智力果','统率力果'];               /* 使用类 15（消耗品） */
    var CAT_PLAIN_WEAPON = ['丈八长标','古锭刀','宿铁矛','眉尖刀','长柄铁锤','松纹厢宝剑','三尖两刃刀','望月枪','乌金枪','点钢枪','双铁鞭'];         /* 无效果武器 11 */
    var CAT_MOUNT_ALL = ['赤兔','的卢','绝影','快航','王追','乌骓','赤骥','纤骊','里飞沙','燎原火','四轮车','玉兰白龙驹','玉顶火龙驹','白鸽','灰影','黑云','奔雷','紫辛','骅骝','白雪','青骢','白驹','古黄','黑鬃','骐雄','黄骠','疾云','惊帆','乌孙','爪黄飞电'];            /* 坐骑 30（含四轮车，分类用） */
    /* 名称归一化：游戏里的道具名可能带空格/全角空格/不可见字符，
       直接字符串比较会「明明在文档里却查不到」（狂歌戟曾被判成"未知"）。 */
    function normName(nm) {
        return String(nm || '')
            .replace(/[\s\u3000\u00a0]/g, '')       /* 各类空格 */
            .replace(/[\uff01-\uff5e]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
            .replace(/[\u2018\u2019\u201c\u201d]/g, '')   /* 引号 */
            .trim();
    }
    function nameInList(nm, list) {
        var t = normName(nm);
        if (!t) return false;
        for (var i = 0; i < list.length; i++) {
            if (normName(list[i]) === t) return true;
            /* 文档名里可能带「（某将的武器）」之类后缀，这里做包含匹配兜底 */
            if (t.length >= 2 && normName(list[i]).indexOf(t) >= 0) return true;
        }
        return false;
    }
    /* 道具分类 → 用于图鉴显示 */
    function toolCategory(tid0) {
        var nm = '';
        try { nm = gbkSafe(baye.getToolName(tid0)) || ''; } catch (e) { nm = ''; }
        if (nameInList(nm, CAT_EFFECT_WEAPON)) return '效果武器';
        if (nameInList(nm, CAT_BOOK)) return '兵书';
        if (nameInList(nm, CAT_PLAIN_WEAPON)) return '无效果武器';
        if (nameInList(nm, CAT_MOUNT_ALL)) return nm === '四轮车' ? '坐骑(车)' : '坐骑';
        if (nameInList(nm, CAT_USABLE)) return '使用类';
        /* 表里没有（mod 新增道具 / 名称对不上）→ 退回按属性数值判断，
           尽量给出有用的分类，而不是"未知"。 */
        var t = baye.data.g_Tools[tid0];
        if (!t) return '道具';
        if (t.useflag) return '使用类';
        var sum = (t.at || 0) + (t.iq || 0) + (t.move || 0);
        if (sum <= 0) return '无属性';
        if (t.move > 0 && (t.at > 0 || t.iq > 0)) return '混合坐骑';
        if (t.move > 0) return '坐骑';
        return t.at > 0 ? '无效果武器' : '兵书';
    }
    /* 该道具能否强化（按文档口径） */
    function canForgeByDoc(tid0) {
        var cat = toolCategory(tid0);
        return cat === '效果武器' || cat === '兵书' || cat === '无效果武器' || cat === '混合坐骑';
    }

    /* 按《平衡版2.1道具效果大全》口径判定：只有「效果类武器 / 兵书 / 无效果武器」
       （以及带攻防的混合坐骑）可强化。文档明确坐骑「均无特效」，
       伤害系数对纯坐骑无收益 → 纯坐骑默认不给强化（forgeMount 开关可开）。 */
    function toolForgeable(tid0) {
        var t = baye.data.g_Tools[tid0];
        if (!t) return false;
        if (t.useflag) return false;                    /* 消耗品（使用类 15 个） */
        var sum = (t.at || 0) + (t.iq || 0) + (t.move || 0);
        if (sum <= 0) return false;                     /* 无属性 */
        if (nameInList(safeToolName(tid0), CAT_MOUNT_ALL)) {
            /* 文档坐骑分类：只有「带攻防的混合型」才值得强化，纯坐骑不强化 */
            if (t.move > 0 && (t.at > 0 || t.iq > 0)) return true;
            return !!flag('forgeMount');
        }
        return canForgeByDoc(tid0) || flag('forgeMount');
    }
    /* 安全的道具名（GBK 解码失败时回退空串） */
    function safeToolName(tid0) {
        try { return gbkSafe(baye.getToolName(tid0)) || ''; } catch (e) { return ''; }
    }

    /* 道具稀有度系数：有属性才值钱，纯道具（at/iq/move 全 0）不给强化 */
    function forgeRarity(tid0) {
        if (!toolForgeable(tid0)) return 0;
        var t = baye.data.g_Tools[tid0];
        var sum = (t.at || 0) + (t.iq || 0) + (t.move || 0);
        /* 名品（属性和 ≥ 20）更贵，比例控制在 1.0 ~ 2.2 */
        return 1 + Math.min(1.2, sum / 20);
    }

    /* 升到 lv+1 的费用。等比数列（1.28^lv），封顶在单城金币上限。
       +1 约 40金 → +10 约 340金 → +20 约 5000金（名品再乘稀有度系数）。 */
    function forgeCost(lv, rarity) {
        if (rarity <= 0) return 0;
        var v = FORGE_BASE_COST * rarity * Math.pow(lv + 1, FORGE_COST_RATIO);
        if (!isFinite(v) || v > FORGE_COST_MAX) return FORGE_COST_MAX;
        return Math.round(v);
    }

    /* 升到 lv+1 的成功率（含保底）。经典设计：
       · 必定成功开关（作弊）直接 100%；
       · 连败达 FORGE_PITY_STREAK 次后下一次必成（保底，避免高等级无限掉级）；
       · 否则按等级阶梯。 */
    function forgeRate(lv, failStreak) {
        if (flag('forgeGuarantee')) return 100;      /* 必定成功开关 */
        if (failStreak >= FORGE_PITY_STREAK) return 100;   /* 连败保底 */
        if (flag('forgePity') && failStreak >= 5) return 100;
        return forgeRateAt(lv);
    }

    /* 强化一次。返回 {ok, msg, lv, rate, cost} */
    function forgeOnce(pid, slot) {
        var p = personAt(pid);
        if (!p || !p.Equip) return { ok: false, msg: '武将不存在' };
        var tid1 = p.Equip[slot];
        if (!tid1) return { ok: false, msg: '该槽位没有装备' };
        var tid0 = tid1 - 1;
        var t = baye.data.g_Tools[tid0];
        if (!t) return { ok: false, msg: '道具数据缺失' };
        if (t.useflag) return { ok: false, msg: '只有「装备类」道具能强化（消耗品不行）' };
        var tName = toolTypeName(tid0);
        if (tName === '无属性') return { ok: false, msg: '该道具没有任何属性，无法强化' };
        if (tName === '纯坐骑') return { ok: false, msg: '纯坐骑不可强化（只加移动、不影响伤害）。可在设置里开启「允许强化纯坐骑」' };
        var rarity = forgeRarity(tid0);
        if (rarity <= 0) return { ok: false, msg: '该道具无法强化（' + tName + '）' };

        var key = forgeKey(pid, slot);
        var rec = FORGE[key] || { lv: 0, fail: 0, name: '' };
        var lv = rec.lv, rate = forgeRate(lv, rec.fail), cost = forgeCost(lv, rarity);
        if (lv >= FORGE_MAX) return { ok: false, msg: '已达强化上限 +' + FORGE_MAX + '（可在设置里调高）' };
        if (rate <= 0) return { ok: false, msg: '成功率异常' };

        /* 扣钱：玩家势力任意一座城的 Money 合计（铁匠铺视为向都城支取） */
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var purse = 0;
        var cities = baye.data.g_Cities;
        for (var c = 0; c < cities.length; c++) {
            if (cities[c].Belong === myKing) purse += (cities[c].Money || 0);
        }
        if (purse < cost) return { ok: false, msg: '钱不够：需要 ' + cost + '，全势力只有 ' + purse };

        /* 扣钱：按「钱最多的城优先」依次扣，尽量不动其他城的存粮。
           （早先实现是从第一座城开始扣，会把国库掏空又不划算） */
        var remain = cost, guard = 0;
        while (remain > 0 && guard++ < 64) {
            var pick = -1, richest = -1;
            for (c = 0; c < cities.length; c++) {
                if (cities[c].Belong !== myKing) continue;
                if ((cities[c].Money || 0) > richest) { richest = cities[c].Money || 0; pick = c; }
            }
            if (pick < 0 || richest <= 0) break;
            var take = Math.min(richest, remain);
            cities[pick].Money -= take;
            remain -= take;
        }

        /* 掷骰 */
        var hit = Math.random() * 100 < rate;
        var name = '';
        try { name = gbkSafe(baye.getToolName(tid0)) || ('#' + tid0); } catch (e) { name = '#' + tid0; }
        rec.name = name;          /* 写回名字，供「宝物图鉴」按名称标注 +N */
        if (hit) {
            rec.lv = lv + 1; rec.fail = 0;
            FORGE[key] = rec;
            saveForge();
            return { ok: true, win: true, lv: rec.lv, rate: rate, cost: cost, msg: name + ' 强化成功！ → +' + rec.lv + '（伤害 +' + Math.round((forgeDmgMul(rec.lv) - 1) * 100) + '%）' };
        }
        rec.fail = (rec.fail || 0) + 1;
        var lost = 0, guarded = false;
        if (rec.lv > 0 && rec.lv < FORGE_SAFE_LV) {
            rec.lv -= 1; lost = 1;                     /* 用户指定：失败掉 1 级 */
        } else if (rec.lv >= FORGE_SAFE_LV) {
            guarded = true;                            /* 高阶保护：只损钱不降级 */
        }
        FORGE[key] = rec;
        saveForge();
        return {
            ok: true, win: false, lv: rec.lv, rate: rate, cost: cost,
            msg: name + ' 强化失败（' + rate + '%）！'
                + (lost ? '等级 -1 → +' + rec.lv
                    : guarded ? '达到 +' + FORGE_SAFE_LV + ' 高阶保护，等级不变（仅损钱）'
                        : '（+0 无等级可掉）')
                + (flag('forgePity') && rec.fail >= 5 ? '　【保底触发，下次必成】' : '')
        };
    }

    /* 换档/新开局校验：槽位上的道具名与强化记录里记的不一致 → 丢弃该记录。
       强化等级按「武将下标_槽位」索引，而下标在不同存档里指向不同武将，
       不校验就会出现「A 的 +13 武器变成 B 手里」。 */
    function forgeValidate() {
        cleanForgeDirty();
        var changed = 0, checked = 0;
        for (var key in FORGE) {
            if (!FORGE.hasOwnProperty(key)) continue;
            var rec = FORGE[key];
            if (!rec || !rec.lv) { delete FORGE[key]; changed++; continue; }
            var parts = key.split('_');
            var pid = parseInt(parts[0], 10), slot = parseInt(parts[1], 10);
            var p = (isFinite(pid) && isFinite(slot)) ? personAt(pid) : null;
            var tid1 = (p && p.Equip) ? p.Equip[slot] : 0;
            var nm = '';
            if (tid1) { try { nm = gbkSafe(baye.getToolName(tid1 - 1)) || ''; } catch (e) { } }
            checked++;
            if (!nm || (rec.name && nm !== rec.name)) {
                delete FORGE[key];
                changed++;
            }
        }
        if (changed) {
            saveForge();
            log('铁匠铺：换档清理了 ' + changed + ' 条失效强化记录（共校验 ' + checked + ' 条）');
        }
    }

    /* ---------- 需求2：角色装备栏显示「+N」 ----------
       引擎 lib 的 getPersonPropertyValue 里有两条分支：
           case "道具壹": c.value = toolName(person.Tool1);
           case "道具贰": c.value = toolName(person.Tool2);
       包装它：先让原版填好装备名，再判断「这个武将的这个槽位有没有强化」，
       有就追加「 +N」。比对用「原版填出来的名字 == 该槽位道具名」，
       而不是判断 propertyIndex —— 后者的表头数组在 lib 的闭包里，外部取不到，
       硬编码 index 会随剧本变化而错位。 */
    function onPersonPropertyValue(ctx, orig) {
        var old = orig || wrappedHooks.getPersonPropertyValue;
        if (!flag('forge') || !ctx || !old) return undefined;
        var rv;
        try { rv = old.call(baye.hooks, ctx); } catch (e) { return undefined; }
        if (rv === undefined) rv = 0;
        try {
            var pidx = ctx.personIndex;
            var p = personAt(pidx);
            if (p && p.Equip && typeof ctx.value === 'string') {
                for (var slot = 0; slot < 2; slot++) {
                    var tid1 = p.Equip[slot];
                    if (!tid1) continue;
                    var lv = forgeLv(pidx, slot);
                    if (lv <= 0) continue;
                    var nm = '';
                    try { nm = gbkSafe(baye.getToolName(tid1 - 1)) || ''; } catch (e2) { }
                    if (nm && ctx.value === nm) {          /* 原版填的就是这件装备 */
                        ctx.value = '+' + lv + ctx.value;   /* 前置显示：+8狂歌戟 */
                        break;
                    }
                }
            }
        } catch (e3) { }
        return rv;
    }

    /* ---------- 伤害钩子：先让原版公式算完，再乘强化系数 ----------
       顺序是硬约束：wrapHook 的语义是「fn 返回 undefined → 引擎接着调原版」，
       而原版钩子最后一行就是 context.hurt = hurt，会把提前乘好的系数直接覆盖掉。
       所以这里自己按顺序调：先 orig(ctx) 让它算出 hurt，再乘强化系数，
       最后把 orig 的返回值原样交回引擎（-1 = 按 context 里的值走）。
       orig 由注册处闭包直传，避免普攻/技能两条钩子互相串味。 */
    function onCountHurt(ctx, orig) {
        if (!flag('forge') || !ctx || !orig) return undefined;
        var rv;
        try { rv = orig.call(baye.hooks, ctx); } catch (e) { return undefined; }
        if (rv === undefined) rv = -1;
        try {
            var att = baye.data.g_GenAtt && baye.data.g_GenAtt[0];
            var pid = att ? baye.data.g_FgtParam.GenArray[att.generalIndex] : 0;
            if (pid && typeof ctx.hurt === 'number' && ctx.hurt > 0) {
                var mul = personForgeMul(pid - 1);
                if (mul > 1) ctx.hurt *= mul;
            }
        } catch (e2) { }
        return rv;
    }

    /* ---------- 铁匠铺界面 ---------- */
    function forgeListLines() {
        var out = ['铁匠铺 · 强化（不设上限）'];
        var cities = baye.data.g_Cities, myKing = (baye.data.g_PlayerKing || 0) + 1;
        var purse = 0;
        for (var c = 0; c < cities.length; c++) if (cities[c].Belong === myKing) purse += (cities[c].Money || 0);
        out.push('全势力资金 ' + purse + ' 金');
        var n = 0;
        for (var i = 0; i < baye.data.g_Persons.length; i++) {
            var p = baye.data.g_Persons[i];
            if (!p || p.Level <= 0) continue;
            if (p.Belong !== myKing) continue;
            for (var s = 0; s < 2; s++) {
                if (!p.Equip[s]) continue;
                if (!toolForgeable(p.Equip[s] - 1)) continue;   /* 消耗品/无属性/纯坐骑（未开开关）不算可强化 */
                n++;
            }
        }
        out.push('可强化装备 ' + n + ' 件（仅己方武将）');
        out.push('');
        out.push('费用=45×稀有度×(等级+1)^1.45');
        out.push('成功率 ' + FORGE_RATE.join('/'));
        out.push('失败 -1 级（+' + FORGE_SAFE_LV + ' 起高阶保护）');
        out.push(flag('forgePity') ? '连败5次保底必成' : '保底已关');
        out.push('');
        out.push('伤害加成（饱和曲线）');
        var lv;
        for (lv = 1; lv <= 20; lv += 3) {
            out.push(' +' + lv + ' → 伤害 ×' + forgeDmgMul(lv).toFixed(3)
                + '（+' + Math.round((forgeDmgMul(lv) - 1) * 100) + '%）');
        }
        out.push(' +20 → ×' + forgeDmgMul(20).toFixed(3) + '（收益已饱和）');
        out.push('');
        out.push('多件不叠加，取最高一件');
        out.push('引擎面板数值不变');
        return out;
    }

    /* 选武将 → 选槽位 → 强化 */

    /* ================= 马厩（v1.16.0） =================
       与铁匠铺同一个人工入口，先看坐骑总览再决定强化谁。
       坐骑清单来自《平衡版2.1道具效果大全》「█坐骑(30个，均无特效)█」，
       已按用户要求**过滤掉四轮车**（诸葛亮座驾，移动+2 但不算马匹）→ 29 匹。
       文档同时确认：**坐骑全部无特效**（只有移动力加成），
       所以纯坐骑不给强化（伤害系数乘它没收益），这与现有 forgeMount 开关的逻辑一致。 */
    var MOUNT_NAMES = ['赤兔','的卢','绝影','快航','王追','乌骓','赤骥','纤骊','里飞沙','燎原火',
        '玉兰白龙驹','玉顶火龙驹','白鸽','灰影','黑云','奔雷','紫辛','骅骝','白雪','青骢',
        '白驹','古黄','黑鬃','骐雄','黄骠','疾云','惊帆','乌孙','爪黄飞电'];
    var MOUNT_MV = { '赤兔': 3 };                   /* 其余均为 +2 / +1，运行时按道具 move 字段读 */
    function isMountName(nm) {
        if (!nm) return false;
        for (var i = 0; i < MOUNT_NAMES.length; i++) if (MOUNT_NAMES[i] === nm) return true;
        return false;
    }

    /* ---------- ② 赛前报名（粮食报名费，彩票式递增）---------- */
    var RACE_FEE = [0, 300, 800, 1800];         /* 0/1/2/3 匹的报名费（粮草） */
    var RACE_MAX_HORSE = 3;
    /* 本势力（玩家）已报名的马：{name, mv} */
    var RACE_ENTRY = [];
    function raceEntryFee(n) { return RACE_FEE[Math.max(0, Math.min(RACE_MAX_HORSE, n | 0))] || 0; }
    /* 报名：扣粮草、记名。返回提示。 */
    function raceEnter(horses, c) {
        var fee = raceEntryFee(horses.length);
        if (horses.length > RACE_MAX_HORSE) return { ok: false, msg: '一个势力最多 ' + RACE_MAX_HORSE + ' 匹马' };
        if (fee <= 0) { RACE_ENTRY = []; return { ok: true, msg: '已放弃报名（不参赛不扣粮）' }; }
        var have = Number(c.Food) || 0;
        if (have < fee) return { ok: false, msg: '粮草不足：报名费 ' + fee + '，只有 ' + have };
        c.Food = have - fee;
        RACE_ENTRY = horses.slice();
        return { ok: true, msg: '报名成功：' + horses.map(function (h) { return h.nm; }).join('、')
            + '　报名费 ' + fee + ' 粮草' };
    }
    /* 报名弹窗：问「是否报名」→ 选马（0~3 匹）。 */
    function raceSignUpDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1, c = capitalCity();
        var city = c >= 0 ? cityAt(c) : null;
        if (!city) { alert2('没有都城，无法报名。'); return; }
        var pool = raceMountPool().filter(function (m) { return m.king === myKing; });
        if (!pool.length) {
            menu(['你名下没有马匹，无法参赛。', '（先去收集赤兔 / 的卢 / 里飞沙等战马）'], 0, null);
            return;
        }
        var lines = ['【赛马大会·报名】都城：' + cityName(c), ''];
        pool.forEach(function (m, i) {
            var st = mountState(m.king, m.nm);
            lines.push('  [' + i + '] ' + pad(m.nm, 8) + ' 移动+' + m.mv
                + '　状态 ' + st.s + (st.sick ? '（病中）' : '') + '　押注费 ' + raceEntryFee(1) + '粮/匹');
        });
        lines.push('');
        lines.push('报名费：1 匹 ' + raceEntryFee(1) + ' 粮 · 2 匹 ' + raceEntryFee(2) + ' 粮 · 3 匹 ' + raceEntryFee(3) + ' 粮');
        lines.push('（不报名=不扣粮，也没有奖金）');
        /* 选马：连续选直到选满 3 匹或选择「完成」 */
        var picked = [];
        function step() {
            var cur = lines.slice(0, lines.length);
            picked.forEach(function (m, i) { cur.push('  已选[' + (i + 1) + '] ' + m.nm + ' 移动+' + m.mv); });
            cur.push('');
            cur.push('【' + (picked.length ? '完成报名（' + raceEntryFee(picked.length) + ' 粮）' : '放弃报名') + '】');
            menu(cur, 0, function (ind) {
                if (ind === baye.None || ind === 65535 || ind === undefined) return;
                if (ind < pool.length) {
                    var m = pool[ind];
                    if (picked.some(function (x) { return x.nm === m.nm; })) { alert2(m.nm + ' 已经选过了'); step(); return; }
                    if (picked.length >= RACE_MAX_HORSE) { alert2('最多 ' + RACE_MAX_HORSE + ' 匹'); step(); return; }
                    picked.push(m);
                    step();
                    return;
                }
                /* 完成 / 放弃 */
                var r = raceEnter(picked, city);
                alert2(r.msg);
                if (r.ok) { RACE_ENTRY = picked.slice(); try { saveRaceState(); } catch (e) { } }
            });
        }
        step();
    }

    /* ---------- ⑤ 比赛核心：状态 + 随机事件 + 权重 ---------- */
    /* 单场表现分 = 移动力基础 + 状态 + 骑手 + 随机扰动 + 事件 */
    /* 评分权重（经 sim-race.js 300 场蒙特卡洛调定）：
         移动力 20/档（主要因素）· 状态 0.8/点（次要）· 病态 -14 · 随机扰动 ±8
       模拟结论：满状态赤兔夺冠率 63%，不喂食 47%；移动力阶梯清晰（平均名次 1.67/6.31/9.40）；
       慢马夺冠率 10.7%（有翻盘空间但不是白送）；异常发生率 33%。 */
    function raceScore(m) {
        var st = mountState(m.king, m.nm);
        var base = m.mv * 20;                        /* 移动力基础（mv1=20, mv2=40, mv3=60） */
        var stPart = (st.s - 70) * 0.8;                /* 状态：100→+24, 60→-8 */
        if (st.sick) stPart -= 14;                    /* 病态：再减 14 */
        var noise = (Math.random() - 0.5) * 16;        /* 随机扰动 ±8：给状态好的慢马翻盘空间 */
        return base + stPart + noise;
    }
    /* 随机事件：返回 {txt, delta} 或 null。概率随状态降低（状态差=事故多）。 */
    function raceEvent(m, st) {
        var p = Math.max(0, (100 - st.s)) / 100;       /* 状态越低越容易出事 */
        var r = Math.random();
        if (st.sick) {
            if (r < 0.30) return { txt: m.nm + ' 带病上阵，状态不佳', delta: -15 };
        } else if (r < p * 0.25) {
            return { txt: m.nm + ' 失前蹄，摔了个跟头', delta: -12 };
        } else if (r < p * 0.38) {
            return { txt: '骑手坠马！' + m.nm + ' 无人牵引', delta: -20 };
        } else if (r < p * 0.50) {
            return { txt: m.nm + ' 受场外喧哗刺激，受惊', delta: -8 };
        } else if (r < p * 0.58) {
            return { txt: m.nm + ' 体力不支，掉速', delta: -6 };
        }
        return null;
    }

    /* ================= 赛马大会 v2.0（v1.19.0）=================
       玩家需求（7 条）：
       ① 各势力出马比赛 —— 不是玩家自己马厩的马互相比。系统维护「全局马池」，
          每匹��有归属势力；AI 势力用**在野未搜出**的马（玩家搜到就没了）。
       ② 赛前弹窗报名 —— 玩家选择是否参加、派几匹马；**报名费=粮食**，
          派得越多越贵（彩票式：1 匹 300 粮 / 2 匹 800 / 3 匹 1800），一个势力最多 3 匹。
       ③ 赛马动画 —— 逐匹播报（起跑/领先/超车/异常），带解说节奏。
       ④ 奖金大幅提高 —— 冠军 ≥ 10000金。
       ⑤ 状态 + 随机性 —— 每匹马有「状态值 0~100」，马厩喂食（花粮）可提状态；
          移动力只是基础分，还有状态、骑手、随机事件（生病/失前蹄/骑手坠马/场外刺激），
          **结果必须列全排名并标注异常**；状态正常时赤兔仍是最大热门。
       ⑥ 连胜奖励 —— 连续夺冠有额外奖金。
       ⑦ 蒙特卡洛模拟 100 场验证（开发期用，见 sim-race.js）。

       ★ 关键设计取舍：
       - 状态值存在 localStorage（和强化表同机制，跟档绑定），不写引擎数据。
       - 异常事件只影响**本场**，不改状态；但「生病」会写进状态（需喂食 cures）。
       - 报名费是可选项，不报名 = 0 支出，但也没奖金。 */

    var RACE_SEASON = 0;        /* 赛季号（每 3 个月 +1） */
    var RACE_HISTORY = [];      /* 历届冠军{season,name,king,date} */
    var RACE_LAST_HELD = -1;    /* 上次举办的赛季号（给 api 诊断用） */
    var RACE_LAST_MD = -1;       /* 上次举办的月份号（1~12），同月绝不重复办 */
    var RACE_COUNT = 0;          /* 累计举办届数 */
    var RACE_REMIND_SEASON = -1;  /* 上次提醒过的赛季号，避免每月重复弹提醒 */
    function raceSeason() { return Math.floor(gameMonthIndex() / 3); }
    /* 月末专用赛季号：月末时引擎还没月结，用「下一个月」算，
       这样 2 月末算出的赛季号与 3 月末相同 → 只在 3/6/9/12 月末举办。 */
    function raceSeasonAfter(md) {
        /* 用「下一个月」算赛季号，且正确处理跨年（12 月→ 次年 1 月）。
           gameMonthIndex() = (年-190)×12 + 月，所以下个月 = +1 即可自动跨年。 */
        return Math.floor((gameMonthIndex() + 1) / 3);
    }
    function raceNextMonths() {
        var into = gameMonthIndex() % 3;
        return 3 - into;                     /* 距下届还有几月（1~3） */
    }
    /* 玩家名下的马（马厩列表 / 报名候选都用它） */
    function myMounts() {
        return raceMountPool().filter(function (m) {
            return m.king === (baye.data.g_PlayerKing || 0) + 1;
        });
    }
    /* 粮草换钱（吃不掉的高位粮草换个用） */
    function feedMounts() {
        var c = capitalCity(), city = c >= 0 ? cityAt(c) : null;
        if (!city) { alert2('没有都城。'); return; }
        var have = Number(city.Food) || 0;
        if (have < 500) { alert2('粮草不足：需要 500，只有 ' + have); return; }
        city.Food = have - 500;
        var room = Math.max(0, 30000 - (Number(city.Money) || 0));
        var add = Math.min(800, room);
        if (add > 0) city.Money = (Number(city.Money) || 0) + add;
        alert2('粮草换钱：-500 粮　+' + add + ' 金（粮草剩 ' + (Number(city.Food) || 0) + '）');
        log('马厩·粮换金：粮-' + 500 + ' 金+' + add);
    }

    /* ---------- 全局马池 ---------- */
    /* 池里的马 = MOUNT_NAMES × 归属势力。
       玩家的马：扫玩家武将身上的坐骑（已搜出的）。
       AI 的马：按「势力拥有的坐骑名」清单生成，含状态，未被玩家搜到。 */
    /* ---------- 全局马池：全部来自「武将身上的真实坐骑」----------
       ★★v1.20.4 重大修正：之前 AI 势力的马是我**凭空生成**的（raceKingMounts 编名字），
          所以「这匹马属于谁」根本无从查证→ 君主名只能靠猜（等级最高）→ 必然错。
       现在改成：**任何一匹马都来自某个武将的装备槽**，因此：
         马的归属势力 = 该武将的 Belong（真实数据）
         君主= 该势力真正的君主（见 kingPidOfCity）
       玩家能搜到的马 = 已在某个武将身上；搜不到的（还在野）不参赛，
       符合「系统在野未搜出的马匹不能参加」的要求。 */
    function raceMountPool() {
        var pool = [], myKing = (baye.data.g_PlayerKing || 0) + 1;
        var persons = baye.data.g_Persons, cities = baye.data.g_Cities;
        var i, s2, tid0, t, nm, p, c, owner;
        for (i = 0; i < persons.length; i++) {
            p = persons[i];
            if (!p || !p.Level || p.Level <= 0) continue;
            /* 排除在野与俘虏：只有已归属某势力的马才参赛 */
            if (p.Belong <= 0 || p.Belong === WILD || p.Belong === CAPTIVE) continue;
            for (s2 = 0; s2 < 2; s2++) {
                if (!p.Equip || !p.Equip[s2]) continue;
                tid0 = p.Equip[s2] - 1;
                t = baye.data.g_Tools[tid0];
                if (!t) continue;
                try { nm = gbkSafe(baye.getToolName(tid0)) || ''; } catch (e) { nm = ''; }
                if (!isMountName(nm)) continue;
                c = cityOfPerson(i);                   /* 该武将驻扎的城 */
                owner = (c >= 0 && cities[c]) ? cities[c].Belong : p.Belong;
                pool.push({
                    nm: nm, mv: MOUNT_MV[nm] || (t.move || 1),
                    king: p.Belong,                      /* 马的真正归属：武将所属势力 */
                    city: c,                             /* 所在城池（用于显示） */
                    rider: nameOf(i),                     /* 骑手 */
                    kingName: kingName(p.Belong),        /* 君主（按城池/势力反查） */
                    mine: p.Belong === myKing
                });
            }
        }
        return pool;
    }

    /* 各势力拥有的马（AI 势力的马是"系统生成"的，含玩家未搜出的在野马）。
       规则：势力越大马越多；同一个势力不会有多匹同名马。 */
    /* 各势力拥有的马（AI 势力的马 = 系统生成，含玩家搜不到的「在野马」）。
       ★ 两个必须遵守的规则（v1.20.3 修）：
         ① **全局唯一** —— 之前每个势力都从完整的 29 匹里随机抽，
            于是「董卓有赤兔、公孙瓒也有赤兔」→ 同场出现两只赤兔。
            现在改成：所有势力共享一个「已分配」集合，抽过的名字不再给别的势力。
         ② **稳定** —— 之前每次调用都重新随机，同一个势力每届的马都在变。
            现在分配结果**持久化**（跟存档槽走），只有换代（新存档）才重新分配。
       规则：马数 = min(城池数, 5)，按城池数分配。 */

    /* ---------- 马匹状态（持久化，跟存档槽）---------- */
    var RACE_STATE_KEY = 'baye_cheat_racestate_v1';
    var RACE_ST = (function () {
        var o = {};
        try {
            var raw = localStorage.getItem(skey('racestate_v1'));
            if (raw) o = JSON.parse(raw) || {};
        } catch (e) { }
        return o;
    })();
    function saveRaceState() {
        try { localStorage.setItem(skey('racestate_v1'), JSON.stringify(RACE_ST)); } catch (e) { }
    }
    /* 状态键：势力+马名（同势力同名马唯一） */
    function stKey(king, nm) { return king + '_' + nm; }
    function mountState(king, nm) {
        var k = stKey(king, nm);
        if (!RACE_ST[k]) {
            /* 初始状态 60~85（随机，看起来更自然） */
            RACE_ST[k] = { s: 60 + rand(26), sick: Math.random() < 0.05 ? 1 : 0, feed: 0, win: 0, lose: 0, streak: 0 };
        }
        return RACE_ST[k];
    }
    var STATE_MAX = 100;
    /* 喂食：花粮提状态。粮草 100 → 状态 +6（上限 100）。有病先治。 */
    function feedRaceMount(king, nm, food) {
        var st = mountState(king, nm);
        if (st.s >= STATE_MAX && !st.sick) return { ok: false, msg: '状态已满（' + st.s + '），无需喂食' };
        st.s = Math.min(STATE_MAX, st.s + 6);
        st.feed = (st.feed || 0) + 1;
        if (st.sick) { st.sick = 0; st.s = Math.min(STATE_MAX, st.s + 3); return { ok: true, cured: true, msg: '喂食后' + nm + ' 病愈，状态 ' + st.s }; }
        return { ok: true, msg: nm + ' 状态 +6 → ' + st.s };
    }

    /* ---------- ③④⑥ 比赛执行：AI 自动报名 + 评分排名 + 奖金 + 连胜 ---------- */
    /* 奖金表：冠军 12000（用户要求≥1万），逐级递减 */
    var RACE_PRIZE = [12000, 7000, 4000, 2500, 1500, 1000, 700, 500, 350, 250];
    var RACE_STREAK_BONUS = [0, 0, 2000, 4000, 8000, 15000];  /* 连胜2/3/4/5/6+ 额外奖 */
    /* AI 势力自动报名：每势力最多 3 匹，从其马池里挑最快的（带随机爆冷门） */
    function aiRaceEntry(pool, myKing) {
        var byKing = {};
        pool.forEach(function (m) {
            if (m.king === myKing) return;
            if (!byKing[m.king]) byKing[m.king] = [];
            byKing[m.king].push(m);
        });
        var entries = [];
        for (var k in byKing) {
            if (!byKing.hasOwnProperty(k)) continue;
            var list = byKing[k];
            if (Math.random() > 0.7) continue;                 /* 每势力 70% 概率参加 */
            var n = 1 + rand(Math.min(3, list.length));
            list.sort(function (a, b) { return b.mv - a.mv; });
            var pick = list.slice(0, n);
            if (Math.random() < 0.25 && list.length > n) pick[0] = list[n];   /* 偶尔爆冷门 */
            entries.push({ king: Number(k), horses: pick });
        }
        return entries;
    }
    /* 核心：跑一届比赛 */
    function raceRunOne(season) {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var pool = raceMountPool();
        var entries = aiRaceEntry(pool, myKing);
        if (RACE_ENTRY.length) entries.push({ king: myKing, horses: RACE_ENTRY.slice(), mine: true });
        if (!entries.length) return { lines: ['【赛马】本届无人参赛'], anim: [], rank: [], playerGot: 0 };
        var runners = [];
        entries.forEach(function (e) {
            e.horses.forEach(function (m) {
                var st = mountState(e.king, m.nm);
                var ev = raceEvent(m, st);
                runners.push({ king: e.king, nm: m.nm, mv: m.mv, st: st, ev: ev,
                    score: raceScore(m) + (ev ? ev.delta : 0), mine: !!e.mine });
            });
        });
        runners.sort(function (a, b) { return b.score - a.score; });
        runners.forEach(function (r, i) { r.rank = i + 1; });
        /* ③ 赛况动画：6 段推进（起跑/发令/中段/冲刺/最后100米/冲线）。
           ★每屏 ≤5 行：引擎窗口行高有限，行数多了底部会被裁掉。
           ★不用空行（\n\n）：引擎会把空行渲染成大片空白，看起来像叠字。
           ★不用「（按下一项继续）」这类长提示：playRaceAnim 会单独加进度行。 */
        var anim = [], seg, q, order, mid, late, accident;
        order = runners.slice().sort(function (a, b) { return b.score - a.score; });

        seg = '━━ 第' + (season + 1) + ' 届赛马大会 ━━\n'
            + '都城赛场 · ' + order.length + ' 匹马入场\n'
            + '看台爆满，旌旗飘扬\n'
            + '马夫就位，骑手压低身形';
        anim.push(seg);

        seg = '━━ 发 令 ━━\n'
            + '砰！发令枪响——\n'
            + order.length + ' 匹马冲出闸门！\n'
            + '起跑领先：' + order[0].nm + '（' + kingName(order[0].king) + '）\n'
            + '紧随：' + (order[1] ? order[1].nm : '—')
            + (order[2] ? '、' + order[2].nm : '');
        anim.push(seg);

        mid = order.slice().sort(function (a, b) {
            return b.score * (0.85 + Math.random() * 0.3) - a.score * (0.85 + Math.random() * 0.3);
        });
        accident = null;
        for (q = 0; q < mid.length; q++) if (mid[q].ev) { accident = mid[q]; break; }
        seg = '━━ 中 段 ━━\n';
        if (accident) {
            seg += '⚡ 意外！' + accident.nm + '：' + accident.ev.txt + '\n'
                + '　马夫在场边急得直跳';
        } else {
            seg += '节奏稳健，暂无意外';
        }
        seg += '\n中段领先：' + mid[0].nm;
        anim.push(seg);

        late = runners.slice().sort(function (a, b) {
            return (b.score + (Math.random() - 0.5) * 20) - (a.score + (Math.random() - 0.5) * 20);
        });
        seg = '━━ 最后冲刺 ━━\n';
        if (late[0].nm !== mid[0].nm) {
            seg += '🔥 ' + late[0].nm + ' 突然发力，强行超车！\n'
                + '　反超 ' + mid[0].nm + ' → ' + late[0].nm;
        } else {
            seg += '格局未变，领先者死死守住';
        }
        seg += '\n冲刺：' + late[0].nm + '暂列第一';
        anim.push(seg);

        seg = '━━ 最后 100 米 ━━\n'
            + '看台沸腾！\n'
            + late[0].nm + ' 咬牙冲刺\n'
            + (late[1] ? late[1].nm + ' 在身后紧咬！' : '后方紧追！');
        anim.push(seg);

        seg = '━━ 冲 线 ━━\n'
            + '🏆 冠军：' + runners[0].nm + '（' + kingName(runners[0].king) + '）\n'
            + '　亚军：' + (runners[1] ? runners[1].nm : '—')
            + '\n　季军：' + (runners[2] ? runners[2].nm : '—');
        anim.push(seg);
        /* 结果：列全排名 + 标注异常 */
        var lines = ['【赛马】第' + (season + 1) + '届 · ' + runners.length + ' 匹马', ''];
        runners.forEach(function (r) {
            lines.push('  第' + r.rank + '名  ' + pad(r.nm, 8) + ' 移动+' + r.mv
                + '  状态' + r.st.s + '  ' + kingName(r.king) + '（' + (r.mine ? '你' : '') + '）'
                + (r.ev ? '  ⚠' + r.ev.txt : ''));
        });
        var got = 0, pri = [];
        runners.forEach(function (r, i) {
            var money = RACE_PRIZE[i] || 0;
            if (r.mine && money > 0) { got += money; pri.push('第' + r.rank + '名 ' + r.nm + ' +' + money + '金'); }
        });
        /* ⑥ 连胜奖励 */
        var champ = runners[0];
        if (champ.mine) {
            var cst = mountState(myKing, champ.nm);
            cst.streak = (cst.streak || 0) + 1;
            var sb = RACE_STREAK_BONUS[Math.min(cst.streak, RACE_STREAK_BONUS.length - 1)] || 0;
            if (sb > 0) { got += sb; pri.push('★ 连胜 ' + cst.streak + ' 连冠！额外 +' + sb + '金'); }
        }
        runners.forEach(function (r) {
            if (r.mine && r.rank !== 1) mountState(myKing, r.nm).streak = 0;
        });
        /* 状态自然回落（每场 -2~5，不喂食会掉）—— 这是「喂食」有意义的前提 */
        runners.forEach(function (r) {
            var st = mountState(r.king, r.nm);
            st.s = Math.max(20, st.s - (2 + rand(4)));
            if (st.sick && Math.random() < 0.5) st.sick = 0;   /* 病态有 50% 自愈 */
        });
        var c = capitalCity(), city = c >= 0 ? cityAt(c) : null;
        if (city && got > 0) city.Money = (Number(city.Money) || 0)
            + Math.min(got, Math.max(0, 30000 - (Number(city.Money) || 0)));
        else got = 0;
        if (pri.length) { lines.push(''); lines.push('  你的奖金：'); pri.forEach(function (p) { lines.push('   ' + p); }); }
        lines.push('');
        lines.push('  本届冠军：' + champ.nm + '（' + kingName(champ.king) + '）');
        RACE_SEASON = season;
        RACE_LAST_HELD = season;
        RACE_COUNT++;
        RACE_HISTORY.unshift({ season: season, name: champ.nm, king: champ.king,
            date: monthKey().replace('-', '年') + '月' });
        if (RACE_HISTORY.length > 8) RACE_HISTORY.pop();
        try { saveRaceState(); } catch (e) { }
        return { lines: lines, anim: anim, rank: runners, playerGot: got };
    }

    /* 喂马提状态：选一匹马，花 100 粮草，状态 +6（上限 100），有病顺便治 */
    function feedStableDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var pool = raceMountPool().filter(function (m) { return m.king === myKing; });
        if (!pool.length) { alert2('没有马匹。'); return; }
        var c = capitalCity(), city = c >= 0 ? cityAt(c) : null;
        if (!city) { alert2('没有都城。'); return; }
        var lines = ['【喂马】每匹花费 100 粮草 · 状态 +6（上限 100）· 可解除病态', '都城粮草：' + (Number(city.Food) || 0), ''];
        pool.forEach(function (m, i) {
            var st = mountState(myKing, m.nm);
            lines.push('  [' + i + '] ' + pad(m.nm, 8) + ' 移动+' + m.mv + '　状态 ' + st.s
                + (st.sick ? '（病中·喂食可治）' : '') + (st.s >= 100 ? '（已满）' : ''));
        });
        menu(lines, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            if (ind >= pool.length) return;
            var m = pool[ind];
            var food = Number(city.Food) || 0;
            if (food < 100) { alert2('粮草不足：需要 100，只有 ' + food); return; }
            var r = feedRaceMount(myKing, m.nm, 100);
            if (!r.ok) { alert2(r.msg); return; }
            city.Food = food - 100;
            try { saveRaceState(); } catch (e) { }
            alert2(r.msg + '　（粮草 -100，剩 ' + (Number(city.Food) || 0) + '）');
        });
    }
    /* ③ 串行播赛况：一次只显示一屏，点确认继续下一段 → 完整看完比赛过程 */
    function playRaceAnim(anim, lines, onDone) {
        /* ★ 用 menu（大窗口）而不是 alert（小弹窗）：
             alert 的框只有屏幕上方一小块、背景半透明（地图文字会透出来）、
             行宽约 14 个汉字，超出就换行错位（用户截图：文字叠成一片）。
           menu 走 centerChoose(SW-8, SH-8)，有完整边框、自动折行、行高自适应。 */
        var segs = anim.slice();
        if (lines && lines.length) {
            segs.push('━━━━━━━━━━━ 全部排名 ━━━━━━━━━━━');
            segs = segs.concat(lines);
        }
        var i = 0;
        function next() {
            if (i >= segs.length) { if (onDone) { try { onDone(); } catch (e) { } } return; }
            var seg = segs[i++];
            if (!seg) { next(); return; }
            /* 只保留正文；进度提示单独一行（避免和正文混在一起） */
            var body = seg.replace(/\n\n（下按继续[^\n]*）$/, '');
            var items = body.split('\n');
            items.push('');
            items.push('─ 继续（' + i + '/' + segs.length + '）─');
            menu(items, items.length - 1, function (ind) {
                if (ind === baye.None || ind === 65535 || ind === undefined) { i = segs.length; }
                next();
            });
        }
        next();
    }

    /* 立即举办一届：先播动画（逐段 alert），再给完整排名 */
    function raceRunNowDialog() {
        var season = raceSeason();
        var res = raceRunOne(season);
        playRaceAnim(res.anim || [], res.lines || [], function () { stableDialog(); });
    }

    /* ---------- ② 马厩选拔赛（玩家自己的马互跑，收门票）----------
       与「赛马大会」的区别：
         · 赛马大会 = 各势力出马，系统每 3 个月办一次，玩家要报名+交粮草报名费
         · **选拔赛   = 只用你自己马厩的马互跑**，每月可办一次，**收门票**（观众付费）
       门票：每匹马1000 金（马越多收得越多）。
       用途：给马厩里的马一个「展示 + 筛选」舞台（快马露脸多、慢马也能出风头），
             同时给玩家一条稳定的金币来源（自己的马跑，不花报名费，反而赚钱）。
       限制：至少 2 匹马才能办（1 匹马没有比赛意义）。 */
    var SELECT_TICKET = 1000;        /* 每匹马门票（金） */
    var SELECT_LAST_MONTH = -1;      /* 上次办选拔赛的月份序号，每月只能一次 */
    /* 办一场选拔赛。horseIdx 缺省 = 全部马。 */
    function raceSelectRun(horseIdx) {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var c = capitalCity(), city = c >= 0 ? cityAt(c) : null;
        if (!city) { alert2('没有都城。'); return null; }
        var pool = raceMountPool().filter(function (m) { return m.king === myKing; });
        if (pool.length < 2) { alert2('至少要有 2 匹马才能办选拔赛。\n（当前 ' + pool.length + ' 匹）'); return null; }
        var mk = gameMonthIndex();
        if (SELECT_LAST_MONTH === mk) { alert2('这个月已经办过选拔赛了，下个月再来。'); return null; }
        var use = horseIdx && horseIdx.length ? horseIdx.map(function (i) { return pool[i]; }) : pool;
        /* 门票：每匹1000（观众付费 → 进你口袋） */
        var ticket = use.length * SELECT_TICKET;
        var room = Math.max(0, 30000 - (Number(city.Money) || 0));
        var got = Math.min(ticket, room);
        city.Money = (Number(city.Money) || 0) + got;
        SELECT_LAST_MONTH = mk;
        /* 评分+ 排名（规则与大会一致：移动力 + 状态 + 随机事件） */
        var runners = use.map(function (m) {
            var st = mountState(myKing, m.nm);
            var ev = raceEvent(m, st);
            return { king: myKing, nm: m.nm, mv: m.mv, st: st, ev: ev, mine: true,
                who: '', score: raceScore(m) + (ev ? ev.delta : 0) };
        });
        runners.sort(function (a, b) { return b.score - a.score; });
        runners.forEach(function (r, i) { r.rank = i + 1; });
        /* 赛况（复用分段动画，措辞改成选拔赛） */
        var anim = [];
        anim.push('━━ 马厩选拔赛 · 起跑 ━━\n\n'
            + '　' + use.length + ' 匹马在都城赛场集合\n'
            + '　观众买票入场（门票 ' + SELECT_TICKET + ' 金/匹）\n'
            + '　今日赛事由你自己主持');
        anim.push('　　━━发 令 ━━\n\n　砰！发令枪响——\n　' + use.length + ' 匹马冲出闸门！\n\n　起跑领先：' + runners[0].nm);
        var mid = runners.slice().sort(function (a, b) { return b.score * (0.85 + Math.random() * 0.3) - a.score * (0.85 + Math.random() * 0.3); });
        anim.push('　　— 中段 —\n\n'
            + (runners.some(function (r) { return r.ev; })
                ? '　⚡ 场上出现状况！' + (runners.filter(function (r) { return r.ev; })[0] || {}).nm
                    + (runners.filter(function (r) { return r.ev; })[0] || {}).ev.txt + '\n'
                : '　中段节奏稳健\n')
            + '\n　　中段领先：' + mid[0].nm);
        var late = runners.slice().sort(function (a, b) { return (b.score + (Math.random() - 0.5) * 20) - (a.score + (Math.random() - 0.5) * 20); });
        anim.push('　　— 最后冲刺 —\n\n'
            + (late[0].nm !== mid[0].nm ? '　🔥 ' + late[0].nm + ' 突然发力反超 ' + mid[0].nm + '！' : '　格局未变，领先者守住\n')
            + '\n　　冲刺阶段：' + late[0].nm + '暂列第一');
        anim.push('　　━━ 冲 线 ━━\n\n'
            + '　🏆 冠军：' + runners[0].nm + '　（移动+' + runners[0].mv + ' 状态' + runners[0].st.s + '）\n'
            + '　门票收入 +' + got + ' 金（' + use.length + ' 匹 × ' + SELECT_TICKET + '）\n\n'
            + '　（点确认查看全部排名）');
        /* 排名 + 奖金（选拔赛也发奖，但比大会低，只算门票为主） */
        var lines = ['【选拔赛】马厩自办 · ' + use.length + ' 匹马 · 门票收入 +' + got + ' 金', ''];
        runners.forEach(function (r) {
            lines.push('  第' + r.rank + '名  ' + pad(r.nm, 8) + ' 移动+' + r.mv + '  状态' + r.st.s
                + (r.ev ? '  ⚠' + r.ev.txt : ''));
        });
        /* 冠军奖励（低于大会，因为门票才是主收益） */
        if (got > 0 || true) { /* 门票已入账 */ }
        lines.push('');
        lines.push('  冠军：' + runners[0].nm + '　门票 +' + got + ' 金');
        /* 状态回落 */
        runners.forEach(function (r) {
            var st = mountState(myKing, r.nm);
            st.s = Math.max(20, st.s - (2 + rand(4)));
            if (st.sick && Math.random() < 0.5) st.sick = 0;
        });
        try { saveRaceState(); } catch (e) { }
        return { anim: anim, lines: lines, ticket: got };
    }

    /* 选拔赛入口：可选参赛马（默认全部），门票 = 参赛马数 × 1000 金 */
    function raceSelectDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var pool = raceMountPool().filter(function (m) { return m.king === myKing; });
        if (pool.length < 2) { alert2('至少要有 2 匹马才能办选拔赛。\n（当前 ' + pool.length + ' 匹，去收集赤兔/的卢 等战马）'); return; }
        var c = capitalCity(), city = c >= 0 ? cityAt(c) : null;
        var have = city ? (Number(city.Money) || 0) : 0;
        var lines = ['【马厩选拔赛】你自己的马互跑 · 收门票 · 每月一次',
            '门票 ' + SELECT_TICKET + ' 金/匹（观众付费，直接进你的都城金库）', ''];
        pool.forEach(function (m, i) {
            var st = mountState(myKing, m.nm);
            lines.push('  [' + i + '] ' + pad(m.nm, 8) + ' 移动+' + m.mv + '　状态 ' + st.s
                + (st.sick ? '（病）' : '') + '　门票 +' + SELECT_TICKET);
        });
        lines.push('');
        lines.push('  【全部出赛】（' + pool.length + ' 匹，门票 +' + (pool.length * SELECT_TICKET) + ' 金）');
        lines.push('  【一键全选后开赛】');
        menu(lines, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            if (ind < pool.length) {
                /* 单匹报名 = 只跑这匹（不足 2 匹会提示） */
                if (pool.length < 2) { alert2('不足 2 匹'); return; }
                var res = raceSelectRun([ind]);
                if (res) playRaceAnim(res.anim, res.lines, function () { stableDialog(); });
                return;
            }
            /* 全部出赛 */
            if (have >= pool.length * SELECT_TICKET || true) {
                var r2 = raceSelectRun(null);
                if (r2) playRaceAnim(r2.anim, r2.lines, function () { stableDialog(); });
            }
        });
    }

    function stableDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var persons = baye.data.g_Persons, rows = [], seen = {}, i, s, tid0, t, nm, mv;
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0 || p.Belong !== myKing) continue;
            for (s = 0; s < 2; s++) {
                if (!p.Equip[s]) continue;
                tid0 = p.Equip[s] - 1;
                t = baye.data.g_Tools[tid0];
                if (!t) continue;
                try { nm = gbkSafe(baye.getToolName(tid0)) || ''; } catch (e2) { nm = ''; }
                if (!isMountName(nm)) continue;                /* 只认文档里的 29 匹 */
                mv = MOUNT_MV[nm] || (t.move || 1);
                if (t.at || t.iq) {                            /* 混合型（坐骑附带攻防）另标注 */
                    rows.push({ nm: nm, mv: mv, who: nameOf(i), mixed: true, tid: tid0 });
                } else {
                    rows.push({ nm: nm, mv: mv, who: nameOf(i), mixed: false, tid: tid0 });
                }
                seen[nm] = 1;
            }
        }
        rows.sort(function (a, b) { return b.mv - a.mv || (a.nm < b.nm ? -1 : 1); });
        var lines = ['马厩 · 共有 ' + rows.length + ' 匹（登记在册 ' + Object.keys(seen).length + ' 种）',
            '按移动力排序',
            ''];
        if (!rows.length) {
            lines.push('（还没有马匹。赤兔/的卢/里飞沙 等 29 匹战马都可以收集）');
        } else {
            var myKing0 = (baye.data.g_PlayerKing || 0) + 1;
            for (i = 0; i < rows.length; i++) {
                var st0 = mountState(myKing0, rows[i].nm);
                lines.push(pad(rows[i].nm, 8) + ' 移动+' + rows[i].mv
                    + '　状态 ' + st0.s + (st0.sick ? '（病）' : '')
                    + (st0.streak >= 2 ? '　连胜' + st0.streak : '')
                    + '　' + rows[i].who + (rows[i].mixed ? '（混合型）' : ''));
            }
        }
        lines.push('');
        /* 赛马大会 v2：各势力出马、赛前报名（粮食报名费）、按状态+移动力综合评分 */
        lines.push('【赛马大会】各势力出马 · 每 3 个月一届（3/6/9/12 月）');
        lines.push('  距下届还有 ' + raceNextMonths() + ' 个月 · 第 ' + (raceSeason() + 1) + ' 届');
        lines.push('  报名费（粮草）：1匹 ' + raceEntryFee(1) + ' · 2匹 ' + raceEntryFee(2) + ' · 3匹 ' + raceEntryFee(3));
        if (RACE_ENTRY.length) {
            lines.push('  ★ 本届已报名：' + RACE_ENTRY.map(function (m) { return m.nm; }).join('、'));
        }
        if (RACE_HISTORY.length) {
            lines.push('  历届冠军：' + RACE_HISTORY.slice(0, 3).map(function (h) {
                return h.name + '·' + kingName(h.king) + '(' + h.date + ')';
            }).join('、'));
        }
        lines.push('【坐骑图鉴】登记在册的 ' + Object.keys(seen).length + ' 种');
        var byMv = { 3: [], 2: [], 1: [] };
        for (i = 0; i < rows.length; i++) (byMv[rows[i].mv] || byMv[1]).push(rows[i].nm);
        [3, 2, 1].forEach(function (m) {
            if (byMv[m] && byMv[m].length) {
                lines.push('  移动+' + m + '：' + byMv[m].join('、'));
            }
        });
        var lack = [];
        for (i = 0; i < MOUNT_NAMES.length; i++) if (!seen[MOUNT_NAMES[i]]) lack.push(MOUNT_NAMES[i]);
        if (lack.length) {
            /* 长名单一行塞不下会溢出成乱码（用户截图），改成每行 6 个分组显示 */
            lines.push('  未收集（' + lack.length + ' 种）：');
            for (i = 0; i < lack.length; i += 6) {
                lines.push('    ' + lack.slice(i, i + 6).join('、'));
            }
        }
        /* 末尾追加操作项（菜单行号 = lines 的下标） */
        var actBase = lines.length;
        lines.push('');
        lines.push('① 报名赛马大会（各势力同场竞技，冠军 ' + RACE_PRIZE[0] + ' 金）');
        lines.push('② 喂马：花 100 粮草提升状态（上限 100，可治病）');
        lines.push('③ 马厩选拔赛：自己的马互跑，每匹收门票 ' + SELECT_TICKET + ' 金（每月一次）');
        menu(lines, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            var k = ind - actBase;
            if (k === 1) { raceSignUpDialog(); return; }               /* 报名大会 */
            if (k === 2) { feedStableDialog(); return; }              /* 喂马提状态 */
            if (k === 3) { raceSelectDialog(); return; }              /* 选拔赛 */
        });
    }

    function forgeDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var items = [], pids = [];
        var persons = baye.data.g_Persons;
        for (var i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0 || p.Belong !== myKing) continue;
            var line = [], any = false, canF = 0;
            for (var s = 0; s < 2; s++) {
                if (!p.Equip[s]) { line.push('—'); continue; }
                var tid0 = p.Equip[s] - 1, t = baye.data.g_Tools[tid0];
                if (!t) { line.push('?'); continue; }
                any = true;
                var nm = '';
                try { nm = gbkSafe(baye.getToolName(tid0)) || ('#' + tid0); } catch (e2) { nm = '#' + tid0; }
                var lv = forgeLv(i, s);
                if (toolForgeable(tid0)) canF++;
                line.push(nm + (lv > 0 ? '+' + lv : ''));
            }
            if (!any) continue;
            /* 名字后直接带两件装备与强化等级；无可强化的标出来，避免点进去才发现 */
            items.push(pad(nameOf(i), 6) + (line.join(' ') + (canF ? '' : '（不可强化）')));
            pids.push(i);
        }
        if (!items.length) {
            menu(['没有可强化的装备。', '', '（只能强化己方武将身上的装备）', '闲置道具请先装备到武将身上。']);
            return;
        }
        menu(items, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            var pid = pids[ind];
            var slots = [], sidx = [];
            for (var s2 = 0; s2 < 2; s2++) {
                var t1 = personAt(pid) && personAt(pid).Equip ? personAt(pid).Equip[s2] : 0;
                if (!t1) continue;
                var tid0 = t1 - 1, t = baye.data.g_Tools[tid0];
                if (!t || t.useflag || forgeRarity(tid0) <= 0) continue;
                var nm = '';
                try { nm = gbkSafe(baye.getToolName(tid0)) || ('#' + tid0); } catch (e3) { nm = '#' + tid0; }
                var lv2 = forgeLv(pid, s2);
                var rar2 = forgeRarity(tid0);
                var cost2 = forgeCost(lv2, rar2);
                var rec2 = FORGE[forgeKey(pid, s2)] || { fail: 0 };
                var rate2 = forgeRate(lv2, rec2.fail);
                slots.push(pad(nm + ' +' + lv2, 12) + '费用' + pad(cost2, 6)
                    + '成功' + rate2 + '%　伤害×' + forgeDmgMul(lv2).toFixed(2)
                    + '→×' + forgeDmgMul(lv2 + 1).toFixed(2));
                sidx.push(s2);
            }
            if (!slots.length) {
                menu([nameOf(pid) + ' 身上没有可强化的装备。', '（消耗品/无属性道具不参与强化）']);
                return;
            }
            menu(slots, 0, function (ind2) {
                if (ind2 === baye.None || ind2 === 65535 || ind2 === undefined) return;
                forgeTry(pid, sidx[ind2]);
            });
        });
    }

    /* 确认页 → 强化 → 结果页（可继续强化） */
    function forgeTry(pid, slot) {
        var p = personAt(pid);
        var tid0 = p.Equip[slot] - 1;
        var rarity = forgeRarity(tid0);
        var rec = FORGE[forgeKey(pid, slot)] || { lv: 0, fail: 0 };
        var lv = rec.lv, cost = forgeCost(lv, rarity), rate = forgeRate(lv, rec.fail);
        var nm = '';
        try { nm = gbkSafe(baye.getToolName(tid0)) || ('#' + tid0); } catch (e) { }
        var mulNow = forgeDmgMul(lv), mulNext = forgeDmgMul(lv + 1);
        var lines = [
            nm + '  当前 +' + lv,
            '伤害 ×' + mulNow.toFixed(3),
            '',
            '强化到 +' + (lv + 1),
            lv >= FORGE_MAX ? '' : '伤害 ×' + mulNext.toFixed(3)
                + '（+' + Math.round((mulNext - 1) * 100) + '%）',
            lv >= FORGE_MAX ? '' : '费用 ' + cost + ' 金',
            lv >= FORGE_MAX ? '' : '成功率 ' + rate + '%'
                + (flag('forgePity') && rec.fail >= 5 ? '（保底必成）' : '')
                + (lv >= FORGE_SAFE_LV ? '（高阶保护：失败不掉级）' : '（失败 -1 级）')
        ];
        lines.push('');
        lines.push('花钱强化？');
        menu(lines, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            if (ind !== lines.length - 1) { forgeTry(pid, slot); return; }
            var r = forgeOnce(pid, slot);
            var res = [r.msg || '强化失败'];
            if (r.ok) {
                res.push('');
                res.push('当前 +' + r.lv + '　伤害 ×' + forgeDmgMul(r.lv).toFixed(3));
                res.push('');
                res.push('再强化一次？');
            }
            menu(res, 0, function (ind2) {
                if (ind2 === baye.None || ind2 === 65535 || ind2 === undefined) return;
                if (r.ok && ind2 === res.length - 1) forgeTry(pid, slot);
                else forgeDialog();
            });
        });
    }

    /* ---------- 资源管理菜单（游戏内 H → 资源管理） ---------- */
    function showResourceMenu() {
        var MAX = maxLevelOf();
        var ids = ownGenerals(false);
        var cap = capitalCity();
        var capName = cap >= 0 ? cityName(cap) : '（无城）';
        var purse = 0, full = 0, my = ownCities((baye.data.g_PlayerKing || 0) + 1), pc;
        for (var pi = 0; pi < my.length; pi++) {
            pc = cityAt(my[pi]); if (!pc) continue;
            purse += (pc.Money || 0);
            if ((pc.Money || 0) >= MONEY_SOFT_CAP) full++;
        }
        var lines = [
            '资源管理',
            '',
            '都城 ' + capName + '　势力金币合计 ' + purse + '（' + my.length + ' 座城'
                + (full ? '，其中 ' + full + ' 座已满' : '') + '）',
            '金币每月加多少：' + (Number(cfg.richAmount) || 3000) + '（与粮草同一个额度）',
            '己方武将 ' + ids.length + ' 名　等级上限 ' + MAX,
            ''
        ];
        /* 动作按真实行号登记：菜单前有 5 行表头，若硬编码 1~5 会全部错位失效（v1.11.1 修复） */
        var acts = {};
        function addAct(label, fn) { acts[lines.length] = fn; lines.push(label); }
        addAct('【1】立即加钱（君主所在城）', function () { doRich(false, true); });
        addAct('【2】立即加粮（君主所在城）', function () { doFood(false, true); });
        addAct('【3】把金币补到上限（手动）', function () {
            var mine2 = ownCities((baye.data.g_PlayerKing || 0) + 1), did = [];
            for (var i2 = 0; i2 < mine2.length; i2++) {
                var ct2 = cityAt(mine2[i2]);
                if (!ct2) continue;
                var before2 = Number(ct2.Money) || 0;
                if (before2 >= 65535) continue;
                ct2.Money = 65535;
                RES_LAST[mine2[i2]] = Number(ct2.Money) || 0;
                did.push(cityName(mine2[i2]) + ' ' + before2 + '→' + (Number(ct2.Money) || 0));
            }
            alert2(did.length ? ('已补到上限：\n' + did.join('\n')) : '所有己方城池都已经是 65535 了。');
        });
        addAct('【3】全员加经验 +30', function () { boostExperience(30, false, false); });
        addAct('【4】全员加经验 +100', function () { boostExperience(100, false, false); });
        addAct('【5】一键满级（全员 ' + MAX + ' 级）', function () { levelUpAll(false, false); });
        addAct('【6】获取全部道具（一次性）', function () { giveAllTools(false); });
        lines.push('');
        lines.push('【每月自动执行】加钱：' + (flag('richMode') ? '开' : '关') + '　道具投放：' + (flag('allTools') ? '开' : '关')
            + '　加经验：' + (flag('levelBoost') ? '开' : '关'));
        lines.push('【上限】' + (flag('noResCap') ? '防截断已开（引擎削到 30000 时自动补回）'
            : '防截断已关（引擎每月削到 30000）'));
        lines.push('【读档时自动】全员满级：' + (flag('levelBoostAll') ? '开' : '关')
            + '　（以上都可在面板对应开关里调整；本菜单的即时功能不依赖它们）');
        menu(lines, 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            /* 这五个函数内部已自带 alert（silent=false），不要再叠加一次弹窗。 */
            if (!acts[ind]) { showResourceMenu(); return; }
            acts[ind]();
            /* 引擎的 alert / 菜单都是异步 UI：延时一帧再回菜单，避免与提示框抢占 */
            setTimeout(function () { try { showResourceMenu(); } catch (e) { } }, 30);
        });
    }

    function showForge() {
        menu(forgeListLines(), 0, function (ind) {
            if (ind === baye.None || ind === 65535 || ind === undefined) return;
            forgeDialog();
        });
    }

    /* ======================== 7.6 资源管理（一夜暴富 / 等级提升 / 道具全收） ========================
       三个功能都基于引擎已核实的事实：

       1) 一夜暴富：city.Money 是城池字段，引擎会「月入 = Commerce×0.05」缓慢积累，
          上限 30000（原版机制，Money>30000 截断）。
          钱加在<b>君主所在城</b>，因为引擎指令与商店都从都城支取。

       2) 等级提升：Person.Experience 是 0~100 的经验进度条，
          引擎 tacticStage4 每月判断 Experience >= 阈值就 Level+1（上限 maxLevel=30）。
          所以「加经验」是安全的渐进方式；而「直接设 Level」会让 Experience 与Level
          不匹配（引擎下次结算时按 Experience 继续加，运气好会连跳）。
          一键满级走「补满经验 + 循环升级到上限」。

       3) 获取全部道具：baye.data.g_Tools 是道具原型表（长度数千，含大量空槽），
          baye.putToolInCity(city, tid, flag) 才是投放接口。
          只投「真有名字」且「不是消耗品空壳」的道具，否则一次塞几千个空道具会卡死存档。 */

    /* ---------- 一夜暴富 ---------- */
    /* 君主所在城：优先 SatrapId == 君主，否则第一座己方城 */
    function capitalCity() {
        var cities = baye.data.g_Cities;
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var i, c;
        for (i = 0; i < cities.length; i++) {
            if (cities[i].Belong === myKing && cities[i].SatrapId === myKing) return i;
        }
        for (i = 0; i < cities.length; i++) if (cities[i].Belong === myKing) return i;
        return -1;
    }

    /* 引擎金币上限：默认按 30000（用户实测的原版上限），
       若引擎实际更低，写后回读会自动校准；也可在面板里手动指定（cfg.moneyCap>0 时优先）。 */
    var MONEY_SOFT_CAP = 30000;
    var MONEY_CAP_PROBED = 0;          /* 已知的引擎实测上限（0=未知） */

    /* 上限只由「实测校准」决定：cfg.moneyCap 已从面板移除，
       早期版本手填的测试值（如 66666）不该继续影响发钱。 */
    function effMoneyCap() {
        if (MONEY_CAP_PROBED > 0) return MONEY_CAP_PROBED;
        return RES_CAP_MONEY;
    }

    /* 给单座城加钱（写后回读校准）。返回 { got, before, after, capped } */
    function setCityMoney(city, want) {
        if (!city) return { got: 0, before: 0, after: 0, capped: true };
        var cap = effMoneyCap();
        var before = Number(city.Money) || 0;
        if (before >= cap) return { got: 0, before: before, after: before, capped: true };
        var after = Math.min(cap, before + want);
        city.Money = after;
        var real = Number(city.Money);
        if (!isFinite(real) || real < 0) real = after;
        if (real < after) {
            /* 引擎实际给的值更少 → 说明真实硬上限更低，校准后按真实值重试一次 */
            MONEY_CAP_PROBED = real;
            MONEY_SOFT_CAP = real;
            city.Money = Math.min(real, before + want);
            real = Number(city.Money) || 0;
        }
        return { got: real - before, before: before, after: real, capped: real < before + want };
    }

    /* 探测引擎真实金币上限：往都城写一个很大的数，看回读是多少 */
    function probeMoneyCap() {
        var c = capitalCity();
        if (c < 0) { alert2('没有己方城池，无法探测'); return 0; }
        var city = cityAt(c);
        var old = Number(city.Money) || 0;
        var back = 0, guess;
        for (guess = 30000; guess >= 1000; guess = Math.round(guess / 2)) {
            city.Money = guess;
            back = Number(city.Money) || 0;
            if (back >= guess) break;
            if (guess <= 1000) break;
        }
        city.Money = Math.min(old, back || old);
        MONEY_CAP_PROBED = back;
        MONEY_SOFT_CAP = back;
        var msg = '探测结果：引擎单城金币上限 = ' + back + '（已写回原值 ' + Math.min(old, back) + '）\n'
            + '若与你的预期不符，可在面板「金币上限」里手动填数值（填 0 = 自动跟随探测值）';
        alert2(msg);
        log(msg);
        return back;
    }

    /* 一夜暴富 / 资源管理「立即加钱」：
       都城优先，都城满了自动接着给其他己方城池（v1.11.5：以前只给都城一座，
       都城一旦到上限就几乎加不进去，用户看到的就是「只+1」）。
       汇报时逐城列出 before→after，并明确告知是否有剩余没发出去。 */
    /* ---------- 资源上限：真·跨月结转（v1.12.3） ----------
       查引擎源码后的结论（baye.wasm 反汇编）：
       ① 30000 是引擎硬编码，lib 脚本与 g_engineConfig 里都没有这个参数，脚本层改不了；
       ② 它出现在**月结流程**（function #351，8908 字节）里，形式是先 `& 0xFFFF` 再与 30000 比较，
          所以钳制发生在月结那一步，不是每次赋值 —— 月中持有超过 3 万是可能的，
          但月结会被夹回 30000，超出部分直接消失。
       因此「解除上限」的正确做法不是每月补到 3 万（那确实只是当月随便花），
       而是：月结前记下被吞掉的差额 → 下月初连本带利补回去，实现跨月结转。
       上限取 65535：引擎内部多处 `& 0xFFFF`（16 位运算），
       Money/Food 超过 65535 会让那些判断看到错值，所以结转封顶在 65535（=30000+35535）。
       能不能真的存下 >30000 由引擎决定（字段本身可能不钳制）→ 首次运行时自动实测：
       写 65535 读回，若读回仍是 65535 → 结转生效；被夹回 30000 → 退化为「每月补满」。 */
    /* 金币：实测字段可存到 65535（写 65535/60000/45000/30001 均成功，只有 >65535 被截）。
       30000 只是引擎「月结」时的夹断，月初补回即可绕过 → 目标值设为 65535。*/
    var RES_CAP_MONEY = 65535, RES_CAP_FOOD = 0;    /* 粮草 0 = 未探测 */
    var RES_WRITE_MAX = 0;                          /* 实测：字段能存的最大值（0=未知） */
    var warnedCapOff = 0;                           /* 关着开关时的提示只弹一次 */
    var RES_SNAP = {};                              /* 城号 -> 月结前的 Money/Food */
    var RES_CARRY = {};                             /* 城号 -> 已结转的 Money/Food */
    /* 每座城最近一次的金币额度：用来判断「这笔钱是被引擎削的，还是我自己花掉的」。
       被削 → 钱恰好停在 30000；自己花 → 各种零散数字，不会正好是 30000。 */
    var RES_LAST = {};
    function resState(c) {
        if (!RES_CARRY[c]) RES_CARRY[c] = { money: 0, food: 0 };
        return RES_CARRY[c];
    }
    /* 首次运行时实测字段能否存下 >30000（写 65535 读回，再还原） */
    function probeResWriteCeiling(city) {
        if (RES_WRITE_MAX) return RES_WRITE_MAX;
        try {
            var om = Number(city.Money) || 0, of = Number(city.Food) || 0;
            city.Money = 65535;
            var backM = Number(city.Money) || 0;
            city.Money = om;
            if (!RES_CAP_FOOD) RES_CAP_FOOD = probeResCap(city, 'Food', 60000) || 60000;
            city.Food = 65535;
            var backF = Number(city.Food) || 0;
            city.Food = of;
            RES_WRITE_MAX = Math.min(backM, backF);
            if (RES_WRITE_MAX < 30001) {
                log('实测：字段本身就把资源钳在 30000（写 65535 回读 ' + backM + '/' + backF
                    + '），跨月结转不可用 → 退化为「每月补满到上限」');
            } else {
                log('实测：资源可存到 ' + RES_WRITE_MAX + '（引擎只在月结钳制）→ 跨月结转已启用');
            }
        } catch (e) { }
        return RES_WRITE_MAX;
    }
    function probeResCap(city, field, guess) {
        try {
            var old = Number(city[field]) || 0;
            var back = 0, g;
            for (g = guess; g >= 500; g = Math.round(g / 2)) {
                city[field] = g;
                back = Number(city[field]) || 0;
                if (back >= g) break;
                if (g <= 500) break;
            }
            city[field] = Math.min(old, back || old);
            return back;
        } catch (e) { return 0; }
    }
    /* 月结（tacticStage5，引擎钳制之前）记下每座己方城的资源值 */
    function snapshotResPreClamp() {
        var mine = ownCities((baye.data.g_PlayerKing || 0) + 1), i, c, city;
        for (i = 0; i < mine.length; i++) {
            c = mine[i];
            city = cityAt(c);
            if (!city) continue;
            RES_SNAP[c] = { money: Number(city.Money) || 0, food: Number(city.Food) || 0 };
        }
    }
    /* 每月月初：把上月被引擎吞掉的差额结转回来 + 补满基线 */
    /* 每月末（tacticStage5）记下每座己方城池的金币额度 —— 此刻引擎还没削，是真实值 */
    function recordResBase() {
        var mine = ownCities((baye.data.g_PlayerKing || 0) + 1), i, city;
        for (i = 0; i < mine.length; i++) {
            city = cityAt(mine[i]);
            if (city) RES_LAST[mine[i]] = Number(city.Money) || 0;
        }
    }
    /* 每月初（tacticStage1）：引擎月结已经跑完。
       若某城金币「正好被削到 30000」且上月末记录过更高额度 → 判定被削，补回。
       若上月末本来就只剩 30000（玩家自己花光的）→ 不补。 */
    function restoreResIfClamped() {
        if (!flag('noResCap')) return;
        var mine = ownCities((baye.data.g_PlayerKing || 0) + 1), out = [], i, c, city, remember, curM;
        for (i = 0; i < mine.length; i++) {
            c = mine[i];
            city = cityAt(c);
            if (!city) continue;
            remember = RES_LAST[c];
            curM = Number(city.Money) || 0;
            if (curM === 30000 && remember && remember > 30000) {
                city.Money = remember;
                var realM = Number(city.Money) || 0;
                if (realM > 30000) {
                    out.push(cityName(c) + ' 被削到 30000 → 补回 ' + realM);
                } else {
                    out.push(cityName(c) + ' 被削到 30000（补回失败，引擎只给 ' + realM + '）');
                }
            }
            /* 粮草：只在被 %65536 绕回归零时补回 */
            var curF = Number(city.Food) || 0;
            if (curF <= 50) {
                city.Food = 65535;
                out.push(cityName(c) + ' 粮溢出归零 → 补回 ' + (Number(city.Food) || 0));
            }
        }
        if (out.length) {
            log('资源防截断：' + out.join('；'));
        }
    }

    /* 资源防截断（v1.13.7）
       引擎规则（已实测+源码反汇编）：金币字段能存 65535，但每月结算里
       `Money = 1 + Money + Commerce/2.5` 会把超过 30000 的部分削掉。
       脚本改不了引擎，只能事后补偿。但「补偿」≠「补满」——

       ★ 关键区分（用户明确要求）★
         · 被引擎削：钱从高位突然掉到 30000  → 补回差额
         · 自己花钱：65535 → 50000 → 30000 这种平滑下降 → **绝不补**
       所以必须记住「上次有多少钱」，只在检测到「钱被削到 30000」时补：

         记LAST  = 上次结算后的钱（65535）
         本月结算后 = 30000，若 30000 < LAST 且 差值很大 → 判定被削，
         补回 LAST 的值；若 30000 正好等于玩家"自己能花到的水平"，
         说明是正常消费，不补。

       实际判据（简单可靠）：**只在钱恰好等于 30000 时补**，
       因为玩家自己花钱几乎不会正好停在 30000 这个整数上。 */
    /* 手动把金币补到上限（资源管理菜单的按钮用）。
       自动的「被削就补」走 restoreResIfClamped，这里只负责你主动点一下。 */
    function refillResources(verbose) {
        var out = [], i, c, city;
        var mine = ownCities((baye.data.g_PlayerKing || 0) + 1);
        for (i = 0; i < mine.length; i++) {
            c = mine[i];
            city = cityAt(c);
            if (!city) continue;
            var curM = Number(city.Money) || 0;
            if (curM >= 65535) continue;
            city.Money = 65535;
            var realM = Number(city.Money) || 0;
            RES_LAST[c] = realM;                    /* 记为月末基准 */
            out.push(cityName(c) + ' 金 ' + curM + '→' + realM);
        }
        if (verbose) alert2(out.length ? ('已补到上限：\n' + out.join('\n')) : '所有己方城池都已经是 65535 了。');
        return out;
    }

    /* ---------- 立即加粮（v1.12.4） ----------
       粮草与金币的溢出行为不同（引擎 WASM 反汇编结论）：
         · 金币：月结 min(值,30000) 夹住 → 超出部分可恢复 → 可以跨月结转；
         · 粮草：引擎对 Food 做 `& 0xFFFF`（等价 %65536）再写回 → 65536 恰好变成 0，
                 超过 65535 的部分直接绕回、不可恢复。
       所以粮草不做结转，只保证「永远不触发绕回」：每月补到 65535（16 位内的最大值）。 */
    var FOOD_SAFE_MAX = 65535;
    function setCityFood(city, want) {
        if (!city) return { got: 0, before: 0, after: 0, capped: true };
        var before = Number(city.Food) || 0;
        if (before >= FOOD_SAFE_MAX) return { got: 0, before: before, after: before, capped: true };
        var after = Math.min(FOOD_SAFE_MAX, before + want);
        city.Food = after;
        var real = Number(city.Food) || 0;
        if (!isFinite(real) || real < 0) real = after;
        /* 写多了会绕回（65536→0），这里必须夹回安全值 */
        if (real > FOOD_SAFE_MAX || real < before) {
            city.Food = Math.min(FOOD_SAFE_MAX, Math.max(before, real));
            real = Number(city.Food) || 0;
        }
        return { got: real - before, before: before, after: real, capped: real < before + want };
    }
    function doFood(silent, force) {
        if (!force && !flag('richMode')) return 0;
        var c = capitalCity();
        if (c < 0) { if (!silent) alert2('没有己方城池，无法增加粮草'); return 0; }
        var want = Math.max(0, Math.round(safeWeight('richAmount', 3000)));
        if (!want) { if (!silent) alert2('加粮数量为 0（可在金手指面板里改「暴富金额」）'); return 0; }
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var order = [c], i, list = ownCities(myKing);
        for (i = 0; i < list.length; i++) if (list[i] !== c) order.push(list[i]);
        var left = want, total = 0, notes = [];
        for (i = 0; i < order.length && left > 0; i++) {
            var r = setCityFood(cityAt(order[i]), left);
            if (r.got > 0) {
                total += r.got; left -= r.got;
                RES_LAST[order[i]] = r.after;            /* 手动加的钱也算基准，别当成被削 */
                notes.push(cityName(order[i]) + ' ' + r.before + '→' + r.after);
            }
        }
        if (!silent) {
            alert2('增加粮草 ' + total + '（计划 ' + want + '）\n'
                + (notes.length ? notes.join('\n') : '（没有可加的城）')
                + '\n粮草安全上限 ' + FOOD_SAFE_MAX + '（引擎对粮草做 %65536，超过会绕回 0，粮草不能跨月结转）'
                + (left > 0 ? '\n⚠ 剩余 ' + left + ' 没能发放（后面的城也已满）' : ''));
        }
        return total;
    }

    function doRich(silent, force) {
        if (!flag('richMode') && !force) return 0;   /* 资源管理菜单手动点击时 force=true，不依赖月度开关 */
        var c = capitalCity();
        if (c < 0) { if (!silent) alert2('没有己方城池，无法增加金钱'); return 0; }
        var want = Math.max(0, Math.round(safeWeight('richAmount', 3000)));
        if (!want) { if (!silent) alert2('暴富金额为 0，未发放（可在金手指面板里改）'); return 0; }
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var order = [c], i, list = ownCities(myKing);
        for (i = 0; i < list.length; i++) if (list[i] !== c) order.push(list[i]);
        var left = want, total = 0, notes = [], short = false;
        for (i = 0; i < order.length && left > 0; i++) {
            var r = setCityMoney(cityAt(order[i]), left);
            if (r.got > 0) { total += r.got; left -= r.got; notes.push(cityName(order[i]) + ' ' + r.before + '→' + r.after); }
            if (r.capped) short = true;
        }
        if (!silent) {
            var capNow = effMoneyCap();
            var msg = '增加金钱 ' + total + '（计划 ' + want + '）\n'
                + (notes.length ? notes.join('\n') : '（没有可加的城）');
            if (total === 0 && want > 0) {
                msg += '\n金币到引擎硬上限 ' + RES_CAP_MONEY + ' 了，脚本加不进去（只能靠商贸月入）';
            } else if (left > 0) {
                msg += '\n还有 ' + left + ' 没发出去（后面的城也满了）';
            } else if (left > 0) {
                msg += '\n⚠ 剩余 ' + left + ' 没能发放（后面的城也已满）—— 先花掉一些或把「暴富金额」调小';
            }
            alert2(msg);
        }
        return total;
    }

    /* ---------- 武将等级提升 ---------- */
    function maxLevelOf() {
        try {
            var ec = baye.data.g_engineConfig;
            if (ec && ec.maxLevel > 0) return ec.maxLevel;
        } catch (e) { }
        return 30;
    }

    /* 等级提升的「累加成长」补正。
       记忆里的关键事实：g.atk/def/hp/speed 是升级累加值，
       只改 Level 不补成长 → 战斗里的伤害恒为1（因为 atk-def 差算错）。
       这里按「每级 武力+1.2 / 智力+0.8」的中位成长补一层保守估计，
       避免把武将数值撑爆；不想动g_ 字段的可以只升 Level（打傷害会偏低但不出错）。 */
    function recalcGrowth(p) {
        try {
            var lv = p.Level || 1;
            /* 只在 Level 高于累加成长时补，不覆盖引擎自己算的 */
            var expectAtk = Math.floor(lv * 1.2);
            var expectDef = Math.floor(lv * 0.8);
            if (typeof p.atk !== 'number') p.atk = expectAtk;
            else if (p.atk < expectAtk * 0.5) p.atk = expectAtk;
            if (typeof p.def !== 'number') p.def = expectDef;
            else if (p.def < expectDef * 0.5) p.def = expectDef;
        } catch (e) { }
    }

    /* 给单个武将加经验（跨月累积） */
    function addExperience(idx, exp) {
        var p = personAt(idx);
        if (!p || !p.Level || p.Level <= 0) return false;
        var MAX = maxLevelOf();
        if (p.Level >= MAX) return false;
        p.Experience = (p.Experience || 0) + exp;
        if (p.Experience >= 100) {
            p.Experience -= 100;
            p.Level += 1;
            recalcGrowth(p);
        }
        return true;
    }

    /* 己方武将列表（含在野与俘虏，按需过滤） */
    function ownGenerals(onlyInCity) {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var out = [], persons = baye.data.g_Persons, i;
        var inCity = {};
        if (onlyInCity) {
            var cities = baye.data.g_Cities, c;
            for (c = 0; c < cities.length; c++) {
                var list = personsOfCity(c);
                for (i = 0; i < list.length; i++) inCity[list[i]] = 1;
            }
        }
        for (i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0) continue;
            if (p.Belong !== myKing) continue;
            if (onlyInCity && !inCity[i]) continue;
            out.push(i);
        }
        return out;
    }

    /* 一键满级：把己方所有武将拉到上限 */
    function levelUpAll(onlyInCity, silent) {
        var ids = ownGenerals(onlyInCity), MAX = maxLevelOf();
        var n = 0, names = [];
        for (var i = 0; i < ids.length; i++) {
            var p = personAt(ids[i]);
            if (!p || p.Level >= MAX) continue;
            p.Experience = 0;
            p.Level = MAX;
            recalcGrowth(p);
            n++;
            if (names.length < 6) names.push(nameOf(ids[i]));
        }
        if (!silent) {
            alert2('已把 ' + n + ' 名己方武将升到 ' + MAX + ' 级'
                + (names.length ? '\n' + names.join('、') + (n > 6 ? ' 等' : '') : ''));
        }
        return n;
    }

    /* 武将等级提升：单次给全部己方武将加经验 */
    function boostExperience(amount, onlyInCity, silent) {
        var ids = ownGenerals(onlyInCity);
        var n = 0, sum = 0;
        for (var i = 0; i < ids.length; i++) {
            var p = personAt(ids[i]);
            if (!p || p.Level >= maxLevelOf()) continue;
            if (addExperience(ids[i], amount)) { n++; sum += amount; }
        }
        if (!silent) {
            alert2('给 ' + n + ' 名己方武将各加 ' + amount + ' 点经验'
                + (n ? '（共 ' + sum + ' 点）' : '（可能都已满级）'));
        }
        return n;
    }

    /* ---------- 获取全部道具 ---------- */
    /* 扫道具原型表：只取「有名字 + 有属性或明确是道具」的条目 */
    function allRealTools() {
        var tools = baye.data.g_Tools, out = [], i, t;
        for (i = 0; i < tools.length; i++) {
            t = tools[i];
            if (!t) continue;
            var nm = '';
            try { nm = gbkSafe(baye.getToolName(i)) || ''; } catch (e) { }
            if (!nm) continue;
            /* 跳过「无属性的空壳道具」（既没有 at/iq/move，也不是消耗品） */
            var hasAttr = (t.at || 0) + (t.iq || 0) + (t.move || 0) > 0;
            if (!hasAttr && !t.useflag) continue;
            out.push({ tid: i, name: nm, at: t.at || 0, iq: t.iq || 0, move: t.move || 0, use: t.useflag ? 1 : 0 });
        }
        return out;
    }

    /* 把全部道具塞进指定城池（默认君主所在城）。
       分批投放并去重：同一 tid 只放一次，避免把存档塞爆。 */
    function giveAllTools(silent) {
        var c = capitalCity();
        if (c < 0) { if (!silent) alert2('没有己方城池，无法投放道具'); return 0; }
        var list = allRealTools();
        if (!list.length) { if (!silent) alert2('道具表是空的（引擎未加载完成？）'); return 0; }
        var ok = 0, fail = 0;
        for (var i = 0; i < list.length; i++) {
            try {
                baye.putToolInCity(c, list[i].tid, 0);
                ok++;
            } catch (e) { fail++; }
        }
        if (!silent) {
            alert2('已向 ' + cityName(c) + ' 投放 ' + ok + ' 种道具'
                + (fail ? '（' + fail + ' 种失败）' : '')
                + '\n共 ' + list.length + ' 种（已过滤空壳槽位）');
        }
        return ok;
    }

    /* ---------- 每月执行（挂在 tacticStage5 月末） ---------- */
    function monthlyBoon() {
        var notes = [];
        /* 每月自动加钱已移除（面板开关也删了）：加钱改成「想加多少就在资源管理里点一次」，
           避免旧配置里残留的 richMode=1 每个月白送一笔。 */
        try {
            if (flag('allTools')) {
                var n = giveAllTools(true);
                if (n > 0) notes.push('【道具】' + cityName(capitalCity()) + ' 投放 ' + n + ' 种');
            }
        } catch (e2) { }
        try {
            if (flag('levelBoost')) {
                var k = boostExperience(30, false, true);
                if (k > 0) log('批量加经验：' + k + ' 名武将各 +30 经验');
            }
        } catch (e3) { }
        return notes;
    }

    /* ======================== 8. 设置面板（HTML 悬浮层） ======================== */

    var UI_CSS = [
        /* 默认锚在右下角（v1.11.1）：图标可拖动，拖动后按拖动位置记忆 */
        '#bayeCheatDock{position:fixed;right:10px;bottom:12px;z-index:2147483000;font:13px/1.6 -apple-system,"PingFang SC",sans-serif}',
        '#bayeCheatDock button{font:inherit}',
        '#bayeCheatDock .bd{width:34px;height:34px;border-radius:50%;border:1px solid rgba(0,0,0,.15);background:#fff;color:#333;font-size:19px;',
        '  box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer;padding:0;line-height:32px;opacity:.55}',
        '#bayeCheatDock .bd:hover{opacity:1}',
        /* 面板绝对定位在图标上方（右下角默认向上弹，不占屏幕外）；靠上拖动时加 .down 向下弹 */
        '#bayeCheatDock .panel{display:none;position:absolute;bottom:calc(100% + 10px);right:0;width:min(330px,92vw);max-height:min(440px,72vh);overflow-y:auto;',
        '  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;background:#fff;',
        '  border-radius:12px;box-shadow:0 6px 26px rgba(0,0,0,.25);padding:10px 12px 14px;color:#1f1f1f}',
        '#bayeCheatDock .panel.down{bottom:auto;top:calc(100% + 10px)}',
        '#bayeCheatDock.on .panel{display:block}',
        '#bayeCheatDock h4{margin:10px 0 6px;font-size:12px;font-weight:600;color:#7a7a7a;letter-spacing:.5px}',
        '#bayeCheatDock h4:first-child{margin-top:2px}',
        '#bayeCheatDock .row{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f2f2f2;',
        '  border-radius:10px;padding:8px 12px;margin:8px 0}',
        '#bayeCheatDock .row .t{font-size:14px;font-weight:500}',
        '#bayeCheatDock .row .d{font-size:11.5px;color:#8a8a8a;line-height:1.45;margin-top:2px}',
        '#bayeCheatDock .sw{flex:0 0 auto;width:46px;height:26px;border-radius:13px;background:#d8d8d8;position:relative;',
        '  cursor:pointer;transition:background .18s;border:none;padding:0}',
        '#bayeCheatDock .sw i{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;',
        '  box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .18s}',
        '#bayeCheatDock .sw.on{background:#3ec26a}',
        '#bayeCheatDock .sw.on i{left:23px}',
        '#bayeCheatDock .nums{display:flex;flex-direction:column;gap:6px;margin:6px 0 0}',
        '#bayeCheatDock .nums label{font-size:12px;color:#555;display:flex;flex-direction:column;align-items:stretch;gap:4px;line-height:1.35}',
        '#bayeCheatDock .nums input{width:100%;min-width:0;box-sizing:border-box;padding:5px 7px;border:1px solid #dcdcdc;border-radius:6px;font-size:12.5px}',
        '#bayeCheatDock .fn{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
        '#bayeCheatDock .fn button{flex:1;min-width:84px;padding:7px 8px;border:1px solid #e0e0e0;background:#fafafa;',
        '  border-radius:8px;font-size:12.5px;cursor:pointer;color:#333}',
        '#bayeCheatDock .fn button:hover{background:#f0f0f0}',
        '#bayeCheatDock .dr{flex:1;min-width:56px;padding:7px 6px;border:1px solid #e0e0e0;background:#fafafa;border-radius:8px;font-size:12.5px;cursor:pointer;color:#333}',
        '#bayeCheatDock .dr.on{background:#3ec26a;border-color:#3ec26a;color:#fff;font-weight:600}',
        '#bayeCheatDock .wf{flex:1;min-width:56px;padding:7px 6px;border:1px solid #e0e0e0;background:#fafafa;border-radius:8px;font-size:12.5px;cursor:pointer;color:#333}',
        '#bayeCheatDock .wf.on{background:#3ec26a;border-color:#3ec26a;color:#fff;font-weight:600}',
        '#bayeCheatDock .sm{flex:1;min-width:56px;padding:7px 6px;border:1px solid #e0e0e0;background:#fafafa;border-radius:8px;font-size:12.5px;cursor:pointer;color:#333}',
        '#bayeCheatDock .sm.on{background:#3ec26a;border-color:#3ec26a;color:#fff;font-weight:600}',
        '#bayeCheatDock .slot{flex:1;min-width:52px;padding:7px 6px;border:1px solid #e0e0e0;background:#fafafa;border-radius:8px;font-size:12.5px;cursor:pointer;color:#333}',
        '#bayeCheatDock .slot.on{background:#3ec26a;border-color:#3ec26a;color:#fff;font-weight:600}',
        '#bayeCheatDock .slot.live{box-shadow:0 0 0 2px #3ec26a inset;color:#2c7a4b;font-weight:600}',
        '#bayeCheatDock .slot.on.live{color:#fff}',
        '#bayeCheatDock .bind{flex:1;min-width:74px;padding:7px 6px;border:1px dashed #bcd8c4;background:#f4fbf6;border-radius:8px;font-size:12px;cursor:pointer;color:#2c7a4b}',
        '#bayeCheatDock .bind:hover{background:#e8f6ee}',
        '#bayeCheatDock .tip{font-size:11px;color:#a0a0a0;margin-top:8px;line-height:1.5}',
        '#bayeCheatDock .sublabel{font-size:11.5px;color:#8a8a8a;margin-top:12px;font-weight:600}'
    ].join('');

    var UI_ROWS = [
        { k: 'surrender', t: '招降/招揽必定成功', d: '开启后招降和招揽指令当场生效（武将当场对话），无视忠诚值和其他限制' },
        { k: 'searchGen', t: '搜寻必定成功', d: '开启后搜寻当场招到武将（城内在野优先），无视伯乐属性和随机性' },
        { k: 'searchTool', t: '搜寻道具必定成功', d: '开启后搜寻当场发现城中隐藏的道具（不会复制他人道具），优先级在武将搜寻之后' },
        { k: 'noDeathRescue', t: '自动阵亡补救', d: '默认关。开启后每月自动把「上月确实在城、本月消失」的武将按重伤找回；也可以在游戏内「武将修复」里逐个选人找回' },
        { k: 'kingGuard', t: '君主免疫俘虏', d: '势力仍有城池可退时，君主改为转移+重伤；只剩最后一城时照常被俘（保留灭国代价）。每月还会做一次城池名册自愈：君主/武将错列或重复在册会自动归位' },
        { k: 'autoBalance', t: 'AI 托管战斗加权结算', d: '武将战力×兵力×城防×战场地形加权，替代原版「只比总兵力」，杜绝一将挡八将' },
        { k: 'engineSettle', t: '托管战斗交还引擎结算', d: '默认关。开启后 AI 之间的战斗完全按引擎原版流程结算（战斗动画里的「双 VS」重叠即由此开关验证）；代价是这类战斗不再记入月报/参战名单，也不在战场抢救君主' },
        { k: 'noDisaster', t: '城池无灾害', d: '默认关闭（尊重原机制）。开启后每月把己方城池防灾值拉满并清除已有的饥荒/旱灾/水灾/暴动' },
        { k: 'noResCap', t: '资源防截断', d: '默认开启。引擎每月结算会把金币削到 30000；本项只在检测到「被削到 30000」时补回原额度（你自己花掉的钱不会补）。粮草被引擎溢出归零时也会补回' },
        { k: 'forge', t: '铁匠铺（装备强化）', d: 'DNF 式强化：花钱提升装备等级（等级不设上限），等级越高越贵、成功率越低、失败掉 1 级。强化只加伤害系数，不改引擎的武力/智力面板数值，列表里以「+N」标注' },
        { k: 'forgePity', t: '强化保底', d: '默认开启。连续失败 8 次后下一次必定成功，避免高等级陷入无限掉级（+20 以上成功率仅 4%）' },
        { k: 'raceOn', t: '赛马大会（每 3 个月）', d: '默认开启。每 3 个月（3/6/9/12 月）月末在都城自动举办，按坐骑移动力排名发奖金（第1名 1500 金，逐级递减到 200 金），奖金直接进都城金币用于强化。有马厩后可随时手动举办；马厩里还有「喂马」消耗 500 粮草换 800 金' },
        { k: 'aiForge', t: 'AI 势力也会强化', d: '默认开启。每个 AI 势力用自己的城池收入强化自己的武将（花钱按玩家的 34% 计价、成功率低 8 个百分点、最高等级=城池数+6）。这样玩家 +20 时 AI 也在成长，不会单方面碾压；同时 AI 变强会消耗它的经济 → 出征变慢' },
        { k: 'levelBoost', t: '武将等级提升', d: '每月给全部己方武将 +30 经验（引擎经验条满 100 即升 1 级，等级上限由引擎 maxLevel 决定，默认 30）' },
        { k: 'forgeGuarantee', t: '强化必定成功', d: '默认关。开启后强化成功率强制 100%（费用照收），配合铁匠铺快速刷高等级用' },
        { k: 'aiEmptyCity', t: 'AI 攻占空城', d: '原版 AI 永远不打无主城（引擎目标筛选排除了空城）。开启后每月最多让相邻 AI 势力派 1 名武将进驻空城，月报有记录' },
        { k: 'waterTactic', t: '水城地形修正', d: '北海、吴等水域战场：无水兵的部队战力大幅折减（骑兵最惨、水兵不受影响）。水域占比在亲历战斗时自动记录并永久缓存' },
        { k: 'verbose', t: '控制台详细日志', d: '输出每次结算的战力对比、水域占比与胜率，便于调权重' }
    ];

    var DOCK_POS_KEY = 'baye_cheat_dock_pos_v2';   /* v2：默认改右下角，丢弃旧版右上角记忆 */

    function buildUI() {
        if (document.getElementById('bayeCheatDock')) return;
        var st = document.createElement('style');
        st.textContent = UI_CSS;
        document.head.appendChild(st);

        var wrap = document.createElement('div');
        wrap.id = 'bayeCheatDock';
        var html = '<button class="bd" id="bayeCheatBtn" title="金手指设置（可拖动）">⚙</button><div class="panel">';
        html += '<h4>功能开关</h4>';
        UI_ROWS.forEach(function (r) {
            html += '<div class="row"><div><div class="t">' + r.t + '</div><div class="d">' + r.d + '</div></div>'
                + '<button class="sw' + (flag(r.k) ? ' on' : '') + '" data-k="' + r.k + '"><i></i></button></div>';
        });
        html += '<h4>智慧引擎</h4><div class="fn" id="bayeCheatSm">'
            + smBtn(0, '关闭') + smBtn(1, '标准') + smBtn(2, '强势')
            + '</div><div class="tip" style="text-align:left">当前：<b id="bayeCheatSmNow"></b>。'
            + '开启后每月为<b>每个 AI 势力</b>做一次战略推演（玩家是人类，自己的城自己指挥）：'
            + '<br>· <b>态势评估</b>：每座城算「威胁（相邻敌城可投入战力）÷ 守备（守军×城防）」，<b>都城危险度权重加倍</b> —— 老家不会没人管'
            + '<br>· <b>回防调度</b>：危险城从后方安全城抽将补防；每城至少留 1 人（都城受威胁时留 2 人）'
            + '<br>· <b>智能配兵</b>：按守方战力配够就打、配不够就不打，剩下的留守 —— 不再倾巢而出'
            + '<br>· <b>道路校验</b>：出征单是本脚本自己写进指令队列的（绕过引擎校验），所以出手前会自查'
            + '<b>道路是否相连</b>，非相邻一律不发动；同一座城当月也只安排一次进攻（避免战斗队列里排两场同一目标的仗）'
            + '<br>· <b>多线作战</b>：多座城可分别出击不同目标，不再「一大队沿路平推」'
            + '<br><b>玩家平等</b>：AI 打玩家与打其他 AI 同门槛，没有新手保护；<b>标准</b>=需 35% 战力优势才动手，<b>强势</b>=15%，更频繁开战。'
            + '控制台 <code>bayeCheat.api.strategy()</code> 可查看各势力态势。</div>'
            + '<div class="sublabel">出征频率（二级微调）</div><div class="fn" id="bayeCheatWf">'
            + wfBtn(0, '原版') + wfBtn(1, '较多') + wfBtn(2, '频繁')
            + '</div><div class="tip" style="text-align:left">当前：<b id="bayeCheatWfNow"></b>。决定 AI 每月主动出击的总量与激进程度：原版=保守（约 4 次/月，需 35% 优势）、较多=正常（约 7 次，需 20%）、频繁=活跃（约 10 次，势均力敌也敢打）。<b>智慧引擎关闭时本项不生效</b>（完全原版机制）。</div>'
            + '<h4>铁匠铺（装备强化）</h4>'
            + '<div class="tip" style="text-align:left">游戏内按 <b>H</b> →「铁匠铺」进入：选武将 → 选装备槽 → 确认花钱。<br>'
            + '<b>等级不设上限</b>：+1~+20 每级增量 5.5%→16%，+20 之后进入缓升段（每级仍 +1.2%），<b>永不归零</b>。'
            + '费用 <code>40×稀有度×1.32^(等级+1)</code>（指数增长）→ <b>收益线性、费用指数</b>，高等级自然成为奢侈品。<br>'
            + '按引擎经济（全势力月入 100~300 金）：<b>+10</b> 单次约 900 金（1 年）· <b>+20</b> 约 2200 金（3 年）· <b>+30</b> 约 3700 金（20 年）。<br>'
            + '所以自然形成分层：<b>普遍 +10、精英 +20、极限 +30</b>，不会遍地高强。<br>'
            + '成功率 <code>' + FORGE_RATE.slice(0, 11).join('/') + '/…</code>（+10 约 38%，+20 约 4%），<b>连败 ' + FORGE_PITY_STREAK + ' 次必成</b>；<b>+' + FORGE_SAFE_LV + ' 起失败不掉级</b>。<br>'
            + '<b>AI 势力也会强化</b>（可用开关关闭）：他们用自己的城池收入强化自己的武将（花钱按玩家 34% 计价、成功率低 8 点、最高等级=城池数+6），'
            + '所以玩家 +20 时 AI 也在成长；而 AI 变强会消耗它的经济 → 出征变慢 → 你的压力下降。<br>'
            + '<b>收服带强化武将</b>：强化等级跟着武将走（按「武将_槽位」存储），把别家培养的武将收过来，等级直接继承。<br>'
            + '<b>纯坐骑不可强化</b>（只加移动、不影响伤害），可在上面单独开启。<br>'
            + '<b>纯坐骑不可强化</b>（只加移动、不影响伤害），可在上面单独开启。<br>'
            + '<b>等级不设上限</b>：费用按 1.3 次幂自然涨到「不可能达到」，伤害系数走饱和曲线自动收敛，不会无限膨胀。<br>'
            + '<b>纯坐骑不可强化</b>（只加移动、不影响伤害），可在上面单独开启。<br>'
            + '<b>不改引擎面板</b>：强化等级记在本地表里，装备的武力/智力显示值保持原样；'
            + '强化等级在<b>装备分布、宝物图鉴、角色装备栏（道具壹/贰）</b>三处都能看到。<br>'
            + '同一武将多件装备<b>不叠加</b>（取最高的一件）。</div>'
            + '<h4>资源管理</h4>'
            + '<div class="tip" style="text-align:left">游戏内按 <b>H</b> →「<b>资源管理</b>」：立即加钱、全员加经验（+30 / +100）、'
            + '一键满级、获取全部道具。「获取全部道具」只投放<b>真实存在的道具</b>（按名字过滤掉空槽位），'
            + '一次性给全，不会把存档塞爆。注意引擎金币上限 <b>30000/城</b>，超过会被直接截断。</div>'
            + '<h4>战死调节</h4><div class="fn" id="bayeCheatDr">'
            + drBtn(0, '禁止') + drBtn(1, '原版×1') + drBtn(5, '×5') + drBtn(20, '×20') + drBtn(50, '×50')
            + '</div>'
            + '<div class="tip" style="text-align:left">0 = 禁止武将战死（默认）。调高后月底按倍率抽取败方参战者阵亡（装备掉落战斗城），可游戏内「武将修复」找回 —— 调高立即生效，本月已登记战斗马上结算。<b id="bayeCheatDrNow"></b></div>'
            + '<h4>结算权重（AI 托管战斗）</h4><div class="nums">'
            + num('wGen', '武将素质', 0.1) + num('wArms', '兵力', 0.1)
            + num('wDef', '城防', 0.1) + num('spread', '随机性', 0.1)
            + '</div>'
            + '<div class="tip" style="text-align:left">'
            + '结算公式：双方战力对比 → 胜率 = 1/(1+比值^-随机性)。<br>'
            + '· <b>个体战力</b> = 兵力 × (兵力权重 + 武将素质权重 × 素质系数) × 体力%<br>'
            + '· 素质系数 = (0.8×武力 + 0.3×智力 + 等级)/100 + 装备加成/200，与引擎 CountBaseAttr 同源<br>'
            + '· <b>城防系数</b>(守方) = 1 + 城防权重 × [后备兵/1.5万(≤0.3) + 防灾/500(≤0.2) + 民忠/1000(≤0.1) + 人口/250万(≤0.15)]<br>'
            + '· <b>水域修正</b> = 1 − 水域占比 × (1 − 兵种水性)。水兵100%、弓兵75%、步兵70%、极兵/玄兵60%、骑兵40%。<br>'
            + '　水域占比来自<b>你亲自打过的城</b>（进战斗时自动记录战场河流格比例，北海、吴这类水城会明显抬高）'
            + '，没打过的城按 0 处理；缓存永久保留，控制台 <code>bayeCheat.api.waterCache()</code> 可查看。<br>'
            + '· 粮草差另计 ±15%。原版只比总兵力且 16 位求和会溢出（10.4 万兵溢出成 3.8 万），这就是「一将挡八将」的根源。'
            + '</div>';
        html += '<h4>存档与资源</h4>'
            + '<div class="tip" style="text-align:left">强化等级与阵亡台账<b>自动跟着游戏存档走</b>：'
            + '引擎读/写存档时我们能直接认出是哪个存档文件，存档数据就存在同一标识下，'
            + '三个存档互不干扰，<b>不需要任何手动操作</b>。新开的档在首次保存之前落在<b>临时槽</b>。<br>'
            + '当前游戏存档：<b id="bayeCheatSaveNow">识别中…</b>　数据槽：<b id="bayeCheatSlotNow">?</b></div>'
            + '<div class="fn" id="bayeCheatSlot">'
            + slotBtn('auto', '自动') + slotBtn('tmp', '临时') + slotBtn('1', '槽1') + slotBtn('2', '槽2') + slotBtn('3', '槽3')
            + '<div class="nums" style="margin-top:8px">'
            + num('richAmount', '每次加的钱/粮（立即加钱·立即加粮·每月自动都用它）', 500)
            + '</div>'
            + '<div class="tip" style="text-align:left">资源上限由引擎控制：金币月结被夹在 30000，粮草超过 65536 会绕回 0；开启「解除金币/粮草上限」后，金币可跨月结转累积到 65535，粮草每月补到 65535。</div>';
        html += '<h4>其他</h4><div class="fn">'
            + '<button data-fn="reset">恢复默认设置</button>'
            + '</div><div class="tip">月报 / 势力分布 / 排行 / 图鉴 / 跟踪都在游戏内：按 H（或触屏「帮助」）打开金手指菜单。图标可拖动，点面板外任意处收起。</div>';
        html += '</div>';
        wrap.innerHTML = html;
        document.body.appendChild(wrap);
        restoreDockPos(wrap);
        refreshWfBtns();
        refreshSmBtns();

        /* —— 拖动 + 点击开合：位移超过 5px 算拖动，否则算点击 —— */
        var btn = document.getElementById('bayeCheatBtn');
        if (btn) {
            var drag = null;
            btn.addEventListener('pointerdown', function (e) {
                var r = wrap.getBoundingClientRect();
                drag = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top, moved: false };
                try { btn.setPointerCapture(e.pointerId); } catch (err) { }
                e.preventDefault();
            });
            btn.addEventListener('pointermove', function (e) {
                if (!drag) return;
                var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
                if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
                drag.moved = true;
                var x = Math.max(2, Math.min(window.innerWidth - 36, drag.left + dx));
                var y = Math.max(2, Math.min(window.innerHeight - 36, drag.top + dy));
                wrap.style.left = x + 'px';
                wrap.style.top = y + 'px';
                wrap.style.right = 'auto';
                wrap.style.bottom = 'auto';
            });
            btn.addEventListener('pointerup', function (e) {
                var wasDrag = drag && drag.moved;
                drag = null;
                if (wasDrag) saveDockPos(wrap);
                else {
                    wrap.classList.toggle('on');          /* 没拖动 → 当点击 */
                    if (wrap.classList.contains('on')) placePanel();
                }
            });
        }

        /* —— 点面板外面收起 —— */
        document.addEventListener('pointerdown', function (e) {
            if (!wrap.classList.contains('on')) return;
            if (wrap.contains(e.target)) return;
            wrap.classList.remove('on');
        }, true);

        /* —— 面板内触摸事件不再冒泡到 document（v1.11.1 修复滚动卡顿）：
           引擎在 document 上挂了 touch 处理，滚动设置面板时会被引擎逻辑吃掉，
           表现为滑动好几秒没反应。拦在面板层 + touch-action 交给原生滚动。 —— */
        ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (ev) {
            wrap.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
        });

        /* —— 面板打开时按图标位置决定向上/向下弹，并收进屏幕内 —— */
        function placePanel() {
            var panel = wrap.querySelector('.panel');
            if (!panel) return;
            var r = wrap.getBoundingClientRect();
            var vh = window.innerHeight || screen.height;
            /* 默认右下角图标 → 向上弹；图标拖到上半屏 → 向下弹 */
            panel.classList.toggle('down', r.top <= vh * 0.5);
            panel.style.left = '';
            panel.style.right = '';
            var pr = panel.getBoundingClientRect();
            if (pr.left < 2) { panel.style.left = '0px'; panel.style.right = 'auto'; }   /* 靠左拖过：面板右缘对齐会左溢出 */
            if (pr.right > (window.innerWidth || screen.width) - 2) { panel.style.right = '0px'; panel.style.left = 'auto'; }
        }

        each(wrap.querySelectorAll('.sw'), function (b) {
            b.onclick = function () {
                var k = this.getAttribute('data-k');
                cfg[k] = flag(k) ? 0 : 1;
                this.classList.toggle('on', flag(k));
                saveCfg();
                if (k === 'noDeathRescue') rescueLostGenerals(false);
                log(k + ' = ' + cfg[k]);
            };
        });
        each(wrap.querySelectorAll('.nums input'), function (inp) {
            inp.onchange = function () {
                var k = inp.getAttribute('data-n');
                var v = numValid(k, inp.value);
                if (v === null) {                       /* 非法输入：丢弃并回填当前值 */
                    var cur = Number(cfg[k]);
                    log('忽略非法输入 ' + k + '=' + inp.value);
                    try { inp.value = isFinite(cur) ? cur : 0; } catch (e) { }
                    return;
                }
                cfg[k] = v;
                saveCfg();
                if (k === 'deathRate') applyEngineSwitches();
                if (k === 'richAmount') { try { doRich(true); } catch (e) { } }
            };
        });
        syncNumInputs();
        refreshSlotBtns();
        each(wrap.querySelectorAll('#bayeCheatSm .sm'), function (b) {
            b.onclick = function () {
                var v = Number(this.getAttribute('data-sm'));
                if (isNaN(v)) v = 0;
                cfg.smartAI = v;
                saveCfg();
                refreshSmBtns();
                log('智慧引擎 = ' + (v === 0 ? '关闭' : v === 1 ? '标准' : '强势'));
            };
        });
        each(wrap.querySelectorAll('#bayeCheatWf .wf'), function (b) {
            b.onclick = function () {
                var v = Number(this.getAttribute('data-wf'));
                if (isNaN(v)) v = 0;
                cfg.warFreq = v;
                saveCfg();
                refreshWfBtns();
                log('出征频率 = ' + v + '（' + (v === 0 ? '保守' : v === 1 ? '正常' : '活跃') + '，随智慧引擎生效）');
            };
        });
        each(wrap.querySelectorAll('#bayeCheatDr .dr'), function (b) {
            b.onclick = function () {
                var dv = Number(this.getAttribute('data-dr'));
                if (isNaN(dv)) dv = 0;
                cfg.deathRate = dv;
                saveCfg();
                applyEngineSwitches();
                refreshDrBtns();
                /* 立即结算本月已登记的战斗，所见即所得 */
                try { applyDeathRate(); } catch (e) { }
                refreshDrBtns();
                log('战死概率 = ' + cfg.deathRate + '%');
            };
        });
        each(wrap.querySelectorAll('.fn button[data-fn]'), function (b) {
            b.onclick = function () {
                var f = b.getAttribute('data-fn');
                if (f === 'reset') {
                    cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
                    saveCfg();
                    log('已恢复默认设置');
                    location.reload();
                }
            };
        });
        /* 存档槽位切换：切完立刻重载该槽的强化/台账 */
        each(wrap.querySelectorAll('#bayeCheatSlot .slot'), function (b) {
            b.onclick = function () {
                var v = b.getAttribute('data-slot');
                var real = setSlot(v);
                log('存档槽位 → ' + real);
                alert2('已切换到存档槽位：' + real
                    + '\n（强化等级与阵亡台账已按该槽位重新载入）');
                refreshSlotBtns();
            };
        });
        /* 一次性把当前读入的存档标记为某个槽位（三个档各点一次即可长期自动） */
        each(wrap.querySelectorAll('#bayeCheatBind .bind'), function (b) {
            b.onclick = function () {
                var n = b.getAttribute('data-bind');
                if (bindCurrentSlot(n)) { loadSlotData(false); refreshSlotBtns(); }
            };
        });
        refreshSlotBtns();
    }

    function saveDockPos(wrap) {
        try {
            localStorage.setItem(DOCK_POS_KEY, JSON.stringify({
                left: wrap.style.left, top: wrap.style.top,
                right: wrap.style.right, bottom: wrap.style.bottom
            }));
        } catch (e) { }
    }

    function restoreDockPos(wrap) {
        try {
            var raw = localStorage.getItem(DOCK_POS_KEY);
            if (!raw) return;
            var p = JSON.parse(raw);
            if (p.left || p.top) {
                wrap.style.left = p.left || '8px';
                wrap.style.top = p.top || '8px';
                wrap.style.right = 'auto';
                wrap.style.bottom = 'auto';
            }
        } catch (e) { }
    }

    function each(list, fn) {
        if (!list) return;
        if (list.forEach) { list.forEach(fn); return; }
        for (var i = 0; i < list.length; i++) fn(list[i], i);
    }

    function wfBtn(v, label) {
        return '<button class="wf' + (Number(cfg.warFreq) === v ? ' on' : '') + '" data-wf="' + v + '">' + label + '</button>';
    }
    function slotBtn(v, label) {
        var cur = 'auto';
        try { cur = localStorage.getItem(SLOT_KEY) || 'auto'; } catch (e) { }
        return '<button class="slot' + (cur === v ? ' on' : '') + '" data-slot="' + v + '">' + label + '</button>';
    }
    function bindBtn(n) {
        return '<button class="bind" data-bind="' + n + '">当前档→槽' + n + '</button>';
    }
    function refreshSlotBtns() {
        each(document.querySelectorAll('#bayeCheatSlot .slot'), function (b) {
            b.classList.toggle('on', b.getAttribute('data-slot') === slotSelection());
            /* 实际在用的槽位也点亮：自动模式下 save_sangoN → 折算成第几个档（0/2/4→1/2/3） */
            var live = liveSlotTag();
            b.classList.toggle('live', live !== '' && b.getAttribute('data-slot') === live);
        });
        var el = document.getElementById('bayeCheatSlotNow');
        if (el) el.textContent = currentSlot() + '（选择：' + slotSelection() + '）';
        var sv = document.getElementById('bayeCheatSaveNow');
        if (sv) {
            var list = engineSaveList(), uniq = [], i;
            for (i = 0; i < list.length; i++) if (uniq.indexOf(list[i].name) < 0) uniq.push(list[i].name);
            sv.textContent = (currentSaveId() ? currentSaveId() + '.sav' : '未识别（tmp 临时槽）')
                + '　（存档 ' + uniq.length + ' 个：' + uniq.join('/') + '）';
        }
    }
    /* 当前数据槽对应的按钮标签（自动模式下把 save_sangoN 映射成槽1/2/3） */
    function liveSlotTag() {
        var sl = currentSlot();
        if (sl.indexOf('save_sango') === 0) {
            var n = parseInt(sl.replace('save_sango', ''), 10);
            if (isFinite(n)) return String(n / 2 + 1);      /* sango0→槽1、sango2→槽2、sango4→槽3 */
        }
        if (sl === 'tmp') return 'tmp';
        if (sl.indexOf('slot') === 0) return sl.replace('slot', '');
        return '';
    }
    /* 面板是注入时一次性渲染的，存档切换发生在之后 → 必须持续同步，
       否则面板会一直停在「识别中…」。这里每秒只比对两个字符串，代价可忽略。 */
    var SAVE_UI_TICK = null;
    function startSaveUiWatch() {
        if (SAVE_UI_TICK) return;
        var lastSeen = '', lastSlot = '';
        SAVE_UI_TICK = setInterval(function () {
            try {
                var s = currentSaveId(), sl = currentSlot();
                if (s !== lastSeen || sl !== lastSlot) {
                    lastSeen = s; lastSlot = sl;
                    refreshSlotBtns();
                }
            } catch (e) { }
        }, 1000);
    }
    function slotSelection() {
        try { return localStorage.getItem(SLOT_KEY) || 'auto'; } catch (e) { return 'auto'; }
    }

    function refreshWfBtns() {
        each(document.querySelectorAll('#bayeCheatWf .wf'), function (b) {
            b.classList.toggle('on', Number(b.getAttribute('data-wf')) === Number(cfg.warFreq));
        });
        var now = document.getElementById('bayeCheatWfNow');
        if (now) now.textContent = Number(cfg.warFreq) === 0 ? '保守（全局约 4 次/月）'
            : (Number(cfg.warFreq) === 1 ? '正常（全局约 7 次/月）' : '活跃（全局约 10 次/月）');
    }

    function smBtn(v, label) {
        return '<button class="sm' + (Number(cfg.smartAI) === v ? ' on' : '') + '" data-sm="' + v + '">' + label + '</button>';
    }

    function refreshSmBtns() {
        each(document.querySelectorAll('#bayeCheatSm .sm'), function (b) {
            b.classList.toggle('on', Number(b.getAttribute('data-sm')) === Number(cfg.smartAI));
        });
        var now = document.getElementById('bayeCheatSmNow');
        if (now) now.textContent = Number(cfg.smartAI) === 0 ? '关闭（AI 用原版机制）'
            : (Number(cfg.smartAI) === 1 ? '标准（会守家/回防/挑软柿子/多线出击）' : '强势（更激进，也会趁虚打玩家）');
    }

    function drBtn(v, label) {
        return '<button class="dr' + (Number(cfg.deathRate) === v ? ' on' : '') + '" data-dr="' + v + '">' + label + '</button>';
    }

    function refreshDrBtns() {
        each(document.querySelectorAll('#bayeCheatDr .dr'), function (b) {
            b.classList.toggle('on', Number(b.getAttribute('data-dr')) === Number(cfg.deathRate));
        });
        var now = document.getElementById('bayeCheatDrNow');
        var extra = '';
        if (Number(cfg.deathRate) > 0 && !flag('autoBalance')) extra = ' · 自动结算已强制开启';
        if (now) now.textContent = '当前：' + (Number(cfg.deathRate) === 0 ? '禁止战死' : '战死概率 ' + cfg.deathRate + '%')
            + '（本月已登记战斗 ' + battleRosters.length + ' 场 · 累计阵亡 ' + deaths.length + ' 人）' + extra;
    }

    function num(k, label, step) {
        var v = cfg[k];
        if (typeof v !== 'number' || !isFinite(v)) v = 0;
        return '<label>' + label + '<input type="number" inputmode="numeric" autocomplete="off" autocorrect="off"'
            + ' spellcheck="false" min="0" step="' + step + '" data-n="' + k + '" value="' + v + '"></label>';
    }
    /* 数字输入兜底（iOS Safari 实测踩过的坑）：
       手机上「暴富金额」会莫名变成 1，导致加钱只 +1。
       三个防护：① 面板打开时用 cfg 回填输入框（压掉 Safari 的表单值恢复）；
       ② onchange 校验，非法/过小值直接丢弃并回填；
       ③ safeWeight 对关键金额项做下限保护。 */
    function numValid(k, raw) {
        var v = Number(raw);
        if (!isFinite(v) || v < 0) return null;
        if (k === 'richAmount' && v > 0 && v < 100) return null;      /* 金额小于 100 视为误输入 */
        if (k === 'wGen' || k === 'wArms' || k === 'wDef' || k === 'spread' || k === 'moneyCap') {
            if (v > 0 && v < 0.001) return null;
        }
        return v;
    }
    function syncNumInputs() {
        each(document.querySelectorAll('#bayeCheatDock .nums input'), function (inp) {
            var k = inp.getAttribute('data-n');
            var v = Number(cfg[k]);
            if (isFinite(v)) { try { inp.value = v; } catch (e) { } }
        });
    }

    /* ======================== 9. 启动 ======================== */
    bootstrap();

})();
