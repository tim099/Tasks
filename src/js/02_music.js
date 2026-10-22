// ───────────────────────── 背景音樂：合成音讀譜播放船歌（TASK-0677） ─────────────────────────
// Tim 2026-10-17：「是否可以用點子合成音來播放樂譜 樂譜可以找看看真實船歌 同時設計一套樂譜系統(讀譜播放 節省空間)」「然後這個做為BGM 要另外增加一個音效 BGM音量設定頁面」。
// 樂譜：ABC 記譜法的子集（一首一個物件，見 TUNES；格式寫在 src/README「背景音樂的樂譜」）—— 一首旋律＋低音約 0.2–0.3 KB（音檔一首要 1–3 MB）。
//   音名 C D E F G A B（C ＝ 中央 C）、小寫高八度，後面 ' 再高、, 再低；^ 升 _ 降 = 還原（照 K 調號；同一小節同一個音名同八度沿用，| 換小節失效）；
//   時值 ＝ 單位長度 L（八分音符）的倍數：無 ＝ 1、2 ＝ 2、/2 ＝ 一半、3/2 ＝ 一個半；z 休止；- 連到下一個同音高（跨小節）；[M:3/4] 中途換拍號（只給人讀，時間照時值算）。
// 曲子只從公有領域的樂譜取（⛔ 不用近代編曲、網路上別人的 ABC 轉譜）：R. R. Terry《The Shanty Book》Part I（Curwen 1921）——
//   旋律照書上的人聲那一行、低音取鋼琴左手最低音；從 Project Gutenberg #20774 附的 MIDI 量化到十六分，再逐小節對過書頁的譜面（讀數在 TASK-0677）。
// 播放：WebAudio（02_audio.js 的 AC）；旋律 ＝ 鋸齒波＋低通＋晚到的顫音（像提琴），低音 ＝ 兩道微走音的方波＋低通（像手風琴）。往前排 BGM_LOOK 秒，不吃主迴圈。
//   每首反覆到約 BGM_TUNE_S 秒（bgmPasses）、停 BGM_GAP 秒換下一首（輪播照自己的 LCG 洗牌）。
// 船的主題曲（TASK-0681）：操控的船（SHIPS[PLAYER_I]）有 theme ⇒ 放 THEMES 那首、重複放；改操控換到沒有的 ⇒ 回輪播／指定曲。樂器表 INSTR（提琴、手風琴、音樂盒、管風琴、錫口笛、撥弦；TASK-0718 再十二種：詠唱團、持續音、銅管、法國號、小號、定音鼓、小鼓、大鼓、橫笛、箏、魯特琴、大鍵琴），
//   整份 ABC（和弦、L:1/4、小調、!p! !rit!、[I:樂器]）見 abcTune；音樂盒、管風琴送一點殘響（bgmOut）。
// 年代篇（TASK-0718）：TUNES 再十二首（宣傳片七章的配樂；整份 ABC＋era，聲音設定頁照 BGM_ERAS 分組列）——
//   東羅馬聖詠、福利亞／帕凡舞、夏龐蒂埃的感恩讚、總統進行曲／擲彈兵進行曲、出征敘利亞／櫻花、共和國戰歌／自由的戰鬥吶喊、漂泊的荷蘭人；輪播照舊抽全部 TUNES。
// 純聲音：⛔ 不抽 rnd()、不用 Math.random ⇒ 戰局的亂數一位元都不動；靜音（M）⇒ 三條音量線一起 0、排程照跑。
var SND = { sfx: 1, amb: 1, bgm: 0.5, mode: 'duck', tune: 'shuffle', theme: 1 };   // 音量 0–1；mode：'duck' 交戰時稍微小聲（× BGM_DUCK）／'on' 一直放、不變／'off'；tune：'shuffle' 輪播或曲 id；theme：1 操控的船有主題曲時改放它（TASK-0681）／0 不放
var SND_DEF = JSON.parse(JSON.stringify(SND));
var SND_FIGHT = -1e9, BGM_FIGHT_S = 20, BGM_FADE = 2.5, BGM_DUCK = 0.7;   // BGM_DUCK：交戰時剩幾成（Tim 2026-10-17「其實不用開炮淡出」「或不要完全淡出」「可以稍微變小一點點」⇒ 0.7 ≈ −3 dB，⛔ 不歸零）
//   開砲、爆炸（02_audio.js sfx boom／blast）之後 BGM_FIGHT_S 秒內算交戰 ⇒ 'duck' 模式小聲一點（時間常數 BGM_FADE 秒）
var BGM_LOOK = 0.8, BGM_TUNE_S = 60, BGM_GAP = 4, BGM_VOL = 0.5, BGM_SWAP = 0.4;          // 每首反覆到約 BGM_TUNE_S 秒（2–6 遍：一遍 11 秒的跟一遍 38 秒的都差不多一分鐘）        // BGM_VOL：音樂整條的基準（量過才定，見 TASK-0677）
var BGM = null, BGM_SEED = 7654321, BGM_ORDER = [];                    // BGM：{ tn 正在放的那首, t0 這一遍從幾秒開始, k 下一個沒排的事件, pass 第幾遍, forced 試聽鈕點的（交戰時不變小、播完回輪播） }
var TUNES = [
  { id: 'drunken', name: '酒醉的水手', en: 'What Shall We Do with the Drunken Sailor?', src: 'Terry, The Shanty Book I (1921) No.14, pp.30–31', M: '2/4', K: 'C', Q: 108, inst: ['whistle', 'accordion'],
    mel: 'A A/2 A/2 A A/2 A/2|A D F A|G G/2 G/2 G G/2 G/2|G C E G|A A/2 A/2 A A/2 A/2|A B c d|c A G E|D2 D2|A2 A3/2 A/2|A D F A|G2 G3/2 G/2|G C E G|A2 A3/2 A/2|A B c d|c A G E|D2 D2',
    bass: 'D,4|D,4|C,,4|C,4|D,,4-|D,,2 F, D,|A,, C, E, C,|D,2 D,2|D,,4|D,,4|C,,4|C,,4|D,,4-|D,,2 F, D,|A,, C, E, C,|D,2 D,,2' },
  { id: 'shenandoah', name: '雪蘭多亞', en: 'Shenandoah', src: 'Terry, The Shanty Book I (1921) No.9, pp.20–21', M: '4/4', K: 'Eb', Q: 50, inst: ['fiddle', 'organ'],
    mel: 'B,2|E E E3 F G A|[M:3/4] c B3 e d|c3 B c B|G B3 B2|[M:4/4] c c c3 G B G|[M:3/4] F E3 F2|G3 E G3/2 c/2|B6|E3/2 F/2 G3 F|F2 E2',
    bass: 'B,,2|E,,2 E,6|[M:3/4] E,,2 E,4|E,6|E,6|[M:4/4] A,,4 B,,4|[M:3/4] C,6|B,,,6|B,,,6|C,4 A,,2|B,,2 E,,2' },
  { id: 'blowtheman', name: '把那傢伙吹倒', en: 'Blow the Man Down', src: 'Terry, The Shanty Book I (1921) No.16, pp.34–35', M: '6/8', K: 'Eb', Q: 132, inst: ['accordion', 'pluck'], vol: 0.78,
    mel: 'E G|B3/2 c/2 B G E G|B c B G E G|B3 c3|A3/2 G/2 A F2 G|A3/2 G/2 A F D F|A G F c2 e|B/2 B3/2 B B2 A|G3/2 F/2 G E',
    bass: 'z3/2 E,,/2|E,5/2 E,,/2 B,,5/2 E,,/2|E,5/2 E,,/2 B,,5/2 G,,/2-|G,,5/2 C,3 F,,/2|F,5/2 B,,3 F,/2-|F,5/2 B,,3 F,/2-|F,3 E,3|D,3 E,2 C,|B,,3 E,' },
  { id: 'rio', name: '開往里約格蘭德', en: 'Bound for the Rio Grande', src: 'Terry, The Shanty Book I (1921) No.2, pp.4–5', M: '6/8', K: 'Eb', Q: 90, inst: ['pluck', 'accordion'],
    mel: 'B,|E E E G G G|F E F E3|B5 G|c B4 B|c e c B A G|A B A G E F|G3/2 A/2 G F E F|E3 E2 F|G3 F E F|E6|B5 G|c B4 B|c e c B A G|A B A G E F|G3/2 A/2 G F E F|E5',
    bass: 'z|E,,3 E,,3|E,,3 E,,3|E,6|E, F,5|A,,3 G,,3|F,,2 B,,, C,,3|B,,,6|E,,3 C,,3|B,,,2 B,,4|E,6|E,6|E,6|A,,3 G,,3|F,2 B,, C,3|B,,,3 B,,,3|E,,3 E,,2' },
  // ── 年代篇（TASK-0718；宣傳片七章的配樂，也進輪播與聲音設定頁）：整份 ABC（abc，寫法跟 THEMES 一樣、樂器照 [I:]）；era ＝ 哪一章（聲音設定頁照 BGM_ERAS 分組列）。
  //   旋律都是照公有領域的原版掃描逐音讀成 ABC（⛔ 沒有抄、也沒有參考網路上的 ABC／MIDI／近代編曲）；出處、年份、改了什麼寫在每首的 src，讀譜的憑據在 TASK-0718。
  //   vol ＝ 整首的音量倍數：A 加權 RMS 對齊四首船歌（−24.3…−25.1 dB；一遍＋0.5 秒的窗，src/README「年代篇的曲子」）。⚠ vol 跟力度記號乘在一起送進樂器 ⇒ 銅管（brass／horn／trumpet）的亮度也跟著 vol 走。
  // 東羅馬帝國（10 世紀德羅蒙戰艦的希臘火、1453 君士坦丁堡陷落）：拜占庭聖詠（Bourgault-Ducoudray 1877）
  { id: 'methimon', era: 'eastroman', name: '神與我們同在', en: 'Μεθ᾽ ἡμῶν ὁ Θεός (Meth\' hēmōn ho Theos)',
    src: 'Bourgault-Ducoudray, Études sur la musique ecclésiastique grecque (Paris 1877) 頁 32 第二副調第 1 首（1875 年 Khalki 照 Tantalidis 口述記下）；旋律照原譜逐音。改編：原譜不分拍子 ⇒ 排成 4/4 十五小節；第 2 個延長記號（ὁ Θεός 的 D）延長成 4 拍再換氣 2 拍；倒數第二句「B♭. A」改成 B♭3/2 A/2 湊滿小節；最後一個 D 延長到 6 拍、漸慢；伊頌（持續低音 D／G 兩個八度）是我們照拜占庭習慣配的：句子落在 D 的地方唱 D，落在 G 那一段唱 G',
    vol: 0.77, abc: ['M:4/4', 'L:1/4', 'Q:1/4=72', 'K:Gm', 'V:1', 'V:2',
      "% 第二副調（ἦχος πλ. β'）：原譜調號 B♭ E♭ F♯ ⇒ K:Gm＋每小節寫 ^F",
      '[V:1] [I:choir] E ^F G2 | E ^F G2 | G A B B | A G A B | G2 A G | ^F E ^F G | ^F E D2- | D2 z2 |',
      '[V:2] [I:drone] !mp! [D,,D,]4- | [D,,D,]4 | [G,,G,]4- | [G,,G,]4- | [G,,G,]4 | [D,,D,]4- | [D,,D,]4- | [D,,D,]4- |',
      '[V:1] E ^F G G | G A G A | B c B3/2 A/2 | G2 A G | ^F E ^F G | ^F E D2- | !rit! D4 |]',
      '[V:2] [D,,D,]4 | [G,,G,]4- | [G,,G,]4- | [G,,G,]4 | [D,,D,]4- | [D,,D,]4- | !rit! [D,,D,]4 |]'] },
  { id: 'zoientafo', era: 'eastroman', name: '生命躺臥墓中', en: 'Ἡ ζωὴ ἐν τάφῳ (Hē zōē en taphō)',
    src: 'Bourgault-Ducoudray, Études sur la musique ecclésiastique grecque (Paris 1877) 頁 21 第一副調第 4 首前三行（聖週五墓前哀歌；1875 年 Khalki 照 Tantalidis、Aphtonidis 口述記下）；旋律照原譜逐音。改編：原譜不分拍子 ⇒ 排成 4/4 十一小節；第 1 行兩個小音符（倚音 A G）寫成 G/2 A/4 G/4 佔掉前一個 G 的後半拍；最後的 G（延長記號）延長到 4 拍、漸慢；伊頌 C 照原書頁 24「l\'ison devra être ut」，配兩個八度',
    vol: 0.91, abc: ['M:4/4', 'L:1/4', 'Q:1/4=60', 'K:F', 'V:1', 'V:2',
      "% 第一副調（ἦχος πλ. α'）：調號 B♭；第 5–7 小節的 B 原譜是還原記號（=B）",
      '[V:1] [I:choir] G A A3/2 B/2 | G B A2 | G G G/2 A/4 G/4 F | G A A2 |',
      '[V:2] [I:drone] !mp! [C,,C,]4- | [C,,C,]4- | [C,,C,]4- | [C,,C,]4- |',
      '[V:1] A A =B G | A =B c A | =B B c B | A2 A A | B c B A | B A G ^F | !rit! G4 |]',
      '[V:2] [C,,C,]4- | [C,,C,]4- | [C,,C,]4- | [C,,C,]4- | [C,,C,]4- | [C,,C,]4- | !rit! [C,,C,]4 |]'] },
  // 十七世紀西班牙（1618 大帆船、白銀船隊）
  { id: 'folia', era: 'spain', name: '福利亞舞曲', en: "La Folía (Folies d'Espagne)", src: 'Corelli, Op.5 No.12「Follia」的主題（羅馬 1700）；譜照 Grove, A Dictionary of Music and Musicians vol.1（Macmillan 1900 印本，初版 1879）p.539「Folia」條的譜例，16 小節旋律＋低音逐音對過。改編（TASK-0718）：旋律提琴、低音魯特琴、和弦大鍵琴（數字低音的撥弦樂器）；和弦照譜例的數字低音、簡化（第 3／11 小節的 5–♮6、第 15 小節的 7–6、4–3 不寫）；奏兩遍：第一遍只在每小節第一拍掃一下、第二遍低音加八度（D、C、F 加低八度；A、降 B、G 加高八度，免得低到 G1）、和弦每一拍掃一下（第 14、15 小節照低音換和弦的地方掃）；最後一小節漸慢',
    vol: 0.65, abc: ['M:3/4', 'L:1/8', 'Q:1/4=104', 'K:Dm', 'V:1', 'V:2', 'V:3',
      '% 旋律、低音 ＝ Grove 1879 p.539 的 Corelli 主題（d ＝ D5、D, ＝ D3）；K:Dm ⇒ B ＝ 降 B；c 沒寫記號 ＝ 還原 C（Grove 第 3、11 小節寫 c♮，因為前一小節是 c♯）',
      '% --- 第一遍：提琴拉主題、魯特琴低音、大鍵琴和弦每小節第一拍一下 ---',
      '[V:1] [I:fiddle] !mf! d2 d3 e | ^c6 | d2 d3 c/2d/2 | e6 | f2 f3 g | e6 | d^c d3 e | ^c6 | d2 d3 e | ^c6 | d2 d3 c/2d/2 | e6 | f2 f3 g | e4 f2 | d2 d3 ^c | d6 |',
      '[V:2] [I:lute] !mp! D,6 | A,,6 | D,6 | C,6 | F,6 | C,4 ^C,2 | D,2 B,,4 | A,,6 | D,6 | A,,6 | D,6 | C,6 | F,6 | C,3 ^C, D,2 | G,,2 A,,4 | D,6 |',
      '[V:3] [I:harpsichord] !pp! [F,A,D]6 | [E,A,^C]6 | [F,A,D]6 | [E,G,C]6 | [F,A,C]6 | [E,G,C]4 [E,A,^C]2 | [F,A,D]2 [F,B,D]4 | [E,A,^C]6 | [F,A,D]6 | [E,A,^C]6 | [F,A,D]6 | [E,G,C]6 | [F,A,C]6 | [E,G,C]3 [E,A,^C] [F,A,D]2 | [G,B,D]2 [E,A,]4 | [F,A,D]6 |',
      '% --- 第二遍：大聲一點、低音加八度（D C F 往下加、A 降B G 往上加：最低 C2，跟四首船歌的最低音〔降 B1〕差不多）、和弦每一拍掃一下（不跟旋律第三拍後半那個經過音一起掃；第 14、15 小節照低音換和弦的地方掃）；最後一小節漸慢 ---',
      '[V:1] !f! d2 d3 e | ^c6 | d2 d3 c/2d/2 | e6 | f2 f3 g | e6 | d^c d3 e | ^c6 | d2 d3 e | ^c6 | d2 d3 c/2d/2 | e6 | f2 f3 g | e4 f2 | d2 d3 ^c | !rit! d6 |]',
      '[V:2] !mf! [D,,D,]6 | [A,,A,]6 | [D,,D,]6 | [C,,C,]6 | [F,,F,]6 | [C,,C,]4 [^C,,^C,]2 | [D,,D,]2 [B,,B,]4 | [A,,A,]6 | [D,,D,]6 | [A,,A,]6 | [D,,D,]6 | [C,,C,]6 | [F,,F,]6 | [C,,C,]3 [^C,,^C,] [D,,D,]2 | [G,,G,]2 [A,,A,]4 | !rit! [D,,D,]6 |]',
      '[V:3] !p! [F,A,D]2 [F,A,D]2 [F,A,D]2 | [E,A,^C]2 [E,A,^C]2 [E,A,^C]2 | [F,A,D]2 [F,A,D]2 [F,A,D]2 | [E,G,C]2 [E,G,C]2 [E,G,C]2 | [F,A,C]2 [F,A,C]2 [F,A,C]2 | [E,G,C]2 [E,G,C]2 [E,A,^C]2 | [F,A,D]2 [F,B,D]2 [G,B,D]2 | [E,A,^C]2 [E,A,^C]2 [E,A,^C]2 | [F,A,D]2 [F,A,D]2 [F,A,D]2 | [E,A,^C]2 [E,A,^C]2 [E,A,^C]2 | [F,A,D]2 [F,A,D]2 [F,A,D]2 | [E,G,C]2 [E,G,C]2 [E,G,C]2 | [F,A,C]2 [F,A,C]2 [F,A,C]2 | [E,G,C]3 [E,A,^C] [F,A,D]2 | [G,B,D]2 [E,A,]3 [E,A,^C] | !rit! [F,A,D]6 |]'] },
  { id: 'pavana', era: 'spain', name: '西班牙帕凡舞', en: "Pavane d'Espagne (The Spanish Pavan)", src: "Tabourot（Arbeau），Orchésographie（Langres 1589）的 Pavane d'Espagne；譜照 Grove, A Dictionary of Music and Musicians vol.2（Macmillan 1900 印本，初版 1880）p.677「Pavan」條的譜例，8 小節逐音對過；鼓的節奏照同一條 p.676。改編（TASK-0718）：低音與內聲部的和聲是我們配的（D 多利安：Dm F G Am C）；奏兩遍：第一遍錫口笛＋撥弦低音（＋小鼓）、第二遍提琴＋手風琴內聲部；結尾改 D 大三和弦、漸慢",
    vol: 0.63, abc: ['M:4/2', 'L:1/4', 'Q:1/2=68', 'K:C', 'V:1', 'V:2', 'V:3', 'V:4',
      '% 旋律 ＝ Grove 1880 vol.2 p.677「Pavan」條引的 Tabourot 曲調（d ＝ D5、B ＝ B4）：沒有調號、結在 D（D 多利安）；一小節 ＝ 兩個全音符（Grove 的分法，8 小節）',
      '% --- 第一遍：錫口笛（當那時候跟鼓一起吹的笛子）＋撥弦低音 ---',
      '[V:1] [I:whistle] !mf! d4 c3 A | d2 c2 d3 e | d B c d e4 | e2 e2 e3 g | f2 e2 d3 c | d f e d c2 d2 | B2 c2 d3 c | B c d e d4 |',
      '[V:2] [I:pluck] !mp! D,4 F,4 | G,2 A,2 G,4 | G,4 A,4 | C,2 A,,2 C,4 | F,2 C,2 G,,3 A,, | D,2 A,,2 F,,2 G,,2 | G,,2 A,,2 G,,3 A,, | G,,4 D,4 |',
      '[V:3] [I:accordion] z8 | z8 | z8 | z8 | z8 | z8 | z8 | z8 |',
      '% --- 第二遍（Morley 1597：帕凡舞每一段奏兩遍）：提琴主旋律、手風琴內聲部（代替 Grove 說的 sackbut／oboe）、結尾 D 大三和弦＋漸慢 ---',
      '[V:1] [I:fiddle] !mf! d4 c3 A | d2 c2 d3 e | d B c d e4 | e2 e2 e3 g | f2 e2 d3 c | d f e d c2 d2 | B2 c2 d3 c | !rit! B c d e d4 |]',
      '[V:2] !mf! D,4 F,4 | G,2 A,2 G,4 | G,4 A,4 | C,2 A,,2 C,4 | F,2 C,2 G,,3 A,, | D,2 A,,2 F,,2 G,,2 | G,,2 A,,2 G,,3 A,, | !rit! G,,4 D,4 |]',
      '[V:3] !mp! [FA]4 [FA]4 | [GB]2 [EA]2 [GB]4 | [DG]4 [Ac]4 | [Gc]2 [Ac]2 [Gc]4 | [Ac]2 [Gc]2 [GB]3 [EA] | [FA]2 [EA]2 [FA]2 [GB]2 | [DG]2 [EA]2 [GB]3 [EA] | !rit! [DG]2 [GB]2 [^FA]4 |]',
      '% --- 小鼓（Tabourot：帕凡舞「從頭到尾鼓打一個音」：二分＋兩個四分；Grove p.676）---',
      '[V:4] [I:snare] !mp! C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C |',
      '[V:4] !mf! C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | !rit! C2 C C C4 |]'] },
  // 路易十四的法蘭西（1694 皇家號）
  { id: 'tedeum', era: 'louis', name: '感恩讚前奏曲', en: 'Te Deum, H.146: Prélude',
    src: '夏龐蒂埃（Marc-Antoine Charpentier, 1643–1704）《感恩讚》H.146 前奏曲（約 1690 年代）—— 照作曲者親筆手稿（BnF Rés. Vm1 259（10），Mélanges autographes 第 10 冊 p.154；Gallica btv1b550082275）轉：旋律 ＝ 號角（Rondeau）／第一部提琴（第一段插曲），低音 ＝ orgue et violes et bassons，定音鼓 ＝ Timballes 那一行。改編：手稿的 Rondeau（頭尾各奏兩次）＋兩段插曲 ⇒ Rondeau 一次＋第一段插曲＋Rondeau 一次（刪 Rondeau 的反覆、第二段插曲）；最後一小節的 D 拉滿一整小節、漸慢收尾；顫音記號不奏；插曲第 1 小節第 2 拍低音取 D／C♯（手稿音頭看起來高一格；照和聲、跟 Kickton 版一樣）；配器：號角 trumpet、插曲提琴、低音管風琴（手稿寫 orgue）、定音鼓 timpani',
    vol: 0.83, abc: ['M:2/2', 'L:1/8', 'Q:1/4=112', 'K:D', 'V:1', 'V:2', 'V:3',
      '% 手稿：BnF Rés. Vm1 259（10）p.154；拍號 2（兩個二分音符）、D 大調',
      '% 照手稿的反覆：Rondeau（號角＋定音鼓＋全體）→ 第一段插曲（1er couplet：弦樂＋木管；號角、鼓休息）→ Rondeau；手稿的 Rondeau bis（頭尾各兩次）、第二段插曲刪掉',
      '% --- Rondeau：號角（弱起 A）---',
      '[V:1] [I:trumpet] !mf! A2 | d2 de f2 d2 | a4 f3 f | g2 ag fg a2 | edef e2 A2 | d2 de f2 d2 | a4 f3 f | gafg e3 d | d6 [I:fiddle] !mp! ag |',
      '[V:2] [I:organ] !mf! D,2 | D,4 D,2 D,2 | C,2 A,,2 D,3 D, | G,,2 G,,2 D,E, F,G, | A,4 A,G, F,E, | D,4 D,2 D,2 | C,2 A,,2 D,3 D, | G,2 D,2 A,2 A,,2 | D,6 C,2 |',
      '[V:3] [I:timpani] !mp! D,2 | D,2 D,D, D,2 D,2 | A,,2 A,,A,, D,2 D,D, | D,2 D,D, D,D,D,D, | A,,4 A,,2 D,2 | D,2 D,D, D,2 D,2 | A,,2 A,,A,, D,2 D,D, | D,D,D,D, A,,2 A,,A,, | D,6 z2 |',
      '% --- 1er couplet：提琴（手稿 violons et instruments à vent 的第一部）；最後一拍號角接回 Rondeau 的弱起 ---',
      '[V:1] f2 d2 g2 gf | e3 d c2 f2 | e2 de c2 f2 | d3 c B2 b2 | b2 a2 a3 g | f3 e de f^g | a3 b ^g3 a | a6 [I:trumpet] !mf! A2 |',
      '[V:2] D,2 DC B,2 G,2 | A,4 A,2 D,2 | E,2 E,2 F,2 F,,2 | B,,4 B,,2 G,,2 | A,,2 A,,B,, C,2 A,,2 | D,4 D,2 D,2 | C,2 D,2 E,2 E,,2 | A,,2 A,G, F,G, F,E, |',
      '[V:3] z8 | z8 | z8 | z8 | z8 | z8 | z8 | z6 D,2 |',
      '% --- Rondeau（一次）；最後一小節 D 拉滿一整小節收尾 ---',
      '[V:1] d2 de f2 d2 | a4 f3 f | g2 ag fg a2 | edef e2 A2 | d2 de f2 d2 | a4 f3 f | gafg e3 d | !rit! d8 |]',
      '[V:2] D,4 D,2 D,2 | C,2 A,,2 D,3 D, | G,,2 G,,2 D,E, F,G, | A,4 A,G, F,E, | D,4 D,2 D,2 | C,2 A,,2 D,3 D, | G,2 D,2 A,2 A,,2 | !rit! D,8 |]',
      '[V:3] D,2 D,D, D,2 D,2 | A,,2 A,,A,, D,2 D,D, | D,2 D,D, D,D,D,D, | A,,4 A,,2 D,2 | D,2 D,D, D,2 D,2 | A,,2 A,,A,, D,2 D,D, | D,D,D,D, A,,2 A,,A,, | !rit! D,8 |]'] },
  // 十八世紀海軍（六分儀、三叉戟號、憲法號）
  { id: 'presidents', era: 'navy18', name: '總統進行曲', en: 'The President\'s March (Hail Columbia)',
    src: 'Philip Phile 作曲（作者照 Sonneck 1909 的考證；年份不詳：最早的印本約 1793，Sonneck 認為不能定在 1789）；1798 年 Joseph Hopkinson 照這首填詞成 Hail Columbia；旋律照 Shaw\'s Flute Preceptor（Philadelphia 1802），讀的是 O. G. Sonneck《Report on "The Star-Spangled Banner", "Hail Columbia", "America", "Yankee Doodle"》（Washington: GPO 1909）頁 67 的抄本（Internet Archive reportonthestars00sonniala 第 n72 葉），對過同頁 Willig《Compleat Tutor for the Fife》（約 1805）與 Plate XI（Shaw & Carr《Gentleman\'s Amusement》1794）；改編（TASK-0718）：原譜 C 拍（4/4）的時值減半寫成 2/4（跟 1805 橫笛版一樣）；三連音寫成 /3；最後一小節原書只有 3 拍，補一個休止；反覆照 A A B（B 段不反覆）；第二支橫笛（第二遍 A 起）、小鼓、大鼓是我們配的（大鼓第二遍 A 起 p：研究稿寫 mp，跟小鼓同一下打的地方離線錄音會破音）',
    vol: 0.76, abc: ['M:2/4', 'L:1/8', 'Q:1/4=104', 'K:D', 'V:1', 'V:2', 'V:3', 'V:4',
      '% Shaw 1802 原譜 C 拍、D 大調；時值減半 ⇒ 2/4（Willig 約 1805 橫笛版就是這樣記的）。A 段 12 小節 :|: B 段 16 小節 :|',
      '% V:1 橫笛（旋律）、V:2 第二支橫笛（第一遍 A 休息）、V:3 小鼓、V:4 大鼓',
      '% --- A 段第一遍（1–12）：一支橫笛＋鼓（輕）---',
      '[V:1] [I:fife] !mf! d2 f3/2 e/2 | e A d z | f2 a3/2 g/2 | f d f z | d d3/4 d/4 d f | e/2 d/2 e/2 f/2 d A |',
      '[V:2] [I:fife] !mp! z4 | z4 | z4 | z4 | z4 | z4 |',
      '[V:3] [I:snare] !p! C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 |',
      '[V:4] [I:bassdrum] !p! C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 |',
      '[V:1] f f3/4 f/4 f a | g/2 f/2 g/2 a/2 f d | e e3/4 e/4 e a | ^g/2 g/2 f/2 f/2 e/2 e/2 d/2 d/2 | c/3 d/3 e/3 f/3 e/3 d/3 c B | A A3/4 A/4 A z |',
      '[V:2] z4 | z4 | z4 | z4 | z4 | z4 |',
      '[V:3] C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C z |',
      '[V:4] C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 z2 |',
      '% --- A 段第二遍（13–24）：第二支橫笛進來（三度／六度在下面，第 12 小節收在上面的 C♯）---',
      '[V:1] d2 f3/2 e/2 | e A d z | f2 a3/2 g/2 | f d f z | d d3/4 d/4 d f | e/2 d/2 e/2 f/2 d A |',
      '[V:2] A2 d3/2 c/2 | c c A z | d2 f3/2 e/2 | d A d z | A A3/4 A/4 A d | c/2 B/2 c/2 d/2 A F |',
      '[V:3] !mp! C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 |',
      '[V:4] !p! C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 |',
      '[V:1] f f3/4 f/4 f a | g/2 f/2 g/2 a/2 f d | e e3/4 e/4 e a | ^g/2 g/2 f/2 f/2 e/2 e/2 d/2 d/2 | c/3 d/3 e/3 f/3 e/3 d/3 c B | A A3/4 A/4 A z |',
      '[V:2] d d3/4 d/4 d f | e/2 d/2 e/2 f/2 d A | c c3/4 c/4 c e | e/2 e/2 d/2 d/2 c/2 c/2 B/2 B/2 | A/3 B/3 c/3 d/3 c/3 B/3 A ^G | c c3/4 c/4 c z |',
      '[V:3] C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C z |',
      '[V:4] C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 z2 |',
      '% --- B 段（25–40；原譜 13–28）---',
      '[V:1] a3/2 b/4 a/4 g f | f/2 a/2 b/2 f/2 e z | e e3/4 e/4 f f3/4 f/4 | e e3/4 e/4 e f | g3/2 a/4 g/4 f e | f/2 g/2 a/2 f/2 d z | d d3/4 d/4 e e3/4 e/4 | d d3/4 d/4 d z |',
      '[V:2] f3/2 g/4 f/4 e d | d/2 f/2 g/2 d/2 c z | c c3/4 c/4 d d3/4 d/4 | c c3/4 c/4 c d | e3/2 f/4 e/4 d c | d/2 e/2 f/2 d/2 A z | A A3/4 A/4 c c3/4 c/4 | F F3/4 F/4 F z |',
      '[V:3] C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C z | C C/2C/2 C C/2C/2 | C C/2C/2 C z |',
      '[V:4] C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 |',
      '[V:1] d d3/4 d/4 d f | e/2 d/2 e/2 f/2 d A | f f3/4 f/4 f a | g/2 f/2 g/2 a/2 f A | B B3/4 B/4 g c | d3/4 d/4 f3/4 f/4 a z/2 g/2 | f/3 e/3 f/3 g/3 f/3 e/3 d c | d d3/4 d/4 d z |]',
      '[V:2] A A3/4 A/4 A d | c/2 B/2 c/2 d/2 A F | d d3/4 d/4 d f | e/2 d/2 e/2 f/2 d F | G G3/4 G/4 e A | A3/4 A/4 d3/4 d/4 f z/2 e/2 | d/3 c/3 d/3 e/3 d/3 c/3 A G | F F3/4 F/4 F z |]',
      '[V:3] C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C C/2C/2 | C C/2C/2 C z |]',
      '[V:4] C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 C,2 | C,2 z2 |]'] },
  { id: 'granadera', era: 'navy18', name: '擲彈兵進行曲', en: 'Marcha Granadera (Marcha Real)',
    src: '作者不詳（傳統說法：Manuel de Espinosa《Libro de Ordenanza de los toques militares de la Infantería Española》1761 的 La Marcha Granadera；1770 年起當西班牙的榮譽進行曲 —— 這兩點是二手來源）；旋律照 National Anthems, Salutes, and Official Marches as used in H.M. Navy（London: Boosey & Co. 1915）No.41 Spain 的最上聲部（Internet Archive national-anthems-salutes-and-official-marches-as-used-in-h.-m.-navy_202107 第 n37 葉），第 1 小節對過 Wikimedia Commons 的 1761 手抄譜影像（Pífano 1º，G 大調）；改編（TASK-0718）：反覆照 A B C（第一房）C（第二房）D、A B D 各奏一遍；A 段照 1761 的編制給兩支橫笛＋小鼓（第二支橫笛是我們配的六度／三度），B 段起換小號＋法國號（嗡–叭）＋定音鼓；低音、和聲、鼓都是我們照旋律配的（Boosey 的鋼琴伴奏沒有照抄）；C、D 段原書轉 E♭ 大調（三個降記號）⇒ 遊戲的 ABC 不能中途換調，A 都寫成 _A',
    vol: 0.64, abc: ['M:2/4', 'L:1/8', 'Q:1/4=120', 'K:Bb', 'V:1', 'V:2', 'V:3', 'V:4',
      '% Boosey 1915 No.41：B♭ 大調、2/4、♩=120；A 8 小節 :|| B 8 小節 :|| C（轉 E♭：三個降記號）7 小節＋第一房／第二房 :|| D（E♭）8 小節 :||（D 段結在 Fm7 ⇒ 接回 A 的 B♭）',
      '% V:1 旋律（A 橫笛、B 起小號）、V:2 第二支橫笛 ⇒ B 起法國號（低音＋後半拍和弦）、V:3 小鼓、V:4 定音鼓（B♭2／F2，C、D 段 E♭2／B♭2）',
      '% --- A（1–8）：1761 的編制 ＝ 兩支橫笛＋鼓 ---',
      '[V:1] [I:fife] !mf! b2 f2 | d\'2 b f | e d c B | b a g f | b2 c\'2 | d\'3 f | e d c B | f2 z2 |',
      '[V:2] [I:fife] !mp! f2 d2 | b2 f d | c B A F | d c B A | g2 a2 | b3 d | c B A F | c2 z2 |',
      '[V:3] [I:snare] !mp! C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C z |',
      '[V:4] [I:timpani] !mp! z4 | z4 | z4 | z4 | z4 | z4 | z4 | z4 |',
      '% --- B（9–16）：小號＋法國號＋定音鼓 ---',
      '[V:1] [I:trumpet] !mf! f2 d3/2 f/2 | e2 c3/2 e/2 | d2 B3/2 d/2 | c f g a | b2 c\'2 | d\'3/2 e\'/2 f\' e\' | d\'2 c\'2 | b2 z2 |',
      '[V:2] [I:horn] !mp! B,, [F,B,D] F,, [F,B,D] | F,, [F,A,E] C, [F,A,E] | B,, [F,B,D] F,, [F,B,D] | F,, [F,A,C] C, [F,A,C] | B,, [F,B,D] F,, [F,A,C] | B,, [F,B,D] F,, [F,A,E] | B,, [F,B,D] F,, [F,A,C] | B,, [F,B,D] z2 |',
      '[V:3] C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C z |',
      '[V:4] B,,2 F,,2 | F,,2 z2 | B,,2 F,,2 | F,,2 z2 | B,,2 F,,2 | B,,2 F,,2 | B,,2 F,,2 | B,,2 z2 |',
      '% --- C 第一遍（17–24）：原書轉 E♭ 大調（調號三個降記號 ⇒ A 寫成 _A）；第 24 小節 ＝ 第一房（往下走回 C 段開頭）---',
      '[V:1] e2 B2 | g2 e b | _a g f e | e d c B | e2 f2 | g3 b | _a g f e | [db] c B _A |',
      '[V:2] E,, [G,B,E] B,, [G,B,E] | E,, [G,B,E] B,, [G,B,E] | F,, [_A,CF] B,, [F,_A,D] | E,, [G,B,E] B,, [F,B,D] | E,, [G,B,E] B,, [F,_A,D] | E,, [G,B,E] B,, [G,B,E] | F,, [_A,CF] B,, [F,_A,D] | B,, [F,B,D] B,, [F,_A,D] |',
      '[V:3] C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C/2C/2C/2C/2 C/2C/2C/2C/2 |',
      '[V:4] E,,2 B,,2 | E,,2 B,,2 | z2 B,,2 | E,,2 B,,2 | E,,2 B,,2 | E,,2 B,,2 | z2 B,,2 | B,,2 B,,2 |',
      '% --- C 第二遍（25–32）：第 32 小節 ＝ 第二房（停在 B♭，接 D 段的 E♭）---',
      '[V:1] e2 B2 | g2 e b | _a g f e | e d c B | e2 f2 | g3 b | _a g f e | [db]2 z2 |',
      '[V:2] E,, [G,B,E] B,, [G,B,E] | E,, [G,B,E] B,, [G,B,E] | F,, [_A,CF] B,, [F,_A,D] | E,, [G,B,E] B,, [F,B,D] | E,, [G,B,E] B,, [F,_A,D] | E,, [G,B,E] B,, [G,B,E] | F,, [_A,CF] B,, [F,_A,D] | B,, [F,B,D] z2 |',
      '[V:3] C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C z |',
      '[V:4] E,,2 B,,2 | E,,2 B,,2 | z2 B,,2 | E,,2 B,,2 | E,,2 B,,2 | E,,2 B,,2 | z2 B,,2 | B,,2 z2 |',
      '% --- D（33–40）：還是 E♭ 大調（原書這一行的調號也是三個降記號）；結在 Fm7（E♭ C A♭ F，照原書）⇒ 接回 A 的 B♭ ---',
      '[V:1] b2 g3/2 b/2 | _a2 f3/2 a/2 | g2 e3/2 g/2 | f B c d | e2 f2 | g3/2 _a/2 b a | g2 f2 | e2 z2 |]',
      '[V:2] E,, [G,B,E] B,, [G,B,E] | B,, [F,_A,D] F,, [F,_A,D] | E,, [G,B,E] B,, [G,B,E] | B,, [F,B,D] F,, [F,B,D] | _A,, [_A,CE] B,, [F,_A,D] | E,, [G,B,E] B,, [F,_A,D] | E,, [G,B,E] B,, [F,_A,D] | F,, [_A,CE] z2 |]',
      '[V:3] C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C C/2C/2 C C | C/2C/2C/2C/2 C/2C/2 C |]',
      '[V:4] E,,2 B,,2 | B,,2 z2 | E,,2 B,,2 | B,,2 F,,2 | z2 B,,2 | E,,2 B,,2 | E,,2 B,,2 | F,,2 z2 |]'] },
  // 1850 年代（拿破崙號、光榮號、1853 黑船）
  { id: 'syrie', era: 'steam1850', name: '出征敘利亞', en: 'Partant pour la Syrie',
    src: 'Hortense de Beauharnais 約 1807（詞 A. de Laborde）；旋律照 Ditson 版 The Departure for Syria（Boston 約 1855，Internet Archive gml-us1850s-34-horte-depar 第 3–4 頁人聲），對過 M. Holst 變奏曲主題（London 1825，favoriteairparta00hols 第 3 頁）；改編（TASK-0718）：前面加一小節小鼓＋低音當前奏，迴音記號與第 12 小節的倚音省略，法國號低音＋後半拍和弦、小鼓是照旋律配的',
    vol: 0.83, abc: ['M:4/4', 'L:1/8', 'Q:1/4=104', 'K:Eb', 'V:1', 'V:2', 'V:3',
      '% 第 0 小節：前奏（鼓＋低音一小節，旋律只有最後一個十六分的弱起 B）；1–16 ＝ 原曲一段（Ditson 1855 第 3 頁第 2 行起）',
      '[V:1] [I:brass] !mf! z4 z3 z/2 B/2 | B3 B c2 d2 | e3 f d2 z B | e2 B2 G2 B2 | F4 z2 B2 | =A3 A B3 c | d3 c B2 z B | c2 G2 =A3 c | B4 z2 B2 |',
      '[V:2] [I:horn] !mp! E,,2 [G,B,E] z B,,,2 [G,B,E] z | E,,2 [G,B,E] z B,,,2 [F,B,D] z | E,,2 [G,B,E] z B,,,2 [F,A,D] z | E,,2 [G,B,E] z B,,,2 [G,B,E] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | F,,2 [=A,CE] z B,,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | C,,2 [G,CE] z F,,2 [=A,CE] z | B,,,2 [F,B,D] z F,,2 [F,A,D] z |',
      '[V:3] [I:snare] !mf! C2 C/2C/2C C2 C/2C/2C/2C/2 | !mp! C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C/2C/2C/2C/2 C C |',
      '% 9–16（Ditson 第 3 頁第 4 行起、第 4 頁第 1 行）',
      '[V:1] A2 B2 G2 B2 | A3 G F2 B2 | A2 B2 G2 c3/2 B/2 | F4 z2 B A | G3 A B c d e | f3 d B2 z B | e3 e d2 e3/2 f/2 | e2 z2 z4 |]',
      '[V:2] B,,,2 [F,A,D] z E,,2 [G,B,E] z | A,,2 [A,CE] z B,,,2 [F,B,D] z | B,,,2 [F,A,D] z E,, [G,B,E] F,, [A,CE] | B,,,2 [F,B,D] z F,,2 [F,A,D] z | E,,2 [G,B,E] z B,,,2 [G,B,E] z | B,,,2 [F,B,D] z F,,2 [F,A,D] z | A,,2 [A,CE] z B,,,2 [F,A,D] z | E,,2 [G,B,E]2 z4 |]',
      '[V:3] C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C/2C/2C/2C/2 C C | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | C C/2C/2 C z C C/2C/2 C z | !mf! C2 z2 z4 |]'] },
  { id: 'sakura', era: 'steam1850', name: '櫻花', en: 'Sakura Sakura',
    src: '江戶時代箏曲歌謠（作者不詳）；照文部省音樂取調掛《箏曲集》（1888）No.2「櫻」：1–14 小節歌唱那一行、15–18 小節箏的尾奏（國立國會圖書館 pid 857651 第 22–23 影像），對過 Dittrich《Nippon Gakufu》（1894）No.3；改編（TASK-0718）：全給箏，第二部箏（弱）用平調子的空弦配長音',
    vol: 0.77, abc: ['M:4/4', 'L:1/4', 'Q:1/4=76', 'K:Am', 'V:1', 'V:2',
      '% 1888《箏曲集》No.2：都節音階（E F A B C）、沒有升降記號；1–14 ＝ 歌唱那一行，15–18 ＝ 箏的尾奏',
      '[V:1] [I:koto] !mf! A A B2 | A A B2 | A B c B | A B/2A/2 F2 | E C E F | E E/2C/2 B,2 | A B c B | A B/2A/2 F2 | E C E F |',
      '[V:2] [I:koto] !p! E,2 [A,E]2 | E,2 [A,E]2 | A,2 [E,A,]2 | A,2 [E,B,]2 | [E,B,]2 A,2 | A,2 E,2 | A,2 [E,A,]2 | A,2 [E,B,]2 | [E,B,]2 A,2 |',
      '[V:1] E E/2C/2 B,2 | A A B2 | A A B2 | z E F2 | B/2A/2 F E2 |',
      '[V:2] A,2 E,2 | E,2 [A,E]2 | E,2 [A,E]2 | A,2 [E,B,]2 | B,2 [E,B,]2 |',
      '% 尾奏（1888 原書箏的那一行）',
      '[V:1] [EF] e [EF] e | [EF]/2 [EF]/2 e/2 c/2 B A | B B/2A/2 F2 | [E,E]2 z2 |]',
      '[V:2] E,4 | A,4 | B,2 [E,B,]2 | z4 |]'] },
  // 1862 南北戰爭（漢普頓錨地）
  { id: 'battlehymn', era: 'civilwar', name: '共和國戰歌', en: 'Battle Hymn of the Republic',
    src: "Julia Ward Howe 詞（寫給 Atlantic Monthly，1862）；曲是當時的營歌「Glory, Hallelujah」（John Brown's Body；原版沒寫作曲者）；旋律照 Boston: Oliver Ditson & Co. 1862 原版逐音讀（plate 21454；美國國會圖書館 Music Division 藏本，Wikimedia Commons「Battle Hymn of the Republic (1862) 1–4.jpg」，第 3 頁主歌、第 4 頁 Chorus 的人聲那一行，降 B 大調 4/4）；改編（TASK-0718）：原版 3 小節鋼琴前奏沒用，改成一小節鼓（旋律只有最後半拍的弱起 Mine）；主歌銅管吹原調，副歌加橫笛高八度；法國號「嗡–叭」照原版鋼琴每小節的和聲（I／IV／IV–V7）；小鼓、大鼓是配的；原版副歌結尾的反覆記號沒照做（每一遍主歌＋副歌各一次）",
    vol: 0.62, abc: ['M:4/4', 'L:1/8', 'Q:1/4=100', 'K:Bb', 'V:1', 'V:2', 'V:3', 'V:4', 'V:5',
      '% Ditson 1862：降 B 大調、C 拍號；第 0 小節 ＝ 鼓的前奏＋弱起「Mine」，1–8 ＝ 主歌 Mine eyes have seen the glory（第 3 頁），9–16 ＝ Chorus Glory, glory, hallelujah（第 4 頁）',
      '% 和聲（照原版鋼琴左手每小節的根音）：主歌、副歌都是 I I IV I | I I IV–V7 I',
      '% --- 主歌（銅管原調＋法國號嗡–叭、鼓輕）---',
      '[V:1] [I:brass] !mf! z4 z2 z F | F F F3/2 E/2 D3/2 F/2 B3/2 c/2 | d3/2 d/2 d3/2 c/2 B2 z B/2 B/2 | G3/2 G/2 G3/2 A/2 B3/2 B/2 A3/2 G/2 | F3/2 G/2 F3/2 D/2 F2 z F/2 F/2 | F3/2 F/2 F3/2 E/2 D3/2 F/2 B3/2 c/2 | d3/2 d/2 d3/2 c/2 B2 z B | c2- c3/2 c/2 B2 A2 | B4 z4 |',
      '[V:2] [I:fife] z8 | z8 | z8 | z8 | z8 | z8 | z8 | z8 | z8 |',
      '[V:3] [I:horn] !mp! z8 | B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | E,,2 [G,B,E] z B,,,2 [G,B,E] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | E,,2 [G,CE] z F,,2 [F,A,E] z | B,,,2 [F,B,D] z F,,2 [F,A,E] z |',
      '[V:4] [I:snare] !mf! C2 C/2C/2C C/2C/2C C/2C/2C | !mp! C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C/2C/2C C/2C/2C/2C/2 C C |',
      '[V:5] [I:bassdrum] !mp! C,2 z2 C,2 z2 | C,2 z6 | C,2 z6 | C,2 z6 | C,2 z6 | C,2 z6 | C,2 z6 | C,2 z6 | C,2 z6 |',
      '% --- Chorus：Glory, glory, hallelujah（橫笛高八度加進來）---',
      '[V:1] !f! F3 E D3/2 F/2 B3/2 c/2 | d4 B2 z2 | G3/2 G/2 G3/2 A/2 B3/2 B/2 A3/2 G/2 | F2 D2 F4 | F3 E D3/2 F/2 B3/2 c/2 | d4 B2 z B | c2 c2 B2 A2 | B4 z4 |]',
      "[V:2] !mf! f3 e d3/2 f/2 b3/2 c'/2 | d'4 b2 z2 | g3/2 g/2 g3/2 a/2 b3/2 b/2 a3/2 g/2 | f2 d2 f4 | f3 e d3/2 f/2 b3/2 c'/2 | d'4 b2 z b | c'2 c'2 b2 a2 | b4 z4 |]",
      '[V:3] !mf! B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | E,,2 [G,B,E] z B,,,2 [G,B,E] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | B,,,2 [F,B,D] z F,,2 [F,B,D] z | E,,2 [G,CE] z F,,2 [F,A,E] z | B,,,2 [F,B,D] z z4 |]',
      '[V:4] !mf! C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C2 C/2C/2C C/2C/2C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C2 C/2C/2C C2 z2 |]',
      '[V:5] !mf! C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 z4 |]'] },
  { id: 'battlecry', era: 'civilwar', name: '自由的戰鬥吶喊', en: 'The Battle Cry of Freedom',
    src: "George F. Root 詞曲（Chicago: Root & Cady 1862，plate 225）；旋律照 Root & Cady 1862 原版逐音讀（Gaylord Music Library, Washington University in St. Louis 藏，Internet Archive b94194191，第 3–5 頁的人聲／Air 那一行，降 B 大調 4/4）；改編（TASK-0718）：原版 4 小節鋼琴前奏沒用，改成一小節鼓（旋律只有最後一拍的弱起 Yes we'll）；橫笛整段高八度，副歌（原版標 Fortissimo）加銅管吹原調；低音照原版鋼琴左手每一拍的和弦根音、改成根音—五度（法國號）；小鼓、大鼓是配的；最後一小節原版只有 3 拍（弱起 1 拍），補一拍休止",
    vol: 0.53, abc: ['M:4/4', 'L:1/8', 'Q:1/4=112', 'K:Bb', 'V:1', 'V:2', 'V:3', 'V:4', 'V:5',
      "% Root & Cady 1862：降 B 大調、C 拍號；第 0 小節 ＝ 鼓的前奏＋弱起「Yes we'll」，1–8 ＝ 主歌（第 3、4 頁），9–16 ＝ 副歌 The Union forever（第 4、5 頁）",
      '% 旋律原調 ＝ 橫笛那一行低八度（副歌銅管那一行就是原調）：主歌 B c | d d d3/2 c/2 B2 G3/2 A/2 | B B B3/2 A/2 G4 | F2 F3/2 E/2 D F B3/2 c/2 | d4 c2 B c | …；第 3 小節的「of」原版第 3 頁是 c（第 4、5 頁同一句是 d），照原版',
      '% 和聲（照原版鋼琴左手）：rally round the flag ＝ I I vi vi；rally once again ＝ Gm/D D7 E♭ E♭；shouting the battle cry of ＝ I I I I/D；Freedom ＝ I⁶₄ I⁶₄ V7（半終止）／V7 V7 I',
      '% --- 主歌（橫笛高八度＋法國號低音、鼓輕）---',
      "[V:1] [I:fife] !mf! z4 z2 b c' | d' d' d'3/2 c'/2 b2 g3/2 a/2 | b b b3/2 a/2 g4 | f2 f3/2 e/2 d f b3/2 c'/2 | d'4 c'2 b c' | d' d' d'3/2 c'/2 b2 g3/2 a/2 | b b b3/2 a/2 g4 | f2 f3/2 e/2 d f b3/2 d'/2 | c'4 b2 z f' |",
      '[V:2] [I:brass] z8 | z8 | z8 | z8 | z8 | z8 | z8 | z8 | !f! z6 z f |',
      '[V:3] [I:horn] !mp! z8 | B,,2 F,,2 G,,2 D,,2 | D,2 D,,2 E,2 B,,2 | B,,2 F,,2 B,,2 D,2 | F,,2 C,2 F,,2 z2 | B,,2 F,,2 G,,2 D,,2 | D,2 D,,2 E,2 B,,2 | B,,2 F,,2 B,,2 D,2 | F,2 C,2 B,,2 z2 |',
      '[V:4] [I:snare] !mf! C2 C/2C/2C C/2C/2C C/2C/2C | !mp! C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C/2C/2C C/2C/2C/2C/2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C C C2 C C | C2 C/2C/2C C/2C/2C/2C/2 C C |',
      '[V:5] [I:bassdrum] !mf! C,2 z2 C,2 z2 | !mp! C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 |',
      '% --- 副歌 The Union forever（原版標 Fortissimo：銅管加進來吹原調）---',
      "[V:1] !f! f'2 d'3/2 e'/2 f' g'2 f' | f'2 d'3/2 e'/2 f'4 | f'2 d'3/2 e'/2 f' g'3 | f'2 d'3/2 b/2 c'2 b c' | d' d' d'3/2 c'/2 b2 g2 | b b b3/2 a/2 g4 | f2 f3/2 e/2 d f b3/2 d'/2 | c'4 b2 z2 |]",
      '[V:2] f2 d3/2 e/2 f g2 f | f2 d3/2 e/2 f4 | f2 d3/2 e/2 f g3 | f2 d3/2 B/2 c2 B c | d d d3/2 c/2 B2 G2 | B B B3/2 A/2 G4 | F2 F3/2 E/2 D F B3/2 d/2 | c4 B2 z2 |]',
      '[V:3] !f! B,,2 F,,2 B,,2 F,,2 | B,,2 F,,2 B,,4 | B,,2 F,,2 B,,2 F,,2 | B,,2 G,,2 F,, E,, D,, C,, | B,,2 F,,2 G,,2 D,,2 | D,2 D,,2 E,2 B,,2 | B,,2 F,,2 B,,2 D,2 | F,2 C,2 B,,2 z2 |]',
      '[V:4] !mf! C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C2 C/2C/2C C/2C/2C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C C/2C/2 C C C C/2C/2 C C | C2 C2 C2 z2 |]',
      '[V:5] !mf! C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 | C,2 z2 C,2 z2 |]'] },
  // 傳說（幽靈船）
  { id: 'dutchman', era: 'legend', name: '漂泊的荷蘭人', en: 'Der fliegende Holländer — Ouvertüre', src: 'Wagner《漂泊的荷蘭人》Der fliegende Holländer（1843 德勒斯登首演；Meser 1844 出版）序曲第 2–14 小節；譜對過 Wiener Philharmonischer Verlag 總譜 No.20（Internet Archive overturetoflying00wagn）與 Boosey 1880 鋼琴縮譜（derfliegendeholl1880wagn），法國號、低音號、大提琴逐音比過。改編（TASK-0718）：原曲第 1 小節不要（兩小節空五度剩一小節，第二遍起由上一遍最後一小節接上）；弦樂震音寫成 D5／A4 交替的八分；法國號的倚音 B♭ 寫成十六分（從後面的 A 扣）；木管撐住的空五度併成管風琴 D3＋A3；長號＋低音號只寫低音號那一行；第 12–13 小節（原曲 13–14）的減七和弦 C♯–E–G–B♭ 照原曲、各聲部怎麼分是我們排的；第 14 小節照原曲第 15 小節的動作（重音一下、弦樂半音往上衝、定音鼓 A 滾奏），音是我們寫的；第 15 小節回到 D 是我們加的；力度照原曲 f → p → molto cresc. → ff 分段寫成 mp／mf／f',
    vol: 0.54, abc: ['M:6/4', 'L:1/8', 'Q:1/2=72', 'K:Dm', 'V:1', 'V:2', 'V:3', 'V:4', 'V:5', 'V:6',
      '% 6/4、𝅗𝅥＝72（原曲 Allegro con brio）；L:1/8 ⇒ 一小節 12。原曲第 1 小節（兩小節空五度的第一小節）不要 ⇒ 第二遍起由上一遍最後一小節的 D 接上，聽起來還是兩小節',
      '% V:1 法國號（荷蘭人動機，實際音高）、V:2 長號＋低音號、V:3 弦樂震音（八分寫出來）、V:4 管風琴（木管撐住的空五度）、V:5 大提琴（半音兩個一組往上爬）、V:6 定音鼓（長音 ＝ 滾奏）',
      '% --- 第 1–5 小節（原曲 2–6）：空五度 D–A，法國號吹荷蘭人動機 ---',
      '[V:1] [I:horn] !f! z10 A,2 | D6 D4 A,2 | D4 D2 A6- | A4 D2 D4 D2 | A6 B/2A11/2 |',
      '[V:2] [I:brass] !f! z12 | z12 | z12 | z12 | z12 |',
      '[V:3] [I:fiddle] !mf! dAdAdAdAdAdA | !p! dAdAdAdAdAdA | dAdAdAdAdAdA | dAdAdAdAdAdA | dAdAdAdAdAdA |',
      '[V:4] [I:organ] !mf! [D,A,]12 | !p! [D,A,]12- | [D,A,]12- | [D,A,]12- | [D,A,]12 |',
      '[V:5] [I:fiddle] z12 | z12 | z12 | z12 | !p! D,,D,,^D,,^D,,E,,E,,F,,F,,^F,,^F,,G,,G,, |',
      '[V:6] [I:timpani] z12 | z12 | z12 | z12 | !p! A,,12 |',
      '% --- 第 6–11 小節（原曲 7–12）：法國號在 A 上一直喊（倚音 B♭ 寫成十六分）、大提琴爬兩輪、長號＋低音號接動機 ---',
      '[V:1] B/2A11/2 B/2A11/2 | B/2A11/2 B/2A11/2 | B/2A11/2 B/2A11/2 | B/2A11/2 B/2A11/2 | B/2A11/2 B/2A11/2 | B/2A11/2 B/2A11/2 |',
      '[V:2] z12 | z12 | z10 A,,2 | D,6 D,4 A,,2 | D,4 D,2 A,6- | A,4 D,2 D,4 D,2 |',
      '[V:3] !mp! dAdAdAdAdAdA | dAdAdAdAdAdA | !mf! dAdAdAdAdAdA | dAdAdAdAdAdA | !f! dAdAdAdAdAdA | dAdAdAdAdAdA |',
      '[V:4] !mp! [D,A,]12- | [D,A,]12 | !mf! [D,A,]12- | [D,A,]12 | !f! [D,A,]12- | [D,A,]12 |',
      '[V:5] !mp! ^G,,^G,,A,,A,,B,,B,,=B,,=B,,C,C,^C,^C, | D,D,^D,^D,E,E,F,F,^F,^F,G,G, | !mf! ^G,^G,A,A,B,B,=B,=B,CC^C^C | D,D,^D,^D,E,E,F,F,^F,^F,G,G, | !f! ^G,^G,A,A,B,B,=B,=B,CC^C^C | DD^D^DEEFF^F^FGG |',
      '[V:6] !mp! D,12 | D,12 | !mf! D,12 | D,12 | !f! D,12 | D,12 |',
      '% --- 第 12–13 小節（原曲 13–14）：減七和弦 C♯–E–G–B♭ ff；第 14 小節：重音一下、弦樂半音往上衝、定音鼓 A 滾奏（原曲 15 的動作）；第 15 小節：回到 D（我們加的）---',
      '[V:1] [EB]12- | [EB]12 | [EB]2 z8 A,2 | D12 |]',
      '[V:2] [^C,G,]12- | [^C,G,]12 | [^C,G,]2 z10 | [D,A,]12 |]',
      '[V:3] ^cG^cG^cG^cG^cG^cG | ^cG^cG^cG^cG^cG^cG | ^c2 z4 ^GA^A=B=c^c | dAdAdAdAdAdA |]',
      '[V:4] [^CEGB]12- | [^CEGB]12 | [^CEGB]2 z10 | [D,A,]12 |]',
      '[V:5] ^C,,^C,^C,,^C,^C,,^C,^C,,^C,^C,,^C,^C,,^C, | ^C,,^C,^C,,^C,^C,,^C,^C,,^C,^C,,^C,^C,,^C, | ^C,2 E,,F,,^F,,G,,^G,,A,,^A,,=B,,=C,^C, | D,12 |]',
      '[V:6] A,,2 z10 | z12 | A,,12 | D,12 |]'] }
];
var BGM_ERAS = [['eastroman', '東羅馬帝國'], ['spain', '十七世紀西班牙'], ['louis', '路易十四的法蘭西'], ['navy18', '十八世紀海軍'],   // 年代篇（TASK-0718）：TUNES 的 era ⇒ 聲音設定頁那一列的標題，照這個順序（年代先後）列；沒寫 era 的（四首船歌）排在最前面那一列
  ['steam1850', '1850 年代'], ['civilwar', '1862 南北戰爭'], ['legend', '傳說']];
