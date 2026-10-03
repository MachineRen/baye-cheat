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

    var CHEAT_VERSION = '1.11.8';

    function ready() {
        return window.baye && window.baye.hooks && window.baye.data;
    }

    /* 启动逻辑放在 IIFE 末尾（见文件最后的 bootstrap），
       因为 install() 依赖本文件后半部分定义的状态与函数。 */
    var TIMER = null;

    function bootstrap() {
        /* 尽早挂上存档文件监听：读档发生在玩家点「读档」时，
           必须在 install 之前就位，否则抓不到当前载入的是哪个 .sav。 */
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
                saveKeys: storageSaveKeys,
                moneyCap: function () { return MONEY_SOFT_CAP; },
                probeMoneyCap: probeMoneyCap,
                /* 换月/读档时清空「本月已打过」账本；控制台与测试也用它复位 */
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
            var sf = slotFromSaveFile();
            if (sf) return 'slot' + sf;
        } catch (e) { }
        return '';
    }
    function currentSlot() {
        var sel = 'auto';
        try { sel = localStorage.getItem(SLOT_KEY) || 'auto'; } catch (e) { }
        if (sel === 'tmp') return 'tmp';
        if (sel === '1' || sel === '2' || sel === '3') return 'slot' + sel;
        return autoSlotId() || 'tmp';
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
    /* 存档键候选（诊断用）：localStorage 扫描 + 实际读过的 .sav 文件 */
    function storageSaveKeys() {
        var out = [], i, k, v;
        try {
            for (i = 0; i < localStorage.length; i++) {
                k = localStorage.key(i);
                if (!k || k.indexOf('baye_cheat_') === 0) continue;
                v = localStorage.getItem(k) || '';
                if (/save|slot|存档|进度/i.test(k) || (v.length > 2000 && /^\s*[{[]/.test(v))) {
                    out.push('LS ' + k + '(' + Math.round(v.length / 1024) + 'KB)');
                }
            }
        } catch (e) { }
        for (i = 0; i < SAVE_FILES.length; i++) out.push('SAV ' + SAVE_FILES[i] + ' → 槽' + (i + 1));
        if (!out.length) out.push('（没抓到存档键：引擎用的是 baye/data/*.sav 文件，不走 localStorage）');
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
        forgeMount: 0,       // 允许强化纯坐骑：默认关（纯坐骑只加移动、不加伤害，强化收益为0）
        richMode: 0,          // 一夜暴富：每月给君主所在城塞一笔钱（配合引擎经济，量级见 richAmount）
        richAmount: 3000,     // 一夜暴富每月注入的钱（单城上限由引擎决定，可用 moneyCap 覆盖）
        moneyCap: 0,          // 0 = 自动（写后回读校准 / 面板探测）；>0 = 手动指定单城金币上限
        allTools: 0,          // 获取全部道具：每月把全道具表塞进君主所在城
        levelBoost: 0,        // 武将等级提升：每月给己方武将加经验（全员涨级）
        levelBoostAll: 0,     // 全员满级：开局/读档时把己方武将直接拉到等级上限

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
            notes.push(d.name + ' 归位 ' + cityName(city));
            delete PENDING_PLACE[k];
        }
        if (notes.length) {
            pushReport('【退兵】' + notes.join('、'));
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
            if (b !== WILD && b !== CAPTIVE && b !== undefined && b > 0) {
                for (k = 0; k < list.length; k++) {
                    if (cities[list[k]] && cities[list[k]].Belong === b) { keeper = list[k]; break; }
                }
            } else if (list.length) {
                keeper = list[0];                        /* 在野/俘虏：保留首个 */
            }
            if (keeper < 0) keeper = list[0];
            /* 重复在册：只留 keeper */
            for (k = 0; k < list.length; k++) {
                if (list[k] === keeper) continue;
                try { baye.deletePersonInCity(list[k], pid); } catch (e2) { }
                fixed.push(nameOf(pid) + ' 重复在册（' + cityName(keeper) + '/' + cityName(list[k]) + '）');
            }
            if (list.length > 1) continue;
            /* 单一在册：检查归属是否与城池一致 */
            if (b === WILD || b === CAPTIVE || b === undefined || b <= 0) continue;
            if (cities[keeper] && cities[keeper].Belong === b) continue;
            if (pid + 1 === b) {
                var oc = ownCities(b);
                if (oc.length) {
                    try { baye.deletePersonInCity(keeper, pid); } catch (e3) { }
                    placePerson(oc[0], pid);
                    fixed.push(nameOf(pid) + ' 君主归位（' + cityName(keeper) + '→' + cityName(oc[0]) + '）');
                } else {
                    try { baye.deletePersonInCity(keeper, pid); } catch (e4) { }
                    fixed.push(nameOf(pid) + ' 君主无城可归，已移出 ' + cityName(keeper));
                }
                continue;
            }
            /* 普通武将错列：引擎若在别处也登记了他，以那边为准；否则视为中间态，不动 */
            var home = -1, c2;
            for (c2 = 0; c2 < cities.length; c2++) {
                if (c2 === keeper || !cities[c2] || cities[c2].Belong !== b) continue;
                if (personsOfCity(c2).indexOf(pid) >= 0) { home = c2; break; }
            }
            if (home >= 0) {
                try { baye.deletePersonInCity(keeper, pid); } catch (e5) { }
                fixed.push(nameOf(pid) + ' 错列于' + cityName(keeper) + '，已移出该城名册');
            } else {
                fixed.push(nameOf(pid) + ' 暂留' + cityName(keeper) + '（归属' + safeName(b) + '，等引擎结算）');
            }
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
                pushReport('【战】' + atkKing0 + '军 ' + attackSrcTag(fp) + '进攻 ' + cityName(fp.CityIndex)
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
                pushReport('【战】' + atkKing + '军 ' + attackSrcTag(fp, atkPid) + '进攻 ' + cityName(fp.CityIndex)
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
        if (to < 0) return '该武将所属势力已无城池，无处可回';
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
        return '已把 ' + nameOf(idx) + ' 重伤送回 ' + cityName(to);
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
         · searchTool 开 → 每次搜寻当场发现城里隐藏的道具（引擎原生机制，绝不复制他人道具）；
         · searchGen 开 → 当场招到城内在野武将；
         · 都没有产出 → 搜得银两/粮草保底（按执行者智力，同引擎公式）。
       执行者完成后回城（与引擎 SearchDrv 末尾 AddPerson 一致）。 */
    function doSearchNow(ctx) {
        var person = ctx.Person, city = ctx.City;
        var P = personAt(person);
        if (!P) return -1;
        var king = P.Belong;
        var got = false;

        /* ① 道具必成：当场发现城里隐藏的道具 */
        if (flag('searchTool')) {
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
                pushReport('【搜】发现 ' + gbkSafe(baye.getToolName(tid)) + '（' + cityName(city) + '）');
                got = true;
            }
        }
        /* ② 武将必成：当场招到城内在野 */
        if (!got && flag('searchGen')) {
            var w = wildsOfCity(city);
            if (w.length) {
                var t = w[rand(w.length)];
                var tp = personAt(t);
                tp.Belong = king;
                tp.Devotion = 70 + rand(30);
                say2(t, '得遇明主，愿效犬马之劳！');
                pushReport('【搜】' + nameOf(t) + ' 在' + cityName(city) + '出仕');
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
        pushReport('【降】' + nameOf(ob) + ' 归顺 ' + safeName(P.Belong));
        return 0;
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
        pushReport('【揽】' + nameOf(ob) + ' 转投 ' + safeName(P.Belong) + '（' + cityName(city) + '）');
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
    function noteAttackSrc(target, srcCity) {
        ATTACK_SRC[target] = { city: srcCity, month: monthKey() };
    }
    /* 战报里的「自 X 进攻」：优先用我们写单时记下的出发城，
       引擎自己发起的进攻则退而用攻方主帅当前所在城。 */
    function attackSrcTag(fp, atkPid) {
        try {
            if (!fp) return '';
            var rec = ATTACK_SRC[fp.CityIndex];
            if (rec && rec.month === monthKey()) return '自 ' + cityName(rec.city) + ' ';
            var pid = (atkPid !== undefined && atkPid >= 0) ? atkPid : (fp.GenArray[0] ? fp.GenArray[0] - 1 : -1);
            if (pid < 0) return '';
            var from = cityOfPerson(pid);
            if (from === 0xff) return '';
            return '自 ' + cityName(from) + ' ';
        } catch (e) { return ''; }
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
                pushReport('【占】' + safeName(srcKing) + '军 ' + nameOf(best)
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
            out.push('【回防】' + safeName(king) + '军 ' + moved.slice(0, 4).join('、')
                + (moved.length > 4 ? ' 等 ' + moved.length + ' 人' : ''));
        }
        refresh();                                          /* 调兵后重新评估 */

        /* ③ 出击：自身安全 + 有富余 的城，挑最划算的目标 */
        var sortie = 0;
        var cands = mine.slice().sort(function (a, b) { return danger[a] - danger[b]; });
        for (i = 0; i < cands.length && sortie < maxSortie && sortie < budget; i++) {
            c = cands[i];
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
                var gate = Math.max(0.95, (level === 2 ? 1.15 : 1.35) - (Number(cfg.warFreq) || 0) * 0.15);
                var availP = 0, g2;
                for (g2 = 0; g2 < gl.length - keepC; g2++) availP += personPower(gl[g2]);
                if (availP < defP * gate) continue;         /* 打不动，跳过 */
                var score = cityValue(tc) / Math.max(1, defP);
                if (score > bestScore) { bestScore = score; bestT = tc; }
            }
            if (bestT < 0) continue;
            /* 配兵：从强到弱累加到够用为止，剩下的留守（不再倾巢而出） */
            var defP2 = cityGuardPower(bestT, cities[bestT].Belong);
            var gate2 = Math.max(0.95, (level === 2 ? 1.15 : 1.35) - (Number(cfg.warFreq) || 0) * 0.15);
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
                out.push('【征】' + safeName(king) + '军 自 ' + cityName(c)
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
            var FREQ = [{ per: 1, glob: 4 }, { per: 2, glob: 7 }, { per: 3, glob: 10 }];
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
        PENDING_PLACE = {};            /* 待归位君主 */
        ATTACKED.month = ''; ATTACKED.targets = {};
        ATTACK_SRC = {};                /* 进攻出发城台账 */
        log('已重置本局运行数据（月报/台账/跟踪基线' + (isNewGame ? '，强化记录已清空' : '') + '）');
    }

    function onDidOpenNewGame() {
        resetRunState(true);
        return undefined;
    }

    function onDidLoadGame() {
        /* 读档：切到该存档位的数据（新档期落在 tmp 的强化/台账会并到真实档位） */
        try { loadSlotData(true); } catch (e) { }
        /* 「全员满级」是读档即生效的（不是每月累积），所以放在这里 */
        try { if (flag('levelBoostAll')) levelUpAll(false, true); } catch (e) { }
        resetRunState(false);
        return undefined;
    }

    function onTacticStage5() {
        var notes = [];
        /* 君主归位（v1.11.4）：战斗期间只从战败城摘人、投进自己城池的动作统一挪到月末。
           同样卡在 lib 的 tacticStage5 之前执行（wrapHook 先跑本函数再跑原钩子）。 */
        try { notes = notes.concat(flushPendingPlace(false) || []); } catch (e) { log('君主归位异常', e); }
        /* 必须在 lib 的 tacticStage5「敌方俘虏入城」之前把君主放回去 ——
           wrapHook 先跑本函数再跑原钩子，正好卡在这个位置。 */
        try { notes = notes.concat(rollbackCapturedKings(false) || []); } catch (e) { log('君主回滚异常', e); }
        /* 战死概率抽取（倍率>0 时）+ 阵亡检测 */
        try {
            var dead = applyDeathRate();
            dead = dead.concat(detectDeaths());
            if (dead.length) notes.push('【阵亡】' + dead.join('、'));
        } catch (e) { log('阵亡检测异常', e); }
        /* 资源包：一夜暴富 / 道具全收 / 经验注入（月结时统一执行并记月报） */
        try { notes = notes.concat(monthlyBoon() || []); } catch (e2) { log('资源包异常', e2); }
        if (notes.length) pushReport(notes);
        return undefined;
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
            '宝物图鉴', '武将跟踪', '武将修复', '铁匠铺', '资源管理', '显示版本'];
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
                else if (ind === 9) showResourceMenu();
                else if (ind === 10) showVersion();
                else if (ind === 11 && hasOrigin) wrappedHooks.showMainHelp.apply(baye.hooks, [undefined]);
            } catch (e) {
                log('菜单项异常', e);
                alert2('执行出错：' + e.message);
            }
        });
        return 0;         /* 0 = 已处理；原版帮助通过最后一项进入 */
    }

    function showMonthReport() {
        menu(info.monthReport.length ? info.monthReport : ['（暂无记录，每月月初与月末会自动记录）']);
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
            groups[typeOf(t2)].push({
                n: label, at: t2.at || 0, iq: t2.iq || 0, mv: t2.move || 0,
                txt: label + (bestLv > 0 ? ' +' + bestLv : '') + ':' + parts.join('')
                    + (bestLv > 0 ? '　伤害+' + Math.round((forgeDmgMul(bestLv) - 1) * 100) + '%' : '')
            });
        }
        var titles = ['【兵器】（按武力）', '【兵书】（按智力）', '【坐骑】（按移动）'];
        var out2 = [];
        for (var g = 0; g < 3; g++) {
            if (!groups[g].length) continue;
            groups[g].sort(function (a, b2) {
                return (b2.at - a.at) || (b2.iq - a.iq) || (b2.mv - a.mv) || (a.n < b2.n ? -1 : 1);
            });
            out2.push(titles[g] + ' ' + groups[g].length + ' 件');
            for (var q = 0; q < groups[g].length; q++) out2.push(' ' + groups[g][q].txt);
        }
        return out2.length ? out2 : ['（当前地图上没有道具）'];
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
            if (gone.length) out.push('【本月消失】' + briefList(gone, 10));
            if (add.length) out.push('【新增】' + briefList(add, 10));
            if (openCity.length) out.push('【离开】' + briefList(openCity, 6));
            if (moveCity.length) out.push('【迁入】' + briefList(moveCity, 6));
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
              mul(L) = 1 + FORGE_DMG_CAP * (L / (L + FORGE_DMG_K)) / FORGE_DMG_K1
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
    /* 强化不设上限（用户需求）。这里只是「读档容错」用的软顶 —— 正常永远不会碰到，
       因为费用按1.3 次幂增长，到 +100 已经是天文数字，曲线本身就把等级锁死在 +15~20 区间。
       伤害系数走饱和曲线（见 forgeDmgMul），高等级自动收敛到上限，不会无限膨胀。 */
    var FORGE_MAX = 999;
    /* 费用基准：对齐引擎真实经济 —— 城市金币上限 30000（Money>30000 截断），
       月自动收入 = Commerce×0.05（单城约 10 金，全势力 100~300 金）。
       基准 30 + 1.3 次幂（稀有度 2 的普通兵器）：
         单次 60 → 1684 金，单次始终在单城上限内；
         满级期望总花费约 2.8 万金 ≈ 184 个月（15 年游戏内时间），
         +3 只要 3 个月、+7 约 32 个月，阶梯清晰、不会一步登天。 */
    var FORGE_BASE_COST = 30;
    var FORGE_COST_POW = 1.3;
    /* 高阶保护：达到此等级后失败不再掉级（DNF「强化保护券」的简化版）。
       没有它的话，「低成功率 + 失败掉一级」会变成随机游走 ——
       蒙特卡洛实测期望花费高达 597 万金（2.7 万个月），等于永远打不到 +13。 */
    var FORGE_SAFE_LV = 8;
    /* 伤害曲线的收敛点：+30 之后 mul 已经无限逼近 FORGE_DMG_CAP，
       所以再往上强化对伤害毫无收益（纯粹烧钱），这也顺手防了数值溢出。 */
    var FORGE_SOFT_CAP = 30;
    var FORGE_DMG_CAP = 0.55;      /* 伤害加成上限（+13 约 +55%） */
    var FORGE_DMG_K = 6.5;
    var FORGE_DMG_K1 = 1.0;

    /* 等级 → 升到下一级的成功率（%）。0~4 保底易得，5~9 明显变难，10+ 噩梦区。
       超出数组长度时沿用最后一项（9%）—— 等级不设上限，所以这里必须有兜底。 */
    var FORGE_RATE = [100, 100, 95, 90, 82, 70, 60, 50, 40, 32, 24, 18, 13, 9];
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

    /* 槽位键：同一件装备只跟随武将的某个槽位。
       用「武将下标_槽位」而不是道具名 —— 同名装备可以并存，各强化各的，
       也避免换装后强化等级串到别人身上。 */
    function forgeKey(pid, slot) { return pid + '_' + slot; }

    function forgeLv(pid, slot) {
        var r = FORGE[forgeKey(pid, slot)];
        return r ? r.lv : 0;
    }

    /* 伤害系数：饱和曲线，见文件头「设计要点 2」 */
    function forgeDmgMul(lv) {
        if (!lv || lv <= 0) return 1;
        if (lv > FORGE_SOFT_CAP) lv = FORGE_SOFT_CAP;   /* 曲线收敛用，与等级上限无关 */
        var x = lv / (lv + FORGE_DMG_K);
        return 1 + FORGE_DMG_CAP * x / FORGE_DMG_K1;
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
    function toolForgeable(tid0) {
        var t = baye.data.g_Tools[tid0];
        if (!t) return false;
        if (t.useflag) return false;                    /* 消耗品 */
        var sum = (t.at || 0) + (t.iq || 0) + (t.move || 0);
        if (sum <= 0) return false;                     /* 无属性 */
        if (toolTypeName(tid0) === '纯坐骑' && !flag('forgeMount')) return false;
        return true;
    }

    /* 道具稀有度系数：有属性才值钱，纯道具（at/iq/move 全 0）不给强化 */
    function forgeRarity(tid0) {
        if (!toolForgeable(tid0)) return 0;
        var t = baye.data.g_Tools[tid0];
        var sum = (t.at || 0) + (t.iq || 0) + (t.move || 0);
        /* 名品（属性和 ≥ 20）更贵，比例控制在 1.0 ~ 2.2 */
        return 1 + Math.min(1.2, sum / 20);
    }

    /* 升到 lv+1 的费用 */
    function forgeCost(lv, rarity) {
        if (rarity <= 0) return 0;
        /* 等级不设上限，费用按 1.3次幂自然涨到「不可能达到」，
           曲线本身就取代了硬上限的作用。Math.pow 溢出时兜底成 Infinity。 */
        var v = FORGE_BASE_COST * rarity * Math.pow(lv + 1, FORGE_COST_POW);
        if (!isFinite(v)) return 1e12;
        return Math.round(v > 1e12 ? 1e12 : v);
    }

    /* 升到 lv+1 的成功率（含保底） */
    function forgeRate(lv, failStreak) {
        if (flag('forgeGuarantee')) return 100;      /* 必定成功开关 */
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
        if (lv >= FORGE_MAX) return { ok: false, msg: '已达读档容错上限' };
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
    function forgeDialog() {
        var myKing = (baye.data.g_PlayerKing || 0) + 1;
        var items = [], pids = [];
        var persons = baye.data.g_Persons;
        for (var i = 0; i < persons.length; i++) {
            var p = persons[i];
            if (!p || !p.Level || p.Level <= 0 || p.Belong !== myKing) continue;
            var line = [], any = false;
            for (var s = 0; s < 2; s++) {
                if (!p.Equip[s]) { line.push('-'); continue; }
                var tid0 = p.Equip[s] - 1, t = baye.data.g_Tools[tid0];
                if (!t) { line.push('?'); continue; }
                any = true;
                var nm = '';
                try { nm = gbkSafe(baye.getToolName(tid0)) || ('#' + tid0); } catch (e2) { nm = '#' + tid0; }
                var lv = forgeLv(i, s);
                line.push(nm + (lv > 0 ? ' +' + lv : ''));
            }
            if (!any) continue;
            items.push(pad(nameOf(i), 6) + line.join(' / '));
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
                slots.push(nm + ' +' + lv2 + '（槽' + (s2 + 1) + '）');
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
                + (full ? '，其中 ' + full + ' 座已满' : '') + '，单城上限 ' + MONEY_SOFT_CAP + '）',
            '己方武将 ' + ids.length + ' 名　等级上限 ' + MAX,
            ''
        ];
        /* 动作按真实行号登记：菜单前有 5 行表头，若硬编码 1~5 会全部错位失效（v1.11.1 修复） */
        var acts = {};
        function addAct(label, fn) { acts[lines.length] = fn; lines.push(label); }
        addAct('【1】立即加钱（君主所在城）', function () { doRich(false, true); });
        addAct('【2】全员加经验 +30', function () { boostExperience(30, false, false); });
        addAct('【3】全员加经验 +100', function () { boostExperience(100, false, false); });
        addAct('【4】一键满级（全员 ' + MAX + ' 级）', function () { levelUpAll(false, false); });
        addAct('【5】获取全部道具（一次性）', function () { giveAllTools(false); });
        lines.push('');
        lines.push('每月自动：' + (flag('richMode') ? '加钱 ' : '关')
            + ' / ' + (flag('allTools') ? '道具' : '关')
            + ' / ' + (flag('levelBoost') ? '经验' : '关'));
        lines.push('长期开关：' + (flag('levelBoostAll') ? '读档即满级' : '关'));
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

    function effMoneyCap() {
        var manual = Number(cfg.moneyCap) || 0;
        if (manual > 0) return manual;
        if (MONEY_CAP_PROBED > 0) return MONEY_CAP_PROBED;
        return MONEY_SOFT_CAP;
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
                + (notes.length ? notes.join('\n') : '（没有可加的城）')
                + '\n单城上限 ' + capNow + (MONEY_CAP_PROBED ? '（实测值）' : '（默认，可探测）');
            if (total === 0 && want > 0) {
                msg += '\n⚠ 一分钱都没加上：己方城池金币都已到引擎硬上限 —— 这是引擎的上限，'
                    + '加多少都会被截断。可行办法：① 用「获取全部道具」换战力；② 提升商贸等内政让月入更���；'
                    + '③ 若你确信上限不该这么低，点下面「重新探测上限」按钮';
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
        try {
            var got = doRich(true);
            if (got > 0) notes.push('【富】' + cityName(capitalCity()) + ' 金币 +' + got);
        } catch (e) { }
        try {
            if (flag('allTools')) {
                var n = giveAllTools(true);
                if (n > 0) notes.push('【道具】' + cityName(capitalCity()) + ' 投放 ' + n + ' 种');
            }
        } catch (e2) { }
        try {
            if (flag('levelBoost')) {
                var k = boostExperience(30, false, true);
                if (k > 0) notes.push('【等级】' + k + ' 名武将各 +30 经验');
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
        '#bayeCheatDock .nums{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 0}',
        '#bayeCheatDock .nums label{font-size:11.5px;color:#666;display:flex;align-items:center;gap:4px}',
        '#bayeCheatDock .nums input{width:54px;padding:3px 5px;border:1px solid #dcdcdc;border-radius:6px;font-size:12px}',
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
        { k: 'forge', t: '铁匠铺（装备强化）', d: 'DNF 式强化：花钱提升装备等级（等级不设上限），等级越高越贵、成功率越低、失败掉 1 级。强化只加伤害系数，不改引擎的武力/智力面板数值，列表里以「+N」标注' },
        { k: 'forgePity', t: '强化保底', d: '默认开启。连续失败 5 次后下一次必定成功，避免高等级陷入无限掉级（+11 以上成功率仅 18%~9%）' },
        { k: 'richMode', t: '一夜暴富', d: '每月给君主所在城加钱，都城满了会自动接着给其他己方城池。引擎金币上限会自动按实际写入值校准（默认 30000/城）' },
        { k: 'richAmount', t: '暴富金额', d: '一夜暴富每月注入的钱数。发放时会逐城列出实际到账金额；若所有己方城池都到上限，剩余部分不会发放并会提示' },
        { k: 'allTools', t: '获取全部道具', d: '每月把道具表里所有「真实存在的道具」（已按名字过滤空槽位）投放到君主所在城。想一次性给全请用游戏内「资源管理」' },
        { k: 'levelBoost', t: '武将等级提升', d: '每月给全部己方武将 +30 经验（引擎经验条满 100 即升 1 级，等级上限由引擎 maxLevel 决定，默认 30）' },
        { k: 'levelBoostAll', t: '全员满级（读档即生效）', d: '默认关。开启后每次读档 / 新开局，自动把全部己方武将直接拉到等级上限。也可在游戏内「资源管理」手动一键满级' },
        { k: 'forgeGuarantee', t: '强化必定成功', d: '默认关。开启后强化成功率强制 100%（费用照收），配合铁匠铺快速刷高等级用' },
        { k: 'forgeMount', t: '允许强化纯坐骑', d: '默认关。纯坐骑只加移动、不影响伤害，强化它没有收益；开启后可当移动加成养着玩' },
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
            + '<div class="tip" style="text-align:left">游戏内按 <b>H</b> →「铁匠铺」进入：选武将 → 选装备槽 → 确认花钱。'
            + '等级<b>不设上限</b>，费用 <code>30×稀有度×(等级+1)^1.3</code>（指数上涨），成功率 '
            + '<code>100/100/95/90/82/70/60/50/40/32/24/18/13/9</code>。<br>'
            + '<b>失败 -1 级</b>；但 <b>+' + FORGE_SAFE_LV + ' 起进入高阶保护</b>（失败只损钱不降级，DNF 强化保护券的简化版）——'
            + '否则低成功率叠掉落级会变成随机游走，实测期望花费高达 597 万金，等于永远打不到 +13。<br>'
            + '伤害加成走<b>饱和曲线</b>：<code>×(1 + 0.55×L/(L+6.5))</code> —— +1 就有感、越高越递减，'
            + '+13 约 <b>+42%</b>，不会盖过武将本身的武力/智力差异。<br>'
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
            + num('richAmount', '暴富金额', 500) + num('wGen', '武将素质', 0.1) + num('wArms', '兵力', 0.1)
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
            + '<div class="tip" style="text-align:left">强化等级与阵亡台账按<b>存档位</b>分开保存（三个档位互不干扰）；'
            + '新开的档在保存之前先落在<b>临时槽</b>，之后读档会自动并到对应档位。当前生效槽位：<b id="bayeCheatSlotNow">?</b>（识别不准时可手动指定）。</div>'
            + '<div class="fn" id="bayeCheatSlot">'
            + slotBtn('auto', '自动') + slotBtn('tmp', '临时') + slotBtn('1', '槽1') + slotBtn('2', '槽2') + slotBtn('3', '槽3')
            + '</div>'
            + '<div class="nums" style="margin-top:8px">' + num('moneyCap', '金币上限(0=自动)', 0) + '</div>'
            + '<div class="fn"><button data-fn="probeCap">重新探测金币上限</button></div>'
            + '<div class="tip" style="text-align:left">若「立即加钱」加不进去，多半是金币已到引擎硬上限。点「重新探测金币上限」会实测引擎真正的上限；也可手动填上限（0 = 跟随实测值）。</div>';
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
                } else if (f === 'probeCap') {
                    try { probeMoneyCap(); } catch (e) { alert2('探测失败：' + e.message); }
                    refreshSlotBtns();
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
    function refreshSlotBtns() {
        each(document.querySelectorAll('#bayeCheatSlot .slot'), function (b) {
            b.classList.toggle('on', b.getAttribute('data-slot') === slotSelection());
        });
        var el = document.getElementById('bayeCheatSlotNow');
        if (el) el.textContent = currentSlot() + '（选择：' + slotSelection() + '）';
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
