// ───────────────────────── 全域狀態與選單設定（網址參數、滑桿上下限、降旗規則、模式） ─────────────────────────
var QIDX = null;                                   // 四邊形索引（每種船共用）；船型的資料在 05_hull.js
var SHIPS = [], PIECES = [], BALLS = [], EVENTS = [], FLY = [], PLAYER_I = 0;
// 選單的滑桿：[下限, 上限, 預設]。網址參數與滑桿共用這一組（⛔ 各一組 ⇒ ?demo 跑的不是網址寫的那組）；讀不懂的值 ⇒ 預設
// 值住在 config/game.json 的 lim（TASK-0542 設定後台）；各鍵的意思：
//   hard flood ballast gunw speed agile upwind：船隻設定（下面 SHIP_KEYS）；cas：降旗的死傷比例
//   gunhp sailhp crewhp powderhp：血量（砲／帆／船員／火藥桶；火藥桶拉滿上限 ＝ 不會爆）；crewdeath：船員 HP 歸零時當場陣亡的機率（%，沒中 ⇒ 傷員）；blast：殉爆威力；blastv：每次爆炸的威力浮動 ±
//   dmg12 dmg6 dmg3c：12 磅長砲、6 磅砲、3 磅追擊砲（風暴角號，TASK-0547；預設照彈重內插：4 磅 35、18 磅 70、24 磅 100）
//   dmgtr：三叉戟砲（三叉戟號船頭的奇幻三管速射砲，gura 酒館 24555；一發 18 磅 ⇒ 70）
//   dmg11d：莫尼特號砲塔的 XI 吋 Dahlgren（166 磅實心彈／136 磅爆裂彈 ⇒ 330；雙聯 ⇒ 一份彈藥兩發 burst 2）。
//   dmg9d dmg64b dmg7b：維吉尼亞號的 9 吋 Dahlgren（72.5 磅爆裂彈 ⇒ 200）、6.4 吋 Brooke（約 95 磅 ⇒ 190）、7 吋 Brooke（104 磅 ⇒ 240）（TASK-0616）
//   dmg36l dmg8l dmgpr：皇家號 La Réale（槳帆船）的 36 磅 coursier（36 livres ＝ 17.6 kg ⇒ 32 磅長砲 130 再往上 140）、8 磅 bâtarde（3.9 kg ⇒ 6 磅 40 與 12 磅 55 之間 45）、迴旋砲 pierrier（約 2 livres 的石彈／霰彈 ⇒ 25）（TASK-0703）
//   dmgsf：持火號（拜占庭 dromon，TASK-0693）的希臘火 siphon（每發 30，再乘 fire.k；潑開燒人、燒帆與細繩，不開洞 —— 28_fire.js）。弩砲、投石機的機制還在想（Tim 2026-10-18）⇒ 還沒進砲種表。
//   dmgbl：持火號的弩砲（toxoballistra；Tim 2026-10-18「弩炮目前我想直接做成換皮大炮(只是彈藥不同)」）：彈種弩箭（10_ship.js AMMO_BOLT），飛行與命中照實心彈、每發 25；之後改打火箭（AMMO_FIRE：碰到船點火，28_fire.js fireArrowHit），藥箱一份 3 發（砲種表 box）。
//   dmgmg：持火號的投石機（manganikon；Tim 2026-10-18「接著做投石機吧」「投石機是否可以給高拋物線彈道(可以砸到甲板)」）：石彈（AMMO_STONE）照實心彈、曲射（砲種表 lob、elev 75°），每發 60 ⚠ 估的。
//   dmgbw：蓬特號（古埃及蓬特遠征船，TASK-0754）的弓（角形複合弓；Tim 2026-10-20「做「弓」換皮砲（照弩砲的做法）加箭箱當彈藥庫」）：彈種弩箭（AMMO_BOLT，畫成一支箭、只有弓弦一響），每發 10（弩砲 25 再往下：0.03 kg 的箭）。
//   dmgbd：越嶺號（1453 鄂圖曼 fusta，TASK-0761）船首的 bombardella（鍛鐵箍砲、石彈約 7–8 cm ≈ 0.6 kg ⇒ 迴旋砲 pierrier 25 與 4 磅砲之間 30；Barbaro 1453-05-16 記鄂圖曼小船放 bombardele）
//   dmg305k dmg150k dmgh37：定遠號（1884 北洋艦隊旗艦，TASK-0779）的 30.5 cm 克虜伯 L/25（333 kg 鋼彈；照現有砲種「傷害 ∝ 彈重^0.57」從 XI 吋 Dahlgren 75 kg 330 外推 ⇒ 760，上限開到 1000）、15 cm 克虜伯 L/35（51 kg ⇒ 7 吋 Brooke 47 kg 240 再往上 250）、37 mm 哈乞開斯五管轉膛砲（0.5 kg ⇒ 15；五管 ⇒ burst 5）
//   dmg320c dmg120a dmgh57 dmgh47：松島號（1892 聯合艦隊旗艦，TASK-0780）的 32 cm Canet L/38（450 kg 彈；照「傷害 ∝ 彈重^0.57」從 XI 吋 Dahlgren 75 kg 330 外推 ⇒ 920，上限開到 1200）、12 cm Armstrong 速射砲（20.4 kg ⇒ 從 32 磅長砲 14.5 kg 130 外推 160）、57 mm 哈乞開斯 6 磅（2.72 kg ⇒ 跟 6 磅砲 2.7 kg 同 40）、47 mm 3 磅（1.5 kg ⇒ 3 磅追擊砲 1.4 kg 30）
//   dmg24 dmg32l dmg32 dmg18 dmg4：每發傷害（24 磅長砲、32 磅長砲（餘燼號）、32 磅 carronade、18 磅追擊砲、4 磅砲（夜隼號））
//   box：砲旁藥箱放幾份；carry：送藥手一次搬幾份；wind：帆的風壓；hands：預備水手（每艘幾個人物，42_hands.js）；drown：溺水時間（秒，43_swim.js）；musket：火槍的最大射程（m，40_crew.js）；sailfix：帆匠補帆的時間（秒，47_sailmaker.js）；burn：火勢（%，49_burn.js）
//   sea：浪的大小（0 平靜、1 中浪、3 大浪）；stall：頂風失速（0 只是慢、1 寫實）；funspeed funagile funstall funpowder funhard：娛樂加成（玩法選娛樂時再乘；funhard ＝ 鐵甲的擊穿門檻倍率，TASK-0621）
var LIM = CFG.lim;
function stateQnum(k, lim) { var v = parseFloat(Q.get(k)); return isFinite(v) ? clamp(v, lim[0], lim[1]) : lim[2]; }
// 玩法（Tim 2026-10-13：配置分成寫實與娛樂兩組，主選單切換，預設娛樂）：細節設定的滑桿 ＝ 寫實的基準，
//   娛樂 ＝ 在那之上再乘娛樂加成（航速、靈活性、頂風失速）。⇒ 兩組共用同一份滑桿，切換不會把調好的數字蓋掉。網址 ?play=real／fun
var PLAY = Q.has('play') ? (Q.get('play') === 'real' ? 'real' : 'fun') : CFG.menu.play;   // 沒給 ⇒ 設定檔的預設（menu.play）
var STALL_K = stateQnum('stall', LIM.stall);
var HELM_LOST = stateQnum('helmlost', LIM.helmlost);                       // 舵或舵輪被打壞後的操舵性能（Tim 2026-10-20：寫實 25%、娛樂加成 ×2 ⇒ 50%；31_sailing.js helmK）—— 只在操舵的開關關掉時用（?helmtq=0，TASK-0777）
var WHEEL_LOSS = stateQnum('wheelloss', LIM.wheelloss), RUDDER_LOSS = stateQnum('rudderloss', LIM.rudderloss);   // 操舵（TASK-0777，31_drive.js）：舵輪（舵柄）、舵被打掉的損失（寫實 40%、100%；娛樂再 × FUN.helmloss）
var DIFF_K = stateQnum('difftq', LIM.difftq);                               // 差動打滿 ＝ 舵的幾成（TASK-0777，31_drive.js helmYaw；預設 0.5；Tim：槳帆船單靠兩舷推力差也轉得動）
var FUN = { speed: stateQnum('funspeed', LIM.funspeed), agile: stateQnum('funagile', LIM.funagile), stall: stateQnum('funstall', LIM.funstall), powder: stateQnum('funpowder', LIM.funpowder), hard: stateQnum('funhard', LIM.funhard), helm: stateQnum('funhelm', LIM.funhelm), helmloss: stateQnum('funhelmloss', LIM.funhelmloss), helmeff: stateQnum('funhelmeff', LIM.funhelmeff), diff: stateQnum('fundiff', LIM.fundiff) };
function playK(k) { return PLAY === 'fun' ? FUN[k] : 1; }
// 船隻設定（照船型套；Tim 2026-10-12：不同船套用不同設定）：每一型一組，開戰時複製到每艘船（sh.cfg）。
//   hard  船殼硬度倍率（越硬越難打穿、洞越小；被打的那艘照自己的）：預設 3（Tim：原本 2 ⇒ 1.5 倍）
//   flood 進水速度倍率（0 ＝ 不會沉）
//   ballast 壓艙物（噸）：不會被打掉的重量；預設 ＝ 那一型「剛好在設計水線」（T.ballast0：憲法號 1,075），越輕浮得越高（減重上浮，32_hull.js）
//   gunw  砲的重量倍率（照實 ＝ 1：長砲 2.5 噸、carronade 0.9、追擊砲 2.1）：越重 ⇒ 吃水越深、砲被打飛浮得越多
//   speed 航速倍率（乘在 VMAX 上）；agile 靈活性倍率（乘在最大轉向率上；跟航速倍率分開 —— 轉向率用的是除掉倍率的航速）。玩法選娛樂 ⇒ 兩個再乘娛樂加成（playK）
//   upwind 逆風性能（31_sailing.js）：風從船頭那一半（迎風、頂風）的角度照它壓縮 ⇒ 同一個角度跑得快、吃風更近（失速晚開始）、越接近頂風轉得越快（最多 ×它）；1 ＝ 照舊
// 起始值 ＝ 網址參數（?hard= …，套到每一型）或 LIM 的預設；壓艙物網址沒給 ⇒ 存檔裡那一型的（同一份船才算，69_prefs.js）⇒ 那一型的 ballast0（船型載好才知道）。
//   base  額外動力（節；畫面上 Tim 2026-10-15 改名，以前叫基底航速；31_sailing.js；Tim 2026-10-14：風暴角號是幽靈船、之後的蒸汽船）：額外動力帶來的航速 —— 不管風向、風速、掛幾面帆都有，
//         跟帆的航速脫鉤（不乘 speed、玩法加成、天氣）；實際航速 ＝ √(帆的航速² ＋ 它²)：兩種動力的推力相加（蒸汽帆船；阻力 ∝ 速度²、各自單獨能跑到的航速就是那份推力 ⇒ 推力相加 ＝ 平方相加）。0 ＝ 沒有 ⇒ 照舊
//   pump  基礎抽水量（噸／分；TASK-0604，Tim 2026-10-15：「不同船型的基礎抽水能力應該不同（後台可以調）」）：每型自己的抽水機；跟進水速度分開（flood 照舊同時縮放進水與抽水）。
//         預設 ＝ 18 ×（設計排水量／憲法號 2152 噸）^⅔（抽水機、搖的人手 ∝ 船的大小；憲法號 18 ＝ 以前每艘都一樣的那個值），值寫在 config/game.json 每艘的 cfg
var SHIP_KEYS = ['hard', 'flood', 'ballast', 'gunw', 'speed', 'agile', 'upwind', 'base', 'pump'], SHIP_CFG = {};
var PUMP_REF = 18;                                     // 噸／分：以前每艘船一樣的抽水量（粒子模式 FL_PUMP ＝ 它換成 m³/s（÷ 海水密度）、公式模式 0.004 m/s 是它）⇒ 抽水 ×（pump／PUMP_REF）
// 船型自己的預設（沒列的 ＝ LIM 的預設）。Tim 2026-10-13：憲法號要比餘燼號快、靈活 ⇒ 憲法號照舊 1（巡防艦），
//   餘燼號是兩層砲甲板、90 門砲的重船 ⇒ 航速 0.85、靈活 0.7。網址參數（?speed= …）照舊套到每一型。
//   夜隼號（Tim 2026-10-13：「速度更快、更靈活，彌補火力劣勢」「加強逆風航速與轉彎，彌補火力跟防禦不足」「材質硬度兩倍試試」）：
//   12 門 4 磅砲的雙桅小船（brigantine：主桅縱帆，吃風比全橫帆的船近）⇒ 航速 1.2、靈活 1.6、逆風 1.25、硬度 6（預設 3 的兩倍）。
//   值住在 config/game.json 每艘船的 cfg（TASK-0542）。
var HULL_CFG0 = {}; CFG.ships.forEach(function (s) { if (s.cfg) HULL_CFG0[s.id] = s.cfg; });
function cfgBase(k, id) { var d = HULL_CFG0[id]; return d && d[k] !== undefined ? d[k] : LIM[k][2]; }
var PREF_BALLAST = {};                                   // 存檔裡的壓艙物：id → { v: 噸, chk: 存的時候那艘船的 checksum }（船重匯過 ⇒ 不套）
function cfgDefault(k, T, id) {
  if (k !== 'ballast') return Q.has(k) ? stateQnum(k, LIM[k]) : cfgBase(k, id);
  if (Q.has('ballast')) return Math.round(stateQnum('ballast', LIM.ballast));
  var pb = T && PREF_BALLAST[T.id];
  if (pb && pb.chk === T.h.checksum) return pb.v;
  return T && isFinite(T.ballast0) ? T.ballast0 : LIM.ballast[2];
}
/** 那一型的設定（第一次用到才建；壓艙物等船型載好才填）。 */
function shipCfg(id) {
  var c = SHIP_CFG[id];
  if (!c) { c = SHIP_CFG[id] = {}; SHIP_KEYS.forEach(function (k) { if (k !== 'ballast') c[k] = cfgDefault(k, null, id); }); }
  if (c.ballast === undefined && HULLT[id]) c.ballast = cfgDefault('ballast', HULLT[id]);
  return c;
}
function cfgCopy(id) { var c = shipCfg(id), o = {}; SHIP_KEYS.forEach(function (k) { o[k] = c[k]; }); return o; }
var GUN_HP = Math.round(stateQnum('gunhp', LIM.gunhp));          // 砲的血量（舵輪 6 成）：預設 200 ⇒ 24 磅實心兩發（Tim 2026-10-12：100 太脆，翻倍）
var SAIL_HP = Math.round(stateQnum('sailhp', LIM.sailhp));       // 帆的血量
var CREW_HP = Math.round(stateQnum('crewhp', LIM.crewhp));       // 船員的血量：歸零陣亡、掉到一半以下受傷倒下、一半以上照常作戰（只閃紅）
var CREW_DEATH = Math.round(stateQnum('crewdeath', LIM.crewdeath));   // 船員死亡率（%）：HP 歸零那一刻當場陣亡的機率，沒中 ⇒ 變成傷員（40_crew.js damageCrew；Tim 2026-10-16，預設 50）
var POWDER_HP = Math.round(stateQnum('powderhp', LIM.powderhp)); // 火藥桶的血量：歸零殉爆；拉滿（LIM 上限）＝ 不會爆；預設 675 ＝ 很難但有機率
var BLAST_K = stateQnum('blast', LIM.blast);                             // 殉爆威力倍率（能量；爆炸半徑 ∝ 立方根）
var BLAST_V = stateQnum('blastv', LIM.blastv);                           // 每一次爆炸（火藥桶、彈藥庫、藥包）的威力再乘 1 ± 這個數之間的亂數（23_powder.js blastRoll）
var BOX_N = Math.round(stateQnum('box', LIM.box)), CARRY_N = Math.round(stateQnum('carry', LIM.carry));   // 砲旁藥箱容量、送藥手一次搬幾份（火藥與彈藥一份 ＝ 裝填一次）
var HANDS = Math.round(stateQnum('hands', LIM.hands));                  // 預備水手：缺人手時補位（42_hands.js）
var MUSKET_R = Math.round(stateQnum('musket', LIM.musket));            // 火槍的最大射程（m）：射程內看不到人就不開槍（40_crew.js musket；TASK-0633）
var SAILFIX_T = Math.round(stateQnum('sailfix', LIM.sailfix));         // 帆匠：補一面從滿血打到快掉的帆要幾秒（照缺的血量比例算；47_sailmaker.js；TASK-0699）
var BURN_PCT = Math.round(stateQnum('burn', LIM.burn));                 // 火勢（%）：希臘火點著的火延燒多快（帆也是）；0 ＝ 不點火、希臘火照以前只燒人與撕帆（49_burn.js；TASK-0717）
var GALLEY_PCT = Math.round(stateQnum('galley', LIM.galley));           // 廚房加成（%）：吃過飯的水手工作效率 ×(1 ＋ GALLEY_PCT ÷ 100)；0 ＝ 關（不開廚房、不生廚師；45_galley.js；TASK-0720）
var HEAL_T = Math.round(stateQnum('heal', LIM.heal));                  // 醫療艙：治好一個傷員要幾秒（滿人手、沒有 buff；0 ＝ 關 ⇒ 傷員照舊 12 秒抬下去；44_medic.js）
var NAV_RE = stateQnum('navre', LIM.navre);                              // 尋路動態更新：每幾秒看一次有沒有甲板、梯子被打壞（0 ＝ 關；42_hands.js navRefresh；TASK-0572）
// Debug 模式（Tim 2026-10-15：「在細節設定加上Debug模式 之後用來Debug(可以加特殊功能 & 顯示額外資訊 我來幫忙查問題)」）：細節設定的勾選（存檔）、網址 ?dbg=1；?debug=1 也算開。
//   開著 ⇒ 詳細資訊的「⚓ 改操控這艘」敵艦也有（52_fleet.js canTake）、羅盤下面那一行除錯資訊（格數、四邊形、碎片、FPS…，61_hud.js）。之後的除錯功能都掛在 dbgOn() 底下。⛔ __game 與逐幀計時照舊只看 ?debug=1（載入時就定）。
var DBG_SET = Q.get('dbg') === '1';
function dbgOn() { return DEBUG || DBG_SET; }
var GUN_CREW_HURT = Q.get('gcrew') !== '0';                          // 砲被打飛 ⇒ 那門砲的砲班跟著受傷（21_gunnery.js blowModel；TASK-0568，預設開；?gcrew=0 ＝ 照舊）
var DROWN_T = Math.round(stateQnum('drown', LIM.drown));                // 落水求生：浮上水面、往自己的船游，撐這麼久（× 0.6～1.2）就溺水（43_swim.js）
var SEA_K = stateQnum('sea', LIM.sea);                                   // 浪的大小（08_sea.js；物理與畫面共用）
var WIND_CAP = stateQnum('windcap', LIM.windcap);
// 動力的手感（TASK-0630；細節設定「動力」；Tim 2026-10-15：「迴轉半徑我之後再調手感(可以有參數調整)」）：預設都是 1 ＝ 校準好的樣子（31_drive.js）。
//   DRV_INERTIA 加速慣性：實際質量的倍率（2 ⇒ 加減速慢一倍）；DRV_TURN 迴轉慣性：轉向率追舵的時間（1 ＝ 以前的 2 秒）；DRV_TQ 帆的力矩：受損不平衡時船自己偏多少（0 ＝ 不偏）。
var DRV_INERTIA = stateQnum('inertia', LIM.inertia), DRV_TURN = stateQnum('turninert', LIM.turninert), DRV_TQ = stateQnum('sailtq', LIM.sailtq);                       // 推帆的風速上限（m/s；30_rig_physics.js physStep）：Tim 2026-10-15「暴風雨中變形有點太誇張」⇒ 風壓×陣風×暴風雨×風速 乘完再夾
var WIND_K = stateQnum('wind', LIM.wind);                                // 帆的風壓倍率（只管物理開著時帆被吹成什麼樣子；不改航速）
function powderNever() { return POWDER_HP >= LIM.powderhp[1]; }      // 拉滿 ＝ 不會爆：兩種玩法都是（娛樂的倍率不管它）
function powderHP() { return Math.round(POWDER_HP * playK('powder')); }   // 實際的火藥血量：娛樂再乘 FUN.powder（預設 675 ⇒ 300）
// 每發傷害（砲種）：砲彈開火時帶著 b.dmg
var DMG = { long12: Math.round(stateQnum('dmg12', LIM.dmg12)), long18: Math.round(stateQnum('dmg18l', LIM.dmg18l)), long6: Math.round(stateQnum('dmg6', LIM.dmg6)), chase3: Math.round(stateQnum('dmg3c', LIM.dmg3c)), trident: Math.round(stateQnum('dmgtr', LIM.dmgtr)), dahl9: Math.round(stateQnum('dmg9d', LIM.dmg9d)), brooke64: Math.round(stateQnum('dmg64b', LIM.dmg64b)), brooke7: Math.round(stateQnum('dmg7b', LIM.dmg7b)), dahl11: Math.round(stateQnum('dmg11d', LIM.dmg11d)), long: Math.round(stateQnum('dmg24', LIM.dmg24)), long32: Math.round(stateQnum('dmg32l', LIM.dmg32l)), carr: Math.round(stateQnum('dmg32', LIM.dmg32)), chase: Math.round(stateQnum('dmg18', LIM.dmg18)), long4: Math.round(stateQnum('dmg4', LIM.dmg4)), long36: Math.round(stateQnum('dmg36l', LIM.dmg36l)), long8: Math.round(stateQnum('dmg8l', LIM.dmg8l)), pierrier: Math.round(stateQnum('dmgpr', LIM.dmgpr)), siphon: Math.round(stateQnum('dmgsf', LIM.dmgsf)), ballista: Math.round(stateQnum('dmgbl', LIM.dmgbl)), mangonel: Math.round(stateQnum('dmgmg', LIM.dmgmg)), bow: Math.round(stateQnum('dmgbw', LIM.dmgbw)), bombardella: Math.round(stateQnum('dmgbd', LIM.dmgbd)), krupp305: Math.round(stateQnum('dmg305k', LIM.dmg305k)), krupp150: Math.round(stateQnum('dmg150k', LIM.dmg150k)), hotch37: Math.round(stateQnum('dmgh37', LIM.dmgh37)), canet320: Math.round(stateQnum('dmg320c', LIM.dmg320c)), armstrong120: Math.round(stateQnum('dmg120a', LIM.dmg120a)), hotch57: Math.round(stateQnum('dmgh57', LIM.dmgh57)), hotch47: Math.round(stateQnum('dmgh47', LIM.dmgh47)) };
// 彈種倍率（%）：列 ＝ 實心／爆裂／鏈彈，欄 ＝ 對砲（模型：砲、舵輪、火藥桶）／對帆／對人。網址 ?ammo= 九個數字（照列）
var AMMO_LIM = CFG.ammo.lim, AMMO_K0 = CFG.ammo.k;   // config/game.json 的 ammo（上下限、預設）。爆裂對人原訂 115：量過死亡平均 42（舊版 27）⇒ 100（35，傷亡合計 62 對舊版 65）
var AMMO_K = AMMO_K0.map(function (r) { return r.slice(); });
if (Q.has('ammo')) Q.get('ammo').split(',').forEach(function (w, i) { var v = parseFloat(w); if (i < 9 && isFinite(v)) AMMO_K[(i / 3) | 0][i % 3] = clamp(Math.round(v), AMMO_LIM[0], AMMO_LIM[1]); });
var VS_GUN = 0, VS_SAIL = 1, VS_CREW = 2;
function ammoK(ammo, vs) { return ammo === AMMO_GF ? CFG.fire.k[vs] / 100 : AMMO_K[ammoBase(ammo)][vs] / 100; }   // 弩箭、火箭、石彈（10_ship.js ammoBase）照實心彈的倍率   // 希臘火（AMMO_GF，28_fire.js）不在玩家換彈的三種裡：倍率在 config/game.json 的 fire.k
// 降旗規則（選單設定）：死傷比例到 cas 就降旗（1 ＝ 全員倒下才停）；三個勾選各自是另一條。預設 ＝ 不降旗，打到沉或全員倒下。
// 網址：?strike=60,guns,masts,officers（數字是死傷百分比，後面列出要勾的規則）
var STRIKE = { cas: LIM.cas[2], guns: false, masts: false, officers: false };
if (Q.has('strike')) Q.get('strike').split(',').forEach(function (w) {
  var v = parseFloat(w);
  if (isFinite(v)) STRIKE.cas = clamp(v / 100, LIM.cas[0], LIM.cas[1]);
  else if (w === 'guns' || w === 'masts' || w === 'officers') STRIKE[w] = true;
});
// 砲長（51_captain.js）：[我艦, 敵艦]，random ＝ 開局抽；網址 ?cap=sink,mast
var CAP_SET = ['random', 'random'];
if (Q.has('cap')) Q.get('cap').split(',').forEach(function (w, i) { if (i < 2) CAP_SET[i] = w; });
var LAST_MODE = null;                                // 上一場的模式（自動開砲換了模式才套預設，見 reset）
// DIST：開局兩邊船頭相距幾公尺（主選單滑桿，範圍 LIM_DIST；網址 ?dist=）。Tim 2026-10-13：「距離改成滑桿、50～1000 m」「兩邊船頭相對互相接近，而不是直接橫排一開場就開砲」。
//   電腦想保持的交戰距離另算（aiRange，31_sailing.js：夾在 90～220 m；⛔ 照 DIST ⇒ 開局 1000 m 時電腦在 1000 m 外繞圈、打不到）。
var LIM_DIST = CFG.dist;                              // config/game.json 的 dist：[下限, 上限, 預設]
var MODE = CFG.menu.mode, DIST = Q.has('dist') && isFinite(+Q.get('dist')) ? clamp(Math.round(+Q.get('dist')), LIM_DIST[0], LIM_DIST[1]) : LIM_DIST[2], SIMT = 0, RUNNING = false, PAUSED = false, OVER = false, AMMO_I = 0;
var SAIL = Q.has('sail') ? (Q.get('sail') === 'off' ? 'off' : Q.get('sail') === 'manual' ? 'manual' : 'auto') : CFG.menu.sail;   // 航行：auto ＝ 兩艘自動、manual ＝ 我艦手動、off ＝ 停船；沒給 ⇒ menu.sail
var KEYS = { l: false, r: false, sw: null };  // 手動操舵：按住的舵鍵（額外動力以前是按住 W／S 的油門，Tim 2026-10-15 改成帆段兩頭的「全速前進／倒車」⇒ 31_sailing.js sailStep）；sw ＝ 按住加帆／收帆（{ d: ±1, n: 下一次再切的 SIMT }；sailHold）
// 殉爆的慢動作與特寫（73_slowmo.js）：on／cam 是設定；ts 現在的時間倍率。SLOW_VIS：這一格畫面裡只給人看的效果改由 frame 走（step() 讀它決定要不要跳過）
var RAM = { v0: stateQnum('ramv', LIM.ramv), k: stateQnum('ramk', LIM.ramk), e: stateQnum('rame', LIM.rame), side: stateQnum('ramside', LIM.ramside) };   // 碰撞傷害的數值（31_sailing.js ramHit；TASK-0652）：門檻 m/s、傷害倍率、恢復係數、側撞有效質量倍數 —— 物理設定頁的滑桿（打開碰撞傷害才顯示）
var PSLOW = { on: Q.get('pslow') === '1', ts: 1, ms: 0, budget: stateQnum('pslowb', LIM.pslowb) };   // 物理減速（73_slowmo.js；Tim 2026-10-14：預設關）：ts ＝ 現在的倍率、ms ＝ 一步模擬平均幾毫秒、budget ＝ 門檻（模擬最多佔真實時間幾成）
// 模擬速度（Tim 2026-10-15：「設定選單 是否可以加個Slider調整模擬速度」「最低0.05好了(0相當於暫停)」）：0.05–8 倍，設定（O）的滑桿；只是每格畫面累積的時間 × 它（90_main.js frame），模擬一步照舊 DT ⇒ 戰局逐字不變。
var SIM_SPEED = 1, SIM_SPEED_MIN = 0.05, SIM_SPEED_MAX = 8;
if (DEBUG && +Q.get('simmax') > 0) SIM_SPEED_MAX = +Q.get('simmax');   // 量測用（?debug=1&simmax=32；TASK-0800 量「不掉格最高到 ×幾」）：放寬上限，滑桿照舊到 ×8、__game.speed(x) 才設得到
var SLOW = { on: Q.get('slowmo') !== '0', cam: Q.get('slowcam') !== '0', ts: 1, t: 0, min: 1, hold: 0, active: false, camSave: null, camT: 0, camMode: 0, kicks: 0 }, SLOW_VIS = false;
var AUTOFIRE = false;                                  // 自動開砲：電腦替我艦瞄準、開火（觀戰 ＝ 一般戰鬥＋自動開砲預設開；G 切換）
var PHYS = Q.get('phys') !== '0';                      // 帆與繩的物理（選單勾選、B 鍵、下方按鈕；?phys=0 關）：關 ＝ 靜態，跟以前一樣