// 船的主題曲（TASK-0681；Tim 2026-10-17「船隻的主題曲 當操作船隻有主題曲時背景音樂改播放主題曲」）：game.json ships[].theme ＝ 這裡的 id（admin.py 匯入時對過）。
//   abc ＝ 整份 ABC（一行一個字串：檔頭 M／L／Q／K／V、% 註解、[V:1] 開頭的聲部行）—— 寫法見 src/README「背景音樂的樂譜」；樂器用 [I:樂器] 在聲部裡換（INSTR）。
var THEMES = [
  { id: 'stormkaap', name: '風暴角號主題曲', en: 'Stormkaap', src: 'Tim 提供（2026-10-17，TASK-0681；前段音樂盒、後段管風琴）',
    abc: ['M:3/4', 'L:1/4', 'Q:1/4=84', 'K:Dm', 'V:1 clef=treble', 'V:2 clef=bass',
      '% --- Part 1: Music Box ---',
      '[V:1] [I:musicbox] d2 A | F G A | d2 A | F E F | d2 A | F G A | B A G | F E2 | D3 |',
      '[V:2] [I:musicbox] D,,3 | z3    | D,,3 | A,,3  | D,,3 | G,,3  | B,,3  | A,,3  | D,,3 |',
      '% --- Part 2: Waltz（管風琴；最後一小節漸慢、弱奏：Tim 先給的那份寫的）---',
      "[V:1] [I:organ] A d e | f2 e/2d/2 | ^c3 | A ^c d | e2 d | d3 | f g a | d'2 c'/2b/2 | b a g | f3 | e f g | ^c3 | !p! !rit! d3 |]",
      '[V:2] [I:organ] D, [F,A,] [F,A,] | D, [F,A,] [F,A,] | A,, [E,G,] [E,G,] | A,, [E,G,] [E,G,] | A,, [E,G,] [E,G,] | D, [F,A,] [F,A,] | F, [A,C] [A,C] | B,, [D,F,] [D,F,] | G,, [D,G,] [D,G,] | D, [F,A,] [F,A,] | G,, [D,G,] [D,G,] | A,, [E,A,] [E,A,] | !p! !rit! [D,F,A,D]3 |]'] },
  { id: 'nightlamp', name: '夜燈號主題曲', en: 'Nightlamp', src: 'Tim 提供旋律（2026-10-17 簡譜，TASK-0684）；低音、Part B 低八度的手風琴是 summit 照旋律配的',
    abc: ['M:6/8', 'L:1/8', 'Q:3/8=70', 'K:Am', 'V:1', 'V:2', 'V:3',
      '% 簡譜 1＝C（沒標調）：6 ＝ A4、1· ＝ C5（上加點高八度）、#5 ＝ G#4；一個字 ＝ 八分、- 延長八分、6_6_ ＝ 兩個十六分',
      '% --- Part A：前奏交鋒（弱起 6_6_）---',
      '[V:1] [I:fiddle] !mp! A/2A/2 | B2 c c3 | c2 d B3 | B2 A ^G3 | A5 A/2A/2 | B2 c d3 | d2 e f3 | f2 e d3 | c2 d e3 | A2 B c3 | c2 d B3 | B2 A ^G3 | A5 E |',
      '[V:2] [I:pluck] !mp! z | A,,3 E,3 | E,,3 B,,3 | E,,3 B,,3 | A,,3 E,3 | G,,3 D,3 | D,,3 A,,3 | D,,3 A,,3 | C,3 G,,3 | A,,3 E,3 | E,,3 B,,3 | E,,3 B,,3 | A,,3 E,3 |',
      '[V:3] [I:accordion] z | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 |',
      '% --- Part B：海盜狂想大主題（手風琴低八度跟著旋律）---',
      '[V:1] !mf! A2 A B2 c | d2 d e2 f | e2 c A2 c | B2 A B2 E | A2 A B2 c | d2 d e2 f | e2 c B2 A | A6 |]',
      '[V:2] !mf! A,,3 E,3 | D,,3 A,,3 | A,,3 E,3 | E,,3 B,,3 | A,,3 E,3 | D,,3 A,,3 | A,,3 E,,3 | A,,6 |]',
      '[V:3] !mp! A,2 A, B,2 C | D2 D E2 F | E2 C A,2 C | B,2 A, B,2 E, | A,2 A, B,2 C | D2 D E2 F | E2 C B,2 A, | A,6 |]'] }
];
var ABC_KEYS = { C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Ab: -4,   // 調 ⇒ 升降記號數（正 ＝ 升）；小調照關係大調
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, Dm: -1, Gm: -2, Cm: -3, Fm: -4 };
var ABC_DYN = { pp: 0.4, p: 0.6, mp: 0.8, mf: 1, f: 1.2 };            // !p! 之類的力度記號：從那個音起、那個聲部的音量倍數
var BGM_RIT = 0.6;                                                     // !rit!：從那個音到那一小節結束，速度線性慢到原本的幾成
/** 一行 ABC 子集 ⇒ { notes: [[起點拍, 長度拍, MIDI 音高, 樂器（null ＝ 照聲部）, 力度]], len 總長, rits [[起, 迄]] }（拍 ＝ 四分音符）。認不得的字 ⇒ 丟錯（寫錯的譜不要靜靜地少一個音）。
 *  U ＝ 單位長度幾拍（L:1/8 ⇒ 0.5，四首船歌；L:1/4 ⇒ 1）；bar ＝ 一小節幾拍（給了 ⇒ 每一小節都要剛好，對不上 ⇒ 丟錯、說第幾小節）。 */
function abcParse(s, K, U, bar) {
  var sf = ABC_KEYS[K], key = {}, carry = {}, out = [], t = 0, i = 0, ties = [], inst = null, vel = 1, rits = [], rit = null, b0 = 0, nb = 0, BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  if (sf === undefined) throw new Error('abcParse：不認得的調 ' + K);
  U = U || 0.5;
  'FCGDAEB'.split('').forEach(function (c, k) { if (sf > k) key[c] = 1; if (-sf > 6 - k) key[c] = -1; });
  function dur() {                                                     // 時值：n、/、/d、n/d（幾個單位）
    var m = /^(\d*)(\/(\d*))?/.exec(s.slice(i)); i += m[0].length;
    var n = m[1] ? +m[1] : 1, d = m[2] ? (m[3] ? +m[3] : 2) : 1; return n / d;
  }
  function pitch() {                                                   // ^_= 音名 ',
    var c = s[i], acc = null;
    if (c === '^' || c === '_' || c === '=') { acc = c === '^' ? 1 : c === '_' ? -1 : 0; i++; c = s[i]; }
    var up = (c || '').toUpperCase(); if (!(up in BASE)) throw new Error('abcParse：第 ' + i + ' 個字「' + c + '」不認得');
    var o = c === up ? 0 : 1; i++;
    while (s[i] === "'" || s[i] === ',') { o += s[i] === "'" ? 1 : -1; i++; }
    var k = up + o; if (acc !== null) carry[k] = acc;
    return 60 + 12 * o + BASE[up] + (k in carry ? carry[k] : (key[up] || 0));
  }
  function put(p, d) {                                                 // 一個音（連音線接上前一個同音高、剛好在這裡結束的那個）
    for (var q = 0; q < ties.length; q++) if (ties[q][2] === p && Math.abs(ties[q][0] + ties[q][1] - t) < 1e-9) { ties[q][1] += d; return ties[q]; }
    var n = [t, d, p, inst, vel]; out.push(n); return n;
  }
  function barEnd() {                                                  // 第一小節可以比較短（弱起，例如夜燈號的 6_6_）；其他小節拍數要剛好
    carry = {}; nb++;
    if (rit) { rit[1] = t; rits.push(rit); rit = null; }
    if (bar && Math.abs(t - b0 - bar) > 1e-9 && !(nb === 1 && t - b0 < bar)) throw new Error('abcParse：第 ' + nb + ' 小節 ' + (t - b0) + ' 拍（拍號是 ' + bar + ' 拍）');
    b0 = t;
  }
  while (i < s.length) {
    var c = s[i];
    if (c === ' ') { i++; continue; }
    if (c === '|') { barEnd(); i++; if (s[i] === ']' || s[i] === '|') i++; continue; }   // | 、|| 、|]
    if (c === '!') {                                                   // !p! !rit! 之類的記號
      var e = s.indexOf('!', i + 1); if (e < 0) throw new Error('abcParse：! 沒有收尾');
      var dn = s.slice(i + 1, e); i = e + 1;
      if (dn === 'rit') rit = [t, null]; else if (dn in ABC_DYN) vel = ABC_DYN[dn]; else throw new Error('abcParse：不認得的記號 !' + dn + '!');
      continue;
    }
    if (c === '[' && /^\[[A-Za-z]:/.test(s.slice(i, i + 3))) {         // 欄位：[M:3/4] 只給人讀、[I:樂器] 換樂器
      var e2 = s.indexOf(']', i); if (e2 < 0) throw new Error('abcParse：[ 沒有收尾');
      var fd = s.slice(i + 1, e2); i = e2 + 1;
      if (fd[0] === 'I') { inst = fd.slice(2).trim(); if (!INSTR[inst]) throw new Error('abcParse：沒有這種樂器 ' + inst + '（' + Object.keys(INSTR).join('、') + '）'); }
      else if (fd[0] !== 'M') throw new Error('abcParse：不認得的欄位 [' + fd + ']');
      continue;
    }
    if (c === 'z') { i++; t += dur() * U; ties = []; continue; }
    var made = [], adv;
    if (c === '[') {                                                   // 和弦 [A,CE]2：裡面每個音一起起，長度 ＝ 自己的 × 外面的；前進照第一個音
      i++; var ch = [];
      while (s[i] !== ']') { if (i >= s.length) throw new Error('abcParse：和弦沒有收尾'); if (s[i] === ' ') { i++; continue; } var pp = pitch(); ch.push([pp, dur()]); }
      i++; var mul = dur();
      if (!ch.length) throw new Error('abcParse：空的和弦');
      ch.forEach(function (q) { made.push(put(q[0], q[1] * mul * U)); }); adv = ch[0][1] * mul * U;
    } else { var p1 = pitch(), d1 = dur() * U; made.push(put(p1, d1)); adv = d1; }
    t += adv;
    if (s[i] === '-') { i++; ties = made; } else ties = [];
  }
  if (rit) { rit[1] = t; rits.push(rit); }
  return { notes: out, len: t, rits: rits };
}
/** 整份 ABC（THEMES 的 abc：一行一個字串）⇒ 每個聲部一份 abcParse 的結果（照 V: 出現的順序；第一個 ＝ 旋律）；Q 照檔頭寫回 tn.Q（每分鐘幾個四分音符）。 */
function abcTune(tn) {
  var H = { L: '1/8', K: 'C', M: '', Q: '' }, V = {}, order = [], cur = null;
  function voice(id) { if (!(id in V)) { V[id] = ''; order.push(id); } cur = id; }
  tn.abc.forEach(function (ln) {
    ln = ln.replace(/%.*$/, '').trim(); if (!ln) return;
    var h = /^([A-Za-z]):\s*(.*)$/.exec(ln), m = /^\[V:\s*([^\]\s]+)\]\s*(.*)$/.exec(ln);
    if (h) { if (h[1] === 'V') voice(h[2].split(/\s+/)[0]); else H[h[1]] = h[2].trim(); return; }
    if (m) { voice(m[1]); ln = m[2]; } else if (cur === null) voice('1');
    V[cur] += ' ' + ln;
  });
  function frac(x, what) { var m = /^(\d+)\/(\d+)$/.exec(x); if (!m) throw new Error('樂譜 ' + tn.id + '：' + what + ' 要寫成 a/b（' + x + '）'); return 4 * m[1] / m[2]; }
  var U = frac(H.L, 'L:'), bar = H.M ? frac(H.M, 'M:') : 0, q = /^(?:(\d+\/\d+)=)?(\d+(?:\.\d+)?)$/.exec(H.Q);
  if (!q) throw new Error('樂譜 ' + tn.id + '：Q: 要寫成 1/4=84（' + H.Q + '）');
  tn.Q = +q[2] * (q[1] ? frac(q[1], 'Q:') : 1);
  if (!order.length) throw new Error('樂譜 ' + tn.id + '：沒有音符');
  return order.map(function (id) { return abcParse(V[id], H.K, U, bar); });
}
/** 拍 ⇒ 拉長後的拍（!rit! 那幾段：速度從 1 線性慢到 BGM_RIT ⇒ ∫ 1／速度）。 */
function bgmWarp(rits, x) {
  var y = x, k = 1 - BGM_RIT;
  rits.forEach(function (r) { var L = r[1] - r[0], u = Math.min(x, r[1]) - r[0]; if (u > 0 && L > 0) y += -L / k * Math.log(1 - k * u / L) - u; });
  return y;
}
// 每首可以寫 inst（[旋律, 伴奏] 的樂器，TASK-0681 配器）、vol（整首的音量倍數：配器換了之後 A 加權響度跟別首對齊用）。
var BGM_INST = ['fiddle', 'accordion'];                                // 沒寫 [I:] 的聲部：照那一首的 inst（[旋律, 伴奏]）；沒寫 inst ⇒ 第一個（旋律）提琴、其他手風琴（TASK-0677 第一版四首就是這樣）
/** 一首 ⇒ 排好的事件（各聲部合在一起照時間排）：[[拍, 長度拍, 音高, 聲部 0 旋律／1… 伴奏, 樂器, 力度]]、一遍幾拍。快取在 tune.ev。 */
function tuneEvents(tn) {
  if (tn.ev) return tn.ev;
  var P = tn.abc ? abcTune(tn) : [abcParse(tn.mel, tn.K), abcParse(tn.bass, tn.K)], ev = [], rits = [], seen = {};
  P.forEach(function (v, k) { if (Math.abs(v.len - P[0].len) > 1e-9) throw new Error('樂譜 ' + tn.id + '：第 1 聲部 ' + P[0].len + ' 拍、第 ' + (k + 1) + ' 聲部 ' + v.len + ' 拍，長度不一樣'); });
  var IN = tn.inst || BGM_INST;
  P.forEach(function (v, k) { v.notes.forEach(function (n) { ev.push([n[0], n[1], n[2], k, n[3] || IN[Math.min(k, IN.length - 1)], n[4]]); }); });
  ev.sort(function (x, y) { return x[0] - y[0] || x[3] - y[3]; });
  P.forEach(function (v) { v.rits.forEach(function (r) { if (!seen[r]) { seen[r] = 1; rits.push(r); } }); });   // 兩個聲部同一段 !rit! 只算一次
  rits.sort(function (a, b) { return a[0] - b[0]; });
  rits.forEach(function (r, k) { if (k && r[0] < rits[k - 1][1]) throw new Error('樂譜 ' + tn.id + '：兩段 !rit! 疊在一起（' + rits[k - 1] + '／' + r + '）'); });
  var len = P[0].len;
  if (rits.length) { ev.forEach(function (e) { var a = bgmWarp(rits, e[0]); e[1] = bgmWarp(rits, e[0] + e[1]) - a; e[0] = a; }); len = bgmWarp(rits, len); }
  return (tn.ev = { ev: ev, len: len });
}
/** 這一首奏幾遍：一遍的秒數 ⇒ 湊到約 BGM_TUNE_S 秒，夾在 2–6。 */
function bgmPasses(tn) { var E = tuneEvents(tn); return clamp(Math.round(BGM_TUNE_S / (E.len * 60 / tn.Q)), 2, 6); }
function bgmRand() { BGM_SEED = (Math.imul(BGM_SEED, 1103515245) + 12345) & 0x7fffffff; return BGM_SEED / 0x7fffffff; }
/** 一首（TUNES 或 THEMES）照 id 找；沒有 ⇒ null。 */
function tuneById(id) { var L = TUNES.concat(THEMES); for (var k = 0; k < L.length; k++) if (L[k].id === id) return L[k]; return null; }
/** 一首用到哪些樂器（INSTR 的鍵，聲音設定頁的提示用）：整份 ABC ⇒ 照 [I:] 第一次出現的順序（% 註解不算）；四首船歌 ⇒ inst（沒寫 ⇒ BGM_INST）。 */
function tuneInsts(tn) {
  if (!tn.abc) return tn.inst || BGM_INST;
  var o = []; tn.abc.forEach(function (ln) { ln.replace(/%.*$/, '').replace(/\[I:\s*([^\]\s]+)\s*\]/g, function (m, k) { if (o.indexOf(k) < 0) o.push(k); return m; }); });
  return o;
}
/** 年代篇的那一章叫什麼（BGM_ERAS）；沒寫 era ⇒ ''。 */
function tuneEra(tn) { for (var k = 0; k < BGM_ERAS.length; k++) if (BGM_ERAS[k][0] === tn.era) return BGM_ERAS[k][1]; return ''; }
/** 現在該放的主題曲：設定開著、在戰局裡（RUNNING）、我操控的那艘（SHIPS[PLAYER_I]）的船型有 theme（game.json ships[].theme）⇒ 那首；否則 null。 */
function bgmTheme() {
  var sh = SND.theme && RUNNING ? SHIPS[PLAYER_I] : null, h = sh && sh.T ? hullInfo(sh.T.id) : null;
  return h && h.theme ? tuneById(h.theme) : null;
}
/** 下一首：操控的船的主題曲 ／ 設定裡指定的那首 ／ 輪播（洗一輪、新的一輪第一首不跟上一首重複）。 */
function bgmNext(prev) {
  var th = bgmTheme(); if (th) return th;
  if (SND.tune !== 'shuffle') { for (var k = 0; k < TUNES.length; k++) if (TUNES[k].id === SND.tune) return TUNES[k]; }
  if (!BGM_ORDER.length) {
    BGM_ORDER = TUNES.slice();
    for (var i = BGM_ORDER.length - 1; i > 0; i--) { var j = Math.floor(bgmRand() * (i + 1)), x = BGM_ORDER[i]; BGM_ORDER[i] = BGM_ORDER[j]; BGM_ORDER[j] = x; }
    if (prev && BGM_ORDER[BGM_ORDER.length - 1] === prev && BGM_ORDER.length > 1) BGM_ORDER.unshift(BGM_ORDER.pop());   // 新的一輪第一首不要剛好是上一首
  }
  return BGM_ORDER.pop();
}
/** 樂器（TASK-0681；Tim 2026-10-17「可能要擴充音樂合成系統 可以支援不同樂器」）：note(ac, dest, f 頻率, t 開始秒, d 長秒, vel 力度)；rev ＝ 送進殘響的份量（0 ⇒ 不接殘響）。
 *  fiddle、accordion ＝ TASK-0677 那兩個聲部原封不動搬過來（四首船歌重構前後離線錄音逐樣本相同，讀數在 TASK-0681）。
 *  TASK-0718 的十二種：音量（peak）照「同一段譜換提琴錄」的 A 加權 RMS 對過（差 −1.5～+0.6 dB；大鼓的瞬時響度對提琴、低頻被 A 加權扣掉 ⇒ 整段 RMS 小 4.8 dB）；
 *  定音鼓長過 BGM_ROLL_S 秒 ⇒ 滾奏；小鼓、大鼓不管音高與長度（一個音 ＝ 打一下）；大鍵琴的音色不看力度（vel 只當音量）。亂數一律 bgmLcg（自己的 LCG）。 */
var INSTR = {
  fiddle: { name: '提琴', rev: 0, note: function (ac, dest, f, t, d, vel) {      // 鋸齒波＋低通、0.18 秒後才出來的 5.5 Hz 顫音
    var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, rel = 0.09, peak = 0.16 * vel;
    lp.type = 'lowpass'; lp.Q.value = 0.7; lp.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.setValueAtTime(peak, Math.max(t + 0.04, end - rel));
    g.gain.linearRampToValueAtTime(0.0001, end);
    lp.frequency.value = Math.min(4200, f * 7);
    var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp);
    if (d > 0.3) { var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.18); lg.gain.linearRampToValueAtTime(7, t + 0.4); lf.connect(lg); lg.connect(o.detune); lf.start(t); lf.stop(end + 0.02); }
    o.start(t); o.stop(end + 0.02);
  } },
  accordion: { name: '手風琴', rev: 0, note: function (ac, dest, f, t, d, vel) {   // 兩道 ±4 cent 的方波＋低通
    var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, rel = 0.06, peak = 0.11 * vel;
    lp.type = 'lowpass'; lp.Q.value = 0.7; lp.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.015);
    g.gain.linearRampToValueAtTime(peak * 0.7, t + 0.15); g.gain.setValueAtTime(peak * 0.7, Math.max(t + 0.15, end - rel));
    g.gain.linearRampToValueAtTime(0.0001, end);
    lp.frequency.value = Math.min(1800, f * 5);
    [-4, 4].forEach(function (c) { var o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.detune.value = c; o.connect(lp); o.start(t); o.stop(end + 0.02); });
  } },
  musicbox: { name: '音樂盒', rev: 0.35, note: function (ac, dest, f, t, d, vel) {   // 簧片被撥一下：敲下去就開始衰減、不持續（譜上的長度只決定下一個什麼時候敲）；低的音響得久
    var ring = clamp(2.6 - 0.8 * Math.log2(f / 262), 0.7, 3.2), peak = 0.25 * vel;
    [[1, 1, ring], [2, 0.12, ring * 0.35], [6.27, 0.22, 0.05]].forEach(function (q) {   // 基音、八度、懸臂簧片的第二模態（≈ 6.27 倍，敲下去那一下的「叮」，很快就暗）
      if (f * q[0] > 16000) return;
      var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f * q[0]; o.connect(g); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * q[1], t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.004, q[2] / 6.9 * 2);   // 時間常數：ring 秒衰到約 −30 dB
      o.start(t); o.stop(t + 0.004 + q[2] * 2 + 0.05);
    });
  } },
  organ: { name: '管風琴', rev: 0.45, note: function (ac, dest, f, t, d, vel) {     // 音栓疊起來的正弦：8'、8' 走音 +6 cent（celeste，慢慢的拍頻）、4'、2 2/3'（十二度，空空的鬼味）、2'；起音 50 ms、放開 150 ms；4.8 Hz 的顫音器
    var g = ac.createGain(), tg = ac.createGain(), end = t + d, peak = 0.06 * vel, a = 0.05, rel = 0.15;
    tg.connect(g); g.connect(dest); tg.gain.value = 1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, Math.max(t + a, end)); g.gain.linearRampToValueAtTime(0.0001, Math.max(t + a, end) + rel);
    var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 4.8; lg.gain.value = 0.07; lf.connect(lg); lg.connect(tg.gain); lf.start(t); lf.stop(Math.max(t + a, end) + rel + 0.02);
    [[1, 1, 0], [1, 0.6, 6], [2, 0.5, 0], [3, 0.28, 0], [4, 0.2, 0]].forEach(function (q) {
      if (f * q[0] > 16000) return;
      var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = f * q[0]; o.detune.value = q[2]; og.gain.value = q[1]; o.connect(og); og.connect(tg);
      o.start(t); o.stop(Math.max(t + a, end) + rel + 0.02);
    });
  } },
  whistle: { name: '錫口笛', rev: 0.15, note: function (ac, dest, f, t, d, vel) {   // 正弦＋一點 2、3 倍泛音；起音帶一口氣（帶通雜訊，很快收掉、留一點底）；長音 0.25 秒後才出來的 5 Hz 顫音
    var g = ac.createGain(), end = t + d, peak = 0.13 * vel, os = [];
    g.connect(dest); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.03); g.gain.setValueAtTime(peak, Math.max(t + 0.03, end - 0.05)); g.gain.linearRampToValueAtTime(0.0001, end);
    [[1, 1], [2, 0.18], [3, 0.06]].forEach(function (q) { var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = f * q[0]; og.gain.value = q[1]; o.connect(og); og.connect(g); os.push(o); });
    if (d > 0.35) { var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 5; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.25); lg.gain.linearRampToValueAtTime(12, t + 0.45); lf.connect(lg); os.forEach(function (o) { lg.connect(o.detune); }); lf.start(t); lf.stop(end + 0.02); }
    var nz = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 2); bp.Q.value = 2;
    nz.connect(bp); bp.connect(ng); ng.connect(g); ng.gain.setValueAtTime(0.5, t); ng.gain.setTargetAtTime(0.06, t + 0.02, 0.03);
    nz.start(t); nz.stop(end + 0.02); os.forEach(function (o) { o.start(t); o.stop(end + 0.02); });
  } },
  pluck: { name: '撥弦', rev: 0.12, note: function (ac, dest, f, t, d, vel) {     // 像班卓琴／吉他：鋸齒＋三角波，低通從亮掃到暗、音量自己衰減（低的音撐得久）；譜上的長度到了就按住弦（0.04 秒收掉）
    var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, peak = 0.2 * vel, dec = clamp(0.45 - 0.15 * Math.log2(f / 262), 0.18, 0.9);
    lp.type = 'lowpass'; lp.Q.value = 1.2; lp.connect(g); g.connect(dest);
    lp.frequency.setValueAtTime(Math.min(9000, f * 14), t); lp.frequency.exponentialRampToValueAtTime(Math.max(180, f * 1.6), t + dec * 1.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.003); g.gain.setTargetAtTime(0.0001, t + 0.003, dec); g.gain.setTargetAtTime(0.0001, end, 0.04);
    [['sawtooth', 0.6, 0], ['triangle', 1, 3]].forEach(function (q) { var o = ac.createOscillator(), og = ac.createGain(); o.type = q[0]; o.frequency.value = f; o.detune.value = q[2]; og.gain.value = q[1]; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.3); });
  } },
  // ── TASK-0718 年代篇的十二種（東羅馬聖詠、荷蘭人、路易十四、西班牙、1850 蒸汽、十八世紀海軍與南北戰爭的軍樂隊）──
  choir: { name: '男聲詠唱團', rev: 0.4, note: function (ac, dest, f, t, d, vel) {   // 四道各自走音（±4／±10 cent＋一點亂數）的鋸齒＋一層氣音 ⇒ 三個並聯的帶通共振峰（母音「啊」：700／1150／2600 Hz）＋一條低通留住胸腔的基音；起音 80 ms、放開 0.18 秒；長音 0.3 秒後才出來、四個聲音速度各不一樣的淺顫音
    var g = ac.createGain(), mix = ac.createGain(), end = t + d, a = Math.min(0.08, d * 0.4), top = Math.max(t + a, end), rel = 0.18, stop = top + rel + 0.05, peak = 0.8 * vel, R = bgmLcg(t, f);
    g.connect(dest); mix.gain.value = 0.25;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, top); g.gain.linearRampToValueAtTime(0.0001, top + rel);
    [[700, 4, 1], [1150, 6, 0.8], [2600, 10, 0.3], [0, 0, 0.12]].forEach(function (q) {   // [中心 Hz, Q, 份量]；最後一條 ＝ 低通（只留基音：低的男聲才有身體）
      var fl = ac.createBiquadFilter(), fg = ac.createGain();
      if (q[0]) { fl.type = 'bandpass'; fl.frequency.value = q[0]; fl.Q.value = q[1]; } else { fl.type = 'lowpass'; fl.frequency.value = f * 1.2; fl.Q.value = 0.5; }
      fg.gain.value = q[2]; mix.connect(fl); fl.connect(fg); fg.connect(g);
    });
    [-10, -4, 4, 10].forEach(function (c, k) {
      var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c + (R() - 0.5) * 6; o.connect(mix); o.start(t); o.stop(stop);
      if (d > 0.45) { var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 4.4 + 0.4 * k + 0.3 * R(); lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.3); lg.gain.linearRampToValueAtTime(8, t + 0.7); lf.connect(lg); lg.connect(o.detune); lf.start(t); lf.stop(stop); }
    });
    var nz = ac.createBufferSource(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; ng.gain.value = 0.05; nz.connect(ng); ng.connect(mix); nz.start(t, R() * 0.9); nz.stop(stop);
  } },
  drone: { name: '持續音', rev: 0.4, note: function (ac, dest, f, t, d, vel) {   // 伊頌（聖詠底下一直撐著的那個音，像閉著嘴哼）：正弦基音為主＋很淡的 2–5 倍泛音，另一道 +3 cent 的基音慢慢地拍；起音 0.4 秒、放開 0.6 秒；⛔ 不加顫音
    var g = ac.createGain(), end = t + d, a = Math.min(0.4, d * 0.5), top = Math.max(t + a, end), rel = 0.6, stop = top + rel + 0.05, peak = 0.2 * vel;
    g.connect(dest); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, top); g.gain.linearRampToValueAtTime(0.0001, top + rel);
    [[1, 1, 0], [1, 0.45, 3], [2, 0.35, 0], [3, 0.18, 0], [4, 0.09, 0], [5, 0.045, 0]].forEach(function (q) {
      if (f * q[0] > 16000) return;
      var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = f * q[0]; o.detune.value = q[2]; og.gain.value = q[1]; o.connect(og); og.connect(g); o.start(t); o.stop(stop);
    });
  } },
  brass: { name: '銅管合奏', rev: 0.15, note: function (ac, dest, f, t, d, vel) {   // 三道 −7／0／+6 cent 的鋸齒（合奏的寬度）⇒ 帶一點共振的低通，截止 f×(2＋5×力度)（f 亮、p 暗）；起音 35 ms 濾波衝過頭再回來（唇的「叭」）、音高從 −30 cent 滑上來、一口舌頭的雜訊；長音晚到 6 cent 的顫音（短號）
    bgmBrass(ac, dest, f, t, d, vel, { v: [-7, 0, 6], k0: 1.5, k1: 2, k2: 5, lo: 500, hi: 7000, q: 1.6, bl: 1.5, a: 0.035, sus: 0.8, sc: -30, nz: 0.15, vib: 6, peak: 0.1 });
  } },
  horn: { name: '法國號', rev: 0.2, note: function (ac, dest, f, t, d, vel) {      // 兩道 ±4 cent 的鋸齒 ⇒ 低通 f×(1.6＋2.4×力度)（比 brass 圓、暗；下限 450 Hz：低音 B♭1 也留得住小喇叭聽得到的泛音）；起音 60 ms（十六分倚音跟著縮到音長的 30%）、音高從 −15 cent 滑上來；⛔ 不加顫音
    bgmBrass(ac, dest, f, t, d, vel, { v: [-4, 4], k0: 1.2, k1: 1.6, k2: 2.4, lo: 450, hi: 3200, q: 0.9, bl: 1.2, a: 0.06, sus: 0.85, sc: -15, nz: 0, vib: 0, peak: 0.14 });
  } },
  trumpet: { name: '小號', rev: 0.2, note: function (ac, dest, f, t, d, vel) {     // 巴洛克的自然號：一道鋸齒 ⇒ 共振比較強的低通 f×(3＋5×力度)（最亮的一種）；起音 25 ms 濾波從 f×1.8 衝開再收一點（唇振）、音高從 −25 cent 滑上來、一口比較衝的舌頭雜訊；⛔ 不加顫音
    bgmBrass(ac, dest, f, t, d, vel, { v: [0], k0: 1.8, k1: 3, k2: 5, lo: 800, hi: 9000, q: 2.2, bl: 1.4, a: 0.025, sus: 0.75, sc: -25, nz: 0.3, vib: 0, peak: 0.18 });
  } },
  timpani: { name: '定音鼓', rev: 0.2, note: function (ac, dest, f, t, d, vel) {   // 鼓皮的模態：主音 (1,1) ＝ 譜上的音，加 1.5／1.98／2.44／2.94 倍（越高衰得越快）、一個 0.55 倍 0.15 秒就悶掉的「咚」；敲下去音高從 +20 cent 沉回來（30 ms）；槌頭 ＝ 一口低通雜訊；譜上長過 BGM_ROLL_S 秒 ⇒ 滾奏（每秒約 14 下，每下的力度用 bgmLcg 抖一點）
    var R = bgmLcg(t, f), end = t + d, hits = [[t, 1]], ring = clamp(2.2 - 0.5 * Math.log2(f / 110), 1.2, 2.6), out = ac.createGain(), s;
    if (d >= BGM_ROLL_S) for (s = t + 0.07; s < end - 0.03; s += (0.9 + 0.2 * R()) / 14) hits.push([s, 0.5 + 0.15 * R()]);
    var last = hits[hits.length - 1][0], stop = last + ring + 0.1; out.gain.value = 0.31 * vel; out.connect(dest);
    [[0.55, 0.5, 0.15], [1, 1, ring], [1.5, 0.5, ring * 0.6], [1.98, 0.3, ring * 0.45], [2.44, 0.1, ring * 0.3], [2.94, 0.05, ring * 0.2]].forEach(function (m) {   // [倍數, 份量, 幾秒衰到 −60 dB]
      var o = ac.createOscillator(), mg = ac.createGain(); o.type = 'sine'; o.frequency.value = f * m[0]; o.detune.setValueAtTime(20, t); o.detune.setTargetAtTime(0, t, 0.03); o.connect(mg); mg.connect(out);
      mg.gain.setValueAtTime(0, t); hits.forEach(function (h) { mg.gain.setTargetAtTime(m[1] * h[1], h[0], 0.002); mg.gain.setTargetAtTime(0, h[0] + 0.008, m[2] / 6.9); });   // 每一下：2 ms 拉到那一下的大小，再照這個模態自己的速度衰
      o.start(t); o.stop(stop);
    });
    var nz = ac.createBufferSource(), lp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; lp.type = 'lowpass'; lp.frequency.value = 1400; nz.connect(lp); lp.connect(ng); ng.connect(out);
    ng.gain.setValueAtTime(0, t); hits.forEach(function (h) { ng.gain.setTargetAtTime(0.5 * h[1], h[0], 0.001); ng.gain.setTargetAtTime(0, h[0] + 0.004, 0.012); });
    nz.start(t, R() * 0.9); nz.stop(last + 0.15);
  } },
  snare: { name: '小鼓', rev: 0.1, note: function (ac, dest, f, t, d, vel) {      // 響弦 ＝ 高通 1.5 kHz＋帶通 ≈ 3.5 kHz 的雜訊、0.12 秒衰掉；鼓皮 ＝ 從 240 Hz 沉到 185 Hz 的正弦＋1.6 倍的第二模態（都不到 0.1 秒）；譜上的音高不管，只讓頻率差一點點（±1 個八度 ⇒ ±7%）；譜上的長度不管（一個音 ＝ 打一下）
    var k = Math.pow(2, 0.1 * clamp(Math.log2(f / 262), -1, 1)), peak = 0.5 * vel, R = bgmLcg(t, f), stop = t + 0.4;
    var nz = ac.createBufferSource(), hp = ac.createBiquadFilter(), bp = ac.createBiquadFilter(), ng = ac.createGain();
    nz.buffer = bgmNoise(ac); nz.loop = true; hp.type = 'highpass'; hp.frequency.value = 1500; bp.type = 'bandpass'; bp.frequency.value = 3500 * k; bp.Q.value = 0.7;
    nz.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(dest);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(peak, t + 0.0015); ng.gain.setTargetAtTime(0.0001, t + 0.0015, 0.035);
    nz.start(t, R() * 0.9); nz.stop(stop);
    [[1, 0.6, 0.03], [1.6, 0.25, 0.02]].forEach(function (m) {
      var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(240 * k * m[0], t); o.frequency.exponentialRampToValueAtTime(185 * k * m[0], t + 0.04);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(peak * m[1], t + 0.002); og.gain.setTargetAtTime(0.0001, t + 0.002, m[2]);
      o.connect(og); og.connect(dest); o.start(t); o.stop(stop);
    });
  } },
  bassdrum: { name: '大鼓', rev: 0.15, note: function (ac, dest, f, t, d, vel) {   // 軍樂隊的大鼓（繩子拉緊的那種）：鼓皮基音從 110 Hz 沉到 75 Hz、0.8 秒衰掉，加 1.5／2.1／2.75 倍三個快停的模態；氈槌打下去 ＝ 帶通 350 Hz 的「噗」＋低通 1.5 kHz 的一下（小喇叭聽得到的是這些）；譜上的音高不管（只讓基音差一點點）、長度不管
    var k = Math.pow(2, 0.08 * clamp(Math.log2(f / 131), -1, 1)), peak = 0.5 * vel, R = bgmLcg(t, f), stop = t + 1.2;
    [[1, 0.6, 0.8], [1.5, 0.6, 0.35], [2.1, 0.45, 0.22], [2.75, 0.35, 0.15]].forEach(function (m) {   // [倍數, 份量, 幾秒衰到 −60 dB]
      var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110 * k * m[0], t); o.frequency.exponentialRampToValueAtTime(75 * k * m[0], t + 0.1);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(peak * m[1], t + 0.004); og.gain.setTargetAtTime(0.0001, t + 0.004, m[2] / 6.9);
      o.connect(og); og.connect(dest); o.start(t); o.stop(stop);
    });
    [['bandpass', 350, 1.2, 4.5, 0.03], ['lowpass', 1500, 0.7, 0.6, 0.01]].forEach(function (q) {   // [濾波, Hz, Q, 份量, 時間常數]
      var nz = ac.createBufferSource(), fl = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; fl.type = q[0]; fl.frequency.value = q[1]; fl.Q.value = q[2]; nz.connect(fl); fl.connect(ng); ng.connect(dest);
      ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(peak * q[3], t + 0.002); ng.gain.setTargetAtTime(0.0001, t + 0.002, q[4]); nz.start(t, R() * 0.9); nz.stop(t + 0.25);
    });
  } },
  fife: { name: '橫笛', rev: 0.12, note: function (ac, dest, f, t, d, vel) {       // 軍樂隊的橫笛（比錫口笛尖、氣多）：正弦＋2 倍 0.3、3 倍 0.12、4 倍 0.05；氣音 ＝ 中心 f×1.5 的帶通雜訊，舌頭那一下（20 ms）衝、之後留一層底；起音 20 ms；長音晚到很淺的顫音（4 cent：橫笛手幾乎不揉音）
    var g = ac.createGain(), end = t + d, peak = 0.107 * vel, os = [];
    g.connect(dest); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.02); g.gain.setValueAtTime(peak, Math.max(t + 0.02, end - 0.04)); g.gain.linearRampToValueAtTime(0.0001, end);
    [[1, 1], [2, 0.3], [3, 0.12], [4, 0.05]].forEach(function (q) { if (f * q[0] > 16000) return; var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = f * q[0]; og.gain.value = q[1]; o.connect(og); og.connect(g); os.push(o); });
    if (d > 0.4) { var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.3); lg.gain.linearRampToValueAtTime(4, t + 0.5); lf.connect(lg); os.forEach(function (o) { lg.connect(o.detune); }); lf.start(t); lf.stop(end + 0.02); }
    var nz = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; bp.type = 'bandpass'; bp.frequency.value = Math.min(10000, f * 1.5); bp.Q.value = 1.5;
    nz.connect(bp); bp.connect(ng); ng.connect(g); ng.gain.setValueAtTime(0.9, t); ng.gain.setTargetAtTime(0.12, t + 0.015, 0.02);
    nz.start(t, bgmLcg(t, f)() * 0.9); nz.stop(end + 0.02); os.forEach(function (o) { o.start(t); o.stop(end + 0.02); });
  } },
  koto: { name: '箏', rev: 0.25, note: function (ac, dest, f, t, d, vel) {         // 爪子靠近琴橋撥 ⇒ 高泛音多：九個正弦泛音（振幅 ∝ sin(nπ·0.12)／n），硬弦一點點不諧和（第 n 個 × √((1＋B·n²)／(1＋4B))，B ＝ 2.5e-4：第 2 泛音對準、越高越偏高 ⇒ 金屬感），越高的泛音衰得越快；起音音高從 +15 cent 沉回來（30 ms）、爪子那一下 ＝ 很短的帶通雜訊；低音弦（E3）響 ≈ 2.4 秒、高音（E5）≈ 1 秒（衰到 −30 dB）；譜上的長度只決定下一個音（不按弦）
    var ring = clamp(3.2 - Math.log2(f / 165), 1.1, 3.6), B = 2.5e-4, out = ac.createGain(), R = bgmLcg(t, f); out.gain.value = 0.13 * vel; out.connect(dest);
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (n) {
      var fn = f * n * Math.sqrt((1 + B * n * n) / (1 + 4 * B)), r = ring / (1 + 0.45 * (n - 1)); if (fn > 15000) return;
      var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sine'; o.frequency.value = fn; o.detune.setValueAtTime(15, t); o.detune.linearRampToValueAtTime(0, t + 0.03);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(Math.sin(n * Math.PI * 0.12) / n / Math.sin(Math.PI * 0.12), t + 0.003); og.gain.setTargetAtTime(0.0001, t + 0.003, r / 6.9 * 2);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.003 + r * 2 + 0.05);
    });
    var nz = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 2;
    nz.connect(bp); bp.connect(ng); ng.connect(out); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.6, t + 0.001); ng.gain.setTargetAtTime(0.0001, t + 0.001, 0.006); nz.start(t, R() * 0.9); nz.stop(t + 0.06);
  } },
  lute: { name: '魯特琴', rev: 0.15, note: function (ac, dest, f, t, d, vel) {     // 羊腸弦、手指撥（比 pluck 溫、低音撐得久）：一對 ±3 cent 的弦（三角＋0.35 鋸齒），低通從 f×7 掃到 f×2；低音（G3 以下）那一對是八度弦 ⇒ 再加一道 2f；起音 6 ms（指腹）；譜上的長度到了就按住弦（0.05 秒收掉）
    var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, peak = 0.28 * vel, dec = clamp(0.75 - 0.25 * Math.log2(f / 262), 0.35, 1.5), V = [[1, -3, 1], [1, 3, 1]];
    lp.type = 'lowpass'; lp.Q.value = 0.8; lp.connect(g); g.connect(dest);
    lp.frequency.setValueAtTime(Math.min(6000, f * 7), t); lp.frequency.exponentialRampToValueAtTime(Math.max(250, f * 2), t + dec * 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.006); g.gain.setTargetAtTime(0.0001, t + 0.006, dec); g.gain.setTargetAtTime(0.0001, end, 0.05);
    if (f < 196) V.push([2, 0, 0.45]);
    V.forEach(function (q) { [['triangle', 1], ['sawtooth', 0.35]].forEach(function (w) { var o = ac.createOscillator(), og = ac.createGain(); o.type = w[0]; o.frequency.value = f * q[0]; o.detune.value = q[1]; og.gain.value = w[1] * q[2] * 0.5; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.3); }); });
  } },
  harpsichord: { name: '大鍵琴', rev: 0.2, note: function (ac, dest, f, t, d, vel) {   // 羽管撥弦、兩排 8' 弦（第二排 +3 cent）＋高八度的一點：鋸齒，低通從 min(f×24, 12 kHz) 很快收到 f×5（亮、衰得快）；撥下去「喀」一下 ＝ 很短的高通雜訊；放鍵 ＝ 制音器 0.012 秒壓掉；⛔ 音色、起音都不看力度（vel 只當音量推子：譜上的力度、整首的 vol）
    var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, peak = 0.21 * vel, dec = clamp(0.5 - 0.2 * Math.log2(f / 262), 0.25, 1.1), R = bgmLcg(t, f);
    lp.type = 'lowpass'; lp.Q.value = 0.9; lp.connect(g); g.connect(dest);
    lp.frequency.setValueAtTime(Math.min(12000, f * 24), t); lp.frequency.setTargetAtTime(Math.min(8000, Math.max(1200, f * 5)), t + 0.002, 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.setTargetAtTime(0.0001, t + 0.002, dec); g.gain.setTargetAtTime(0.0001, end, 0.012);
    [[1, 0, 1], [1, 3, 0.8], [2, 0, 0.25]].forEach(function (q) { if (f * q[0] > 16000) return; var o = ac.createOscillator(), og = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = f * q[0]; o.detune.value = q[1]; og.gain.value = q[2]; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.2); });
    var nz = ac.createBufferSource(), hp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; hp.type = 'highpass'; hp.frequency.value = 4000; nz.connect(hp); hp.connect(ng); ng.connect(g);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.001); ng.gain.setTargetAtTime(0.0001, t + 0.001, 0.004); nz.start(t, R() * 0.9); nz.stop(t + 0.05);
  } }
};
var BGM_ROLL_S = 2;                                                    // 定音鼓：譜上長過這麼多秒的音 ＝ 滾奏（漂泊的荷蘭人一小節 2.5 秒的長音；感恩讚的附點二分 1.6 秒還是敲一下）
/** 銅管（brass、horn、trumpet 共用）：P.v 幾道鋸齒（各走音幾 cent）⇒ 低通，截止 ＝ f ×（k1 ＋ k2 × 力度）夾在 lo–hi Hz ⇒ 力度越大越亮；
 *  起音：低通從 f × k0 打開、衝過頭（× bl）再回來（唇的「嘟」），音高從 sc cent 滑上來（40 ms），音量先到 peak 再回到 sus 成；nz ＞ 0 ⇒ 起音那一下加一口帶通雜訊（舌頭）；vib ＞ 0 ⇒ 長音 0.3 秒後幾 cent 的顫音。
 *  起音最多佔音長的 30% ⇒ 0.1 秒的十六分倚音也吹得出來（荷蘭人的 B♭）。 */
function bgmBrass(ac, dest, f, t, d, vel, P) {
  var g = ac.createGain(), lp = ac.createBiquadFilter(), end = t + d, a = Math.max(0.008, Math.min(P.a, d * 0.3)), stop = end + 0.25, peak = P.peak * vel;
  var cut = clamp(f * (P.k1 + P.k2 * vel), P.lo, P.hi), c0 = clamp(f * P.k0, 150, cut);
  lp.type = 'lowpass'; lp.Q.value = P.q; lp.connect(g); g.connect(dest);
  lp.frequency.setValueAtTime(c0, t); lp.frequency.exponentialRampToValueAtTime(cut * P.bl, t + a); lp.frequency.setTargetAtTime(cut, t + a, 0.06);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(peak * P.sus, t + a, 0.08); g.gain.setTargetAtTime(0.0001, end, 0.015);
  P.v.forEach(function (c) {
    var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.setValueAtTime(c + P.sc, t); o.detune.linearRampToValueAtTime(c, t + Math.min(0.04, a + 0.01)); o.connect(lp); o.start(t); o.stop(stop);
    if (P.vib && d > 0.5) { var lf = ac.createOscillator(), lg = ac.createGain(); lf.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.3); lg.gain.linearRampToValueAtTime(P.vib, t + 0.5); lf.connect(lg); lg.connect(o.detune); lf.start(t); lf.stop(stop); }
  });
  if (P.nz) {
    var nz = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain(); nz.buffer = bgmNoise(ac); nz.loop = true; bp.type = 'bandpass'; bp.frequency.value = Math.min(8000, f * 4); bp.Q.value = 1.2;
    nz.connect(bp); bp.connect(ng); ng.connect(dest); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(peak * P.nz * 3, t + 0.004); ng.gain.setTargetAtTime(0.0001, t + 0.004, 0.012); nz.start(t, bgmLcg(t, f)() * 0.9); nz.stop(t + 0.1);   // 不經過主包絡（那時還在起音）⇒ 直接出去
  }
}
/** 一個音自己的亂數（定音鼓滾奏每一下的力度、詠唱團每個聲音的走音、雜訊從哪裡開始讀）：自己的 LCG，種子照音的開始時間與頻率 ⇒ 離線錄每次一樣；
 *  ⛔ 不用 Math.random、不抽 rnd()、不動 BGM_SEED（輪播的洗牌）。回一個函式，每叫一次給一個 [0, 1)。 */
function bgmLcg(t, f) {
  var s = ((Math.round(t * 1000) * 7919 + Math.round(f * 10)) & 0x7fffffff) || 1;
  return function () { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x80000000; };
}
/** 一段 1 秒的白雜訊（錫口笛的氣音；自己的 LCG ⇒ ⛔ 不用 Math.random）。每個 AudioContext 一份。 */
function bgmNoise(ac) {
  if (ac.__noise) return ac.__noise;
  var n = ac.sampleRate, b = ac.createBuffer(1, n, ac.sampleRate), x = b.getChannelData(0), s = 24680;
  for (var i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; x[i] = s / 0x40000000 - 1; }
  return (ac.__noise = b);
}
var BGM_REV_S = 2.6;                                                   // 殘響的長度（秒；衰到 −60 dB）
/** 樂器的出口：rev ＝ 0 ⇒ 直接 dest；否則一個節點 ⇒ dest（乾）＋ 送 rev 份到殘響（每個 dest 一份卷積，衝激響應用自己的 LCG 生 ⇒ ⛔ 不用 Math.random）。快取在 dest 上。 */
function bgmOut(ac, dest, inst) {
  var I = INSTR[inst]; if (!I.rev) return dest;
  var R = dest.__rev || (dest.__rev = { cv: null, ins: {} });
  if (!R.cv) {
    var b; while (!(b = bgmRevBuf(ac))) { /* 兩個聲道照順序填（同一串亂數） */ }
    R.cv = ac.createConvolver(); R.cv.normalize = true; R.cv.buffer = b; R.cv.connect(dest);
  }
  if (!R.ins[inst]) { var n0 = ac.createGain(), sg = ac.createGain(); sg.gain.value = I.rev; n0.connect(dest); n0.connect(sg); sg.connect(R.cv); R.ins[inst] = n0; }
  return R.ins[inst];
}
/** 殘響（bgmOut 第一次要用才建：一段 BGM_REV_S 秒的衝擊響應＋卷積）先建好 —— 開戰分段（70_flow.js flowWarmSteps）跟第一個音分開兩步。跟第一個音建的同一份。 */
function bgmWarm() { if (!AC || !AC.bgmBus) return; for (var k in INSTR) if (INSTR[k].rev) { bgmOut(AC, AC.bgmBus, k); return; } }
/** 殘響的衝擊響應（bgmOut 第一次建的那一份；照同一個種子）：一個聲道一次 ⇒ 開戰分段先做（bgmRevSteps），建卷積時拿現成的。 */
function bgmRevBuf(ac) {
  var R = ac.bgmRev || (ac.bgmRev = { b: null, c: 0, s: 13579 }); if (R.b && R.c >= 2) return R.b;
  var sr = ac.sampleRate, n = Math.round(sr * BGM_REV_S), tau = BGM_REV_S / 6.9;
  if (!R.b) R.b = ac.createBuffer(2, n, sr);
  var x = R.b.getChannelData(R.c), s = R.s; for (var i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; x[i] = (s / 0x40000000 - 1) * Math.exp(-i / sr / tau); }
  R.s = s; R.c++;
  return R.c >= 2 ? R.b : null;
}
/** 一個音：inst 樂器（INSTR）、f（Hz）、t（開始，秒）、d（長，秒）、vel 力度。 */
function bgmNote(ac, dest, inst, f, t, d, vel) { INSTR[inst].note(ac, bgmOut(ac, dest, inst), f, t, d, vel); }
/** 從 t0（秒）起把一首的 [a, b) 拍排進去；回下一個沒排的事件序號。 */
function bgmSched(ac, dest, tn, t0, k, until) {
  var E = tuneEvents(tn), spb = 60 / tn.Q;
  while (k < E.ev.length && t0 + E.ev[k][0] * spb < until) {
    var e = E.ev[k]; bgmNote(ac, dest, e[4], 440 * Math.pow(2, (e[2] - 69) / 12), t0 + e[0] * spb, Math.max(0.05, e[1] * spb - 0.02), e[5] * (tn.vol || 1)); k++;
  }
  return k;
}
/** 每一格（90_main.js，主選單也跑）：音量線、淡入淡出、往前排程。還沒有聲音 ⇒ 什麼都不做。 */
function bgmFrame() {
  if (!AC || !AC.bgmBus) return;
  var now = AC.currentTime, fight = now - SND_FIGHT < BGM_FIGHT_S;
  var forced = !!(BGM && BGM.forced), want = muted || (SND.mode === 'off' && !forced) ? 0 : SND.bgm * BGM_VOL * (SND.mode === 'duck' && fight && !forced ? BGM_DUCK : 1);
  AC.bgmBus.gain.setTargetAtTime(want, now, muted ? 0.05 : want < AC.bgmBus.gain.value ? BGM_FADE / 3 : 0.8);   // 靜音（M）馬上關；交戰變小照 BGM_FADE、回來 0.8 秒
  if (SND.mode === 'off' && !forced) { BGM = null; return; }
  if (!BGM) BGM = { tn: bgmNext(null), t0: now + 0.3, k: 0, pass: 0 };
  else {                                                                          // 換曲（TASK-0681）：開局、改操控、回主選單 ⇒ 該放的主題曲變了 ⇒ 排完已經排進去的那一段（BGM_LOOK）就換
    var th = bgmTheme(), tid = th ? th.id : null;                                 // 試聽（forced）只在按下去那時的狀態裡算數：之後該放的主題曲變了（例如試聽完直接開局）⇒ 試聽讓位
    //   沒有該放的主題曲 ⇒ 正在放的是 THEMES 裡的才換（TASK-0718：年代篇的 TUNES 也是整份 ABC ⇒ ⛔ 不能再照「有沒有 abc」認主題曲，不然一放就被切走）
    if (BGM.forced ? tid !== BGM.want : (th ? BGM.tn !== th : THEMES.indexOf(BGM.tn) >= 0)) BGM = { tn: th || bgmNext(BGM.tn), t0: Math.max(now + BGM_LOOK, BGM.t0) + BGM_SWAP, k: 0, pass: 0 };
  }
  var E = tuneEvents(BGM.tn), spb = 60 / BGM.tn.Q;
  BGM.k = bgmSched(AC, AC.bgmBus, BGM.tn, BGM.t0, BGM.k, now + BGM_LOOK);
  if (BGM.k >= E.ev.length && now + BGM_LOOK >= BGM.t0 + E.len * spb) {          // 這一遍排完 ⇒ 接下一遍（同一首照拍子接上）或停一下換下一首
    BGM.pass++;
    if (BGM.pass < bgmPasses(BGM.tn)) { BGM.t0 += E.len * spb; BGM.k = 0; }
    else BGM = { tn: bgmNext(BGM.tn), t0: BGM.t0 + E.len * spb + BGM_GAP, k: 0, pass: 0 };
  }
}
/** 試聽（聲音設定頁的 ▶）：從頭放指定的那一首（還沒有聲音就先建，這一下是使用者的點擊）。 */
function bgmPreview(id) {
  initAudio(); if (!AC) return; if (AC.state === 'suspended') AC.resume();
  var tn = tuneById(id), th = bgmTheme(); if (tn) BGM = { tn: tn, t0: AC.currentTime + 0.15, k: 0, pass: 0, forced: true, want: th ? th.id : null };   // want：按下去那時該放的主題曲（bgmFrame 看它變了沒）   // ⚠ 前一首已經排進去的那幾個音（最多 BGM_LOOK 秒）照樣會響完
}
/** 音效、環境音兩條線照 SND 設（靜音 ⇒ 0）；BGM 那條在 bgmFrame 淡。 */
function sndApply() {
  if (!AC || !AC.sfxBus) return;
  var now = AC.currentTime; AC.sfxBus.gain.setTargetAtTime(muted ? 0 : SND.sfx, now, 0.05); AC.ambBus.gain.setTargetAtTime(muted ? 0 : SND.amb, now, 0.05);
}
/** 離線錄（__game.bgmRender；src/tests/music_lab.py 量音高、音頭）：o ＝ { id（TUNES 或 THEMES）或 abc（臨時一份）, sec, solo（0 只旋律、1 只低音、省略 ＝ 全部聲部）, from（從第幾秒錄起，省略 ＝ 0）,
 *  vol（這一次錄的整首音量倍數，省略 ＝ 那首的 vol；TASK-0718 對響度用：不用改譜重建就能試）}；回 Promise<{ id, notes（[秒, 長, 音高, 聲部, 樂器]）, peak, rmsDb, wav, sec（一遍幾秒）}>。 */
function bgmRender(o) {
  var tn = o.abc ? { id: 'adhoc', abc: o.abc } : tuneById(o.id);   // o.abc：臨時的一份整份 ABC（量樂器用，不進 THEMES）
  if (!tn) return Promise.reject(new Error('沒有這首：' + o.id));
  var E = tuneEvents(tn), spb = 60 / tn.Q, sec = o.sec || E.len * spb + (tn.abc ? 3 : 0.5), sr = 44100, oc = new OfflineAudioContext(2, Math.round(sr * sec), sr), mg = oc.createGain(); mg.gain.value = 1; mg.connect(oc.destination);
  var notes = [], vol = o.vol !== undefined ? o.vol : (tn.vol || 1);
  E.ev.forEach(function (e) {
    if (o.solo !== undefined && e[3] !== o.solo) return;
    var t = 0.1 + e[0] * spb - (o.from || 0); if (t >= sec || t < 0.1) return;
    bgmNote(oc, mg, e[4], 440 * Math.pow(2, (e[2] - 69) / 12), t, Math.max(0.05, e[1] * spb - 0.02), e[5] * vol); notes.push([+t.toFixed(4), +(e[1] * spb).toFixed(4), e[2], e[3], e[4]]);
  });
  return oc.startRendering().then(function (buf) { var r = audioWav(buf); r.id = tn.id; r.notes = notes; r.spb = spb; r.sec = E.len * spb; return r; });
}
/** 遊戲內設定面板與聲音設定頁的「音量」（[data-snd] 滑桿兩處同一組值）：畫出現在的值；發 cfg:snd（外殼的聲音設定頁畫 BGM 那幾排，71_cfgpages.js bgmShow；TASK-0774）。 */
function sndShow() {
  [].forEach.call(document.querySelectorAll('[data-snd]'), function (r) { r.value = Math.round(SND[r.dataset.snd] * 100); });
  [].forEach.call(document.querySelectorAll('[data-sndv]'), function (e) { var v = SND[e.dataset.sndv]; e.textContent = v > 0 ? Math.round(v * 100) + '%' : '關'; });
  evEmit('cfg:snd');
}
/** 綁一次（核心開機時叫，71_input.js）：音量滑桿（遊戲內設定面板＋聲音設定頁）。BGM 那幾排是外殼的 bgmUI。 */
function sndUI() {
  [].forEach.call(document.querySelectorAll('[data-snd]'), function (r) { r.oninput = function () { SND[r.dataset.snd] = clamp(+r.value / 100, 0, 1); sndApply(); sndShow(); }; });
}
