// ───────────────────────── 艙內的水：畫（TASK-0669 從 33_flood.js 搬來） ─────────────────────────
// 區塊職責：艙內進水的水面、水幕、側面、深度吸光 —— 只給人看；水量、下沉、傾斜、破口都在 33_flood.js（模擬），這裡只讀它的 sh.fl。
// 物理意義：以前這一段寫在 33_flood.js 後半，模擬檔因此讀 60_render.js 的 RT、72_floodui.js 的 FLX3（TASK-0669 量到的「模擬層往上咬」）。
//   33 的前半一個名字都沒用到這裡；這裡被 60_render.js（flDraw、flPushJets）、90_main.js（flGL）、81_floodlab.js（FL_SNAP、FL_STAT、FL_DEPBLIT）在執行時叫。

// ── 深度吸光（TASK-0654；Tim 2026-10-16：「目前這樣看起來像浮空的一片透明片」、畫質選項 GFX.pdep）──
//   水面那一點到它後面不透明的東西（RT.B 的深度：畫海之前的場景）有多厚 th（公尺，沿鏡頭方向的深度差）：
//   越厚越不透明、越深色（1 − e^(−1.3 th)：10 cm ≈ 0.12、1 m ≈ 0.73、2 m ≈ 0.93）；貼著地板、牆的地方（th < 8 cm）淡出 ⇒ 看得出「一池水」而不是一片玻璃。
//   linZ 跟海的著色器同一支（近 0.5、遠 5000）。透視（FLX3）不讀：關了深度測試，後面那層是擋在前面的船殼 ⇒ 照舊。
var FL_DEP_GLSL = 'float flLinZ(float d){ float z=d*2.0-1.0; return 5000.0/(5000.5-z*4999.5); }\nvec3 flDepC;\n' +
  'vec2 flDep(vec3 c,float a0){ float th=max(flLinZ(textureLod(uSceneD,gl_FragCoord.xy/uView,0.0).r)-flLinZ(gl_FragCoord.z),0.0); float ab=1.0-exp(-th*1.3);\n' +
  ' flDepC=mix(c*1.15+vec3(0.03,0.06,0.05),c*0.55,ab); return vec2(mix(0.2,0.93,ab)*smoothstep(0.0,0.08,th),th); }\n';
// 水邊的 noise（TASK-0654；GFX.pedge）：值雜訊（格點雜湊、平滑內插），船上座標（公尺）⇒ 跟著船走、不會因為船在動而爬
var FLE_GLSL = 'float flHs(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\n' +
  'float flNz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(flHs(i),flHs(i+vec2(1.0,0.0)),f.x),mix(flHs(i+vec2(0.0,1.0)),flHs(i+vec2(1.0,1.0)),f.x),f.y); }\n';
// ── 畫：艙內的水面（每一格水柱的頂，四個角照同一個世界高度擺 ⇒ 船傾斜時水面還是平的）；噴進來的粒子跟點精靈一起畫 ──
function flGL() {
  function poolFS(rip) { return '' +                                    // ⛔ return 後面要接著寫（換行 ⇒ 自動補分號、回 undefined）；水面的著色：水格的 P.pool、房間的 P.wpool（63_wrwater_gl.js，TASK-0811）共用；rip ⇒ 多接細波（WRW_RIP_*；⛔ 水格那一份的字一個都不變）
    '#version 300 es\nprecision highp float; in vec3 vW; in float vF; in vec2 vG; uniform vec3 uEye,uSun,uFog,uSky; uniform float uFogD,uSeaT,uX,uDep,uEdge; uniform vec2 uView; uniform sampler2D uSceneD; out vec4 o;\n' + (rip ? WRW_RIP_DECL : '') + SHADOW_GLSL + FL_DEP_GLSL + FLE_GLSL +
    'void main(){ vec2 r=vec2(sin(vW.x*3.1+uSeaT*2.3)+sin(vW.z*4.3-uSeaT*1.7),cos(vW.z*2.7-uSeaT*1.9)+cos(vW.x*3.7+uSeaT*2.1))*0.03;' + (rip ? WRW_RIP_GLSL : '') + ' vec3 n=normalize(vec3(r.x,1.0,r.y));\n' +
    ' vec3 v=normalize(uEye-vW); float fr=0.04+0.96*pow(1.0-max(dot(n,v),0.0),5.0), sk=shadowK(vW,n);\n' +
    ' vec3 c=mix(vec3(0.08,0.27,0.3)*(0.45+0.55*sk),uSky*0.75,clamp(fr*0.8+0.08,0.0,1.0))+vec3(1.0,0.92,0.75)*pow(max(dot(reflect(-v,n),uSun),0.0),90.0)*(0.25+sk);\n' +
    ' float al=uX>0.5?0.62:0.78; if(uDep>0.5&&uX<0.5){ vec2 da=flDep(c,0.78); c=flDepC; al=da.x; }\n' +   // 深度吸光（TASK-0654）：關 ⇒ 一位元都不變
    ' if(uEdge>0.5&&vF>0.001){ float nz=flNz(vG*2.2+vec2(uSeaT*0.11,-uSeaT*0.07))*0.65+flNz(vG*5.3-vec2(uSeaT*0.05,uSeaT*0.13)+7.0)*0.35;\n' +   // 水邊（flEdgeM、GFX.pedge）：白沫一圈、淺的邊照 noise 吃進去；關 ⇒ 一位元都不變
    '  float fm=smoothstep(0.1+0.45*nz,0.22+0.45*nz,vF)*(0.55+0.45*flNz(vG*11.0+uSeaT*0.3)); c=mix(c,vec3(0.8,0.88,0.88),0.6*fm); al=max(al,0.5*fm);\n' +   // 白沫自帶不透明度（⛔ 乘在 al 上 ⇒ 貼地板的薄水被深度吸光淡到快 0，白沫跟著看不見）
    '  al*=1.0-smoothstep(0.6+0.38*nz,0.68+0.38*nz,vF); if(al<0.01) discard; }\n' +
    (rip ? WRW_RIP_FOAM : '') + ' if(uX>0.5) c=mix(c,vec3(0.2,0.6,0.95),0.45);\n' +
    ' float fd=length(vW-uEye); o=vec4(mix(c,uFog,1.0-exp(-fd*uFogD)),al); }\n'; }
  P.pool = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec4 aP; layout(location=1) in float aZ0; uniform mat4 uModel,uVP; uniform float uMix,uVox; out vec3 vW; out float vF; out vec2 vG; void main(){ vec4 w=uModel*vec4(aP.xy,mix(aZ0,aP.z,uMix),1.0); vW=w.xyz; vF=aP.w; vG=aP.xy*uVox; gl_Position=uVP*w; }\n',
    poolFS(false));
  P.wpool = VK.compile(gl, WRW_VS, poolFS(true));                               // 房間的水面（TASK-0811）：頂點帶世界高度、照船現在的姿態換回船上的 z
  P.wvol = VK.compile(gl, WRV_VS, WRV_FS);                                      // 透視的水：體積（63_wrwater_gl.js wrvDraw）
  // 水幕（flFalls）：一道 ＝ 一片直立、繞船的鉛直軸轉向鏡頭的長條；aP 軸上那一點（格座標）、aQ ＝ (左右 ±1、0 上 1 下、長度 m、寬度 m 的上一格)、aW ＝ 這一格的寬度 m
  P.fall = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec4 aQ; layout(location=2) in float aW; uniform mat4 uModel,uVP; uniform vec3 uEye; uniform float uMix; out vec3 vW; out vec2 vT; out float vL;\n' +
    'void main(){ vec4 w=uModel*vec4(aP,1.0); vec3 ax=normalize(mat3(uModel)*vec3(0.0,0.0,1.0)), r=cross(ax,uEye-w.xyz); float l=length(r); r=l>1e-4?r/l:vec3(1.0,0.0,0.0);\n' +
    ' w.xyz+=r*aQ.x*0.5*mix(aQ.w,aW,uMix); vW=w.xyz; vT=aQ.xy; vL=aQ.z; gl_Position=uVP*w; }\n',
    '#version 300 es\nprecision highp float; in vec3 vW; in vec2 vT; in float vL; uniform vec3 uEye,uFog,uSky; uniform float uFogD,uSeaT,uX; out vec4 o;\n' +
    'void main(){ float u=vT.x, v=vT.y, k=floor((u+1.0)*3.5); float st=0.5+0.5*sin(v*vL*7.0-uSeaT*11.0+k*1.9)*sin(v*vL*2.3-uSeaT*5.0+k*0.7);\n' +   // 往下捲的條紋（每一條相位不同）
    ' vec3 c=mix(vec3(0.1,0.3,0.34),uSky*0.8+vec3(0.12),0.25+0.45*st); if(uX>0.5) c=mix(c,vec3(0.2,0.6,0.95),0.45);\n' +
    ' float a=(0.55+0.3*st)*(1.0-smoothstep(0.55,1.0,abs(u)))*smoothstep(0.0,0.06,v);\n' +
    ' float fd=length(vW-uEye); o=vec4(mix(c,uFog,1.0-exp(-fd*uFogD)),a); }\n');
  // 水面的側面與水瀑（flSides；TASK-0654）：沿水格的邊直立的一片（格座標，不轉向鏡頭）；aQ ＝ (沿邊 0–1、0 上 1 下、高 m、種類：0 側面 1 水瀑)
  P.pside = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec4 aQ; uniform mat4 uModel,uVP; out vec3 vW; out vec4 vQ;\n' +
    'void main(){ vec4 w=uModel*vec4(aP,1.0); vW=w.xyz; vQ=aQ; gl_Position=uVP*w; }\n',
    '#version 300 es\nprecision highp float; in vec3 vW; in vec4 vQ; uniform vec3 uEye,uFog,uSky; uniform float uFogD,uSeaT,uX,uDep; uniform vec2 uView; uniform sampler2D uSceneD; out vec4 o;\n' + FL_DEP_GLSL +
    'void main(){ float u=vQ.x, v=vQ.y, L=vQ.z, k=vQ.w, ks=floor(u*6.0); float st=0.5+0.5*sin(v*L*7.0-uSeaT*11.0+ks*1.9)*sin(v*L*2.3-uSeaT*5.0+ks*0.7);\n' +
    ' vec3 c=vec3(0.07,0.24,0.27)*(0.8+0.2*(1.0-v)); float a=0.72;\n' +
    ' if(k>0.5){ c=mix(c,uSky*0.8+vec3(0.12),0.25+0.45*st); a=0.5+0.3*st; }\n' +                  // 水瀑：往下捲的條紋（同 P.fall）
    ' if(uDep>0.5&&uX<0.5){ vec2 da=flDep(c,a); if(k<0.5){ c=flDepC; a=da.x; } else a*=smoothstep(0.0,0.08,da.y); }\n' +
    ' if(uX>0.5){ c=mix(c,vec3(0.2,0.6,0.95),0.45); a*=0.8; }\n' +
    ' float fd=length(vW-uEye); o=vec4(mix(c,uFog,1.0-exp(-fd*uFogD)),a); }\n');
}
// ── 水幕（TASK-0651；Tim 2026-10-16：「艙內進水 …… 是否可以連接正在往下流動的水(類似瀑布效果)」）──
//   模擬裡水往下一層流是直接搬水量（flTick 第 2 步）⇒ 畫面上上下兩池是斷開的兩片。這裡照 flTick 記的往下流量（fl.dq，只記不改）每一格畫一道：
//   · 開口：那一格擋水的那一層（開著的比例最小、而且 < FLF_OPEN）裡空著的格（艙口、打穿的洞）—— 中心、寬（快取 fl.fo，那一格被打壞就重找）；整層都開著（艙裡的大空間）⇒ 不畫（不是瀑布，是水整團往下）。
//   · 從開口往下沿著格子找：碰到有水面的那一格（這一次的水面高度）或實心的格（地板）就停 ⇒ 上下兩池接起來；走出船殼外形（flInHull，照船型、不看打壞了沒）也停 —— 船殼被打穿的地方 ⛔ 不往船外畫。
//   · 寬 ＝ FLF_W0 ＋ FLF_WK × √流量（m³／秒），夾在開口的寬以內；流量 < FLF_MIN 不畫（上一次有畫的 ⇒ 掉到一半才收，不在門檻上閃）；落差 < FLF_DROP 格不畫（底艙肋骨間那種淺的不算瀑布）。兩次重做之間寬度照 uMix 內插（跟水面同一個骨架）。
//   · 落點冒水花（flPushJets，點精靈）。純畫面：不碰 rnd()、不改水量；畫質設定 GFX.fall 關 ⇒ 不畫。
var FLF_MIN = 0.004, FLF_W0 = 0.25, FLF_WK = 1.0, FLF_OPEN = 0.85, FLF_DROP = 4;
function flFallAt(sh, fl, i) {
  var o = fl.fo.get(i); if (o !== undefined) return o;
  var F = fl.F, c = F.c, ix = i % F.NX, iy = ((i / F.NX) | 0) % F.NY, iz = (i / (F.NX * F.NY)) | 0, best = -1, bl = 2;
  for (var l = 0; l < c; l++) { var f = fl.ol[i * c + l]; if (f >= 0 && f < bl) { bl = f; best = l; } }
  o = null;
  if (best >= 0 && bl < FLF_OPEN && bl > 0) {
    var z = iz * c + best, n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var dx = 0; dx < c; dx++) {
      var x = F.X0 + ix * c + dx; if (x - F.X0 >= F.nxv) break;
      var k = z * F.nxv + x - F.X0; if (F.yP[k] < 0) continue;
      var a = Math.max(F.yM[k] + 1, F.Y0 + iy * c), b = Math.min(F.yP[k] - 1, F.Y0 + iy * c + c - 1);
      for (var y = a; y <= b; y++) if (!sh.grid.get(x, y, z)) { n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (n) o = { x: sx / n + 0.5, y: sy / n + 0.5, z: z + 1, w: (Math.max(x1 - x0, y1 - y0) + 1) * S };
  }
  fl.fo.set(i, o); return o;
}
function flFalls(sh, fl, me, TI, tops) {
  var F = fl.F, M = sh.M, L = me.falls || (me.falls = []), old = new Map(), t, q = 0;
  for (t = 0; t < L.length; t++) old.set(L[t].i, L[t].w);
  L.length = 0;
  var dt = fl.dqT; fl.dqT = 0;
  var fs = me.fst = FL_STAT ? { n: 0, surf: 0, solid: 0, hull: 0, none: 0, out: 0, outMax: 0, at: [] } : null;   // 報表：每一道停在哪（水面／實心格／走出船殼外形／一路到底）、經過幾格船殼外形外的格（flInHull）
  for (t = 0; t < fl.dqL.length; t++) {
    var i = fl.dqL[t], r = dt > 0 ? fl.dq[i] / dt : 0; fl.dq[i] = 0; fl.dqOn[i] = 0;
    if (!GFX.fall || r < FLF_MIN * (old.has(i) ? 0.5 : 1)) continue;
    var at = flFallAt(sh, fl, i); if (!at) continue;
    var X = Math.floor(at.x), Y = Math.floor(at.y), z1 = 0, how = 'none';
    for (var z = at.z - 2; z >= 0; z--) {                                 // 往下找落點：有水面的那一格（水面以下）、實心的格，或走出船殼外形（打穿的船殼）
      var k = flCell(F, at.x, at.y, z), ti = k >= 0 ? TI[k] : -1;
      if (ti >= 0) { var zs = (tops[ti + 1] - (M[1] * at.x + M[5] * at.y + M[13])) / M[9]; if (z <= zs) { z1 = Math.max(z, zs); how = 'surf'; break; } }
      if (!flInHull(F, X, Y, z)) { z1 = z + 1; how = 'hull'; break; }   // ⛔ 以前沒看外形：開口底下的船殼被打穿 ⇒ 一路畫到 z 0，從船底下面穿出去（Tim 2026-10-17）
      if (sh.grid.get(X, Y, z)) { z1 = z + 1; how = 'solid'; break; }
    }
    if (at.z - z1 < FLF_DROP) continue;
    if (fs) {
      var xo = 0;
      for (var zq = at.z - 1; zq >= Math.ceil(z1); zq--) if (!flInHull(F, X, Y, zq)) xo++;
      fs.n++; fs[how]++; if (xo) fs.out++; if (xo > fs.outMax) fs.outMax = xo; if (xo && fs.at.length < 8) fs.at.push([X, Y, at.z, +z1.toFixed(2), how, xo]);
    }
    var w = clamp(FLF_W0 + FLF_WK * Math.sqrt(r), FLF_W0, Math.max(FLF_W0, at.w)), w0 = old.has(i) ? old.get(i) : w;
    L.push({ i: i, x: at.x, y: at.y, z0: at.z, z1: z1, w: w, w0: w0, r: r });
  }
  fl.dqL.length = 0;
  var B = me.fbuf && me.fbuf.length >= L.length * 48 ? me.fbuf : (me.fbuf = new Float32Array(Math.max(48 * 16, L.length * 96)));   // 每道 6 個頂點 × (3 ＋ 4 ＋ 1)
  for (t = 0; t < L.length; t++) {
    var f = L[t], len = (f.z0 - f.z1) * S, V = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
    for (var e = 0; e < 6; e++) { var s = V[e][0], v = V[e][1], o = q * 8; B[o] = f.x; B[o + 1] = f.y; B[o + 2] = v ? f.z1 : f.z0; B[o + 3] = s; B[o + 4] = v; B[o + 5] = len; B[o + 6] = f.w0; B[o + 7] = f.w; q++; }
  }
  if (!me.fvao) {
    me.fvao = gl.createVertexArray(); me.fvb = gl.createBuffer(); me.fcap = 0;
    gl.bindVertexArray(me.fvao); gl.bindBuffer(gl.ARRAY_BUFFER, me.fvb);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
  }
  gl.bindVertexArray(me.fvao); gl.bindBuffer(gl.ARRAY_BUFFER, me.fvb);
  if (q * 8 > me.fcap) { me.fcap = B.length; gl.bufferData(gl.ARRAY_BUFFER, me.fcap * 4, gl.DYNAMIC_DRAW); }
  if (q) gl.bufferSubData(gl.ARRAY_BUFFER, 0, B, 0, q * 8);
  gl.bindVertexArray(null);
  me.fn = q;
}
/** 艙內水面的網格（格座標，每個頂點 [x, y, z, 裝了幾成, 上一格的 z]）：水格有算過、而且離上次重做過了 FL_MESH_MS 才重做（關鍵格）。
 *  Tim 2026-10-15：「水的網格更新(顯示變動)不用完全跟模擬同步」「水網格是否可以加入類似骨架的概念去微調(中間變化用內插)」「更新頻率可以更低」——
 *    模擬照算；畫面每 FL_MESH_MS 毫秒（真實時間）做一格關鍵格，兩格之間著色器照 uMix 從上一格的高度內插過去（⛔ 每次水格算完就重做 ⇒ 粗檔每 4 步、細檔每 2 步重建一次）。
 *    拓撲（哪幾格、每格切成哪幾片）跟上一格一樣 ⇒ 從畫面上現在的高度接著內插（水面慢慢升降）；不一樣（新的格進水、水退了）⇒ 直接換。
 *  代價：畫面的水比模擬晚最多一格；兩格之間船晃動，水面跟著船斜一下（網格在船的座標裡）。 */
var FL_MESH_MS = 500, FL_FLAT = 0;
// 跨水體相連（TASK-0654 第二輪；Tim 2026-10-16：「兩片水之間有高低差 沒有瀑布遮擋」「應該要變成一整片水體mesh才對」「或是可以跨水體相連(mesh平滑過度)」）：
//   FL_JOIN（公尺）：相鄰水面差在這以內 ⇒ 同一個水體（⛔ 以前差半格就分成兩池，各自一個平面 ⇒ 憲法號細檔破口邊 0.66–0.69 m 的落差中間露出一條地板）；甲板上下兩層差得比這遠，不會連起來。
//   FL_FLAT 0：角高 ＝ 這一角四周、同一個水體的水面平均，再跟鄰角平均 FL_SMOOTH 次 ⇒ 落差變成連續的斜坡（同一個角兩邊共用，不會裂）；平的地方照舊是平的。
//   FL_THIN：水格裝了幾成以上才畫水面（以前 0.02；太淺的照樣畫、交給深度吸光淡出 ⇒ 兩片水中間那條「薄水」帶也接得起來）。
var FL_JOIN = 1.2, FL_SMOOTH = 1, FL_THIN = 0.002;
var FLE_DEEP = 0.4;                                                         // 水邊（flEdgeM）：水深到這裡（m）以上 ⇒ 只上白沫、不吃邊
var FL_FLOOR = Q.get('flfloor') !== '0';                                  // ?flfloor=0：側面不看自己這一欄的地板（2026-10-16 以前）—— 前後對照用
if (Q.get('fljoin') === '0') { FL_FLAT = 1; FL_JOIN = -1; FL_SMOOTH = 0; FL_THIN = 0.02; }   // ?fljoin=0：舊的畫法（差半格就分池、每池一個平面）—— 前後對照用
// 量測（TASK-0654；只給 81_floodlab.js 的進水報表，平常兩個都是 false ⇒ 一位元都不多算）：
//   FL_SNAP ＝ 每次都重做、不內插（截圖跟那一刻的水對得上）；FL_STAT ＝ 每次重做順便分類接縫（me.stat）。
var FL_SNAP = false, FL_STAT = false;
function flMesh(sh, fl) {
  var F = fl.F, c = F.c, NX = F.NX, NY = F.NY, NXY = NX * NY, A = fl.A, cap = fl.cap, M = sh.M, Vc = Math.pow(c * S, 3), hc = c * S;
  var me = fl.mesh || (fl.mesh = { vao: gl.createVertexArray(), vb: gl.createBuffer(), buf: new Float32Array(6 * 5 * 512), old: new Float32Array(6 * 5 * 512), sig: [], n: 0, cap: 0, gen: -1, tw: -1e9 });
  var now = performance.now();
  if (me.gen === fl.gen || (!FL_SNAP && me.n && now - me.tw < FL_MESH_MS)) return me;   // 還沒有網格（剛開始進水）⇒ 馬上做
  var mix0 = me.n ? flMix(me) : 1, oldN = me.n, oldSig = me.sig, tmp = me.old; me.old = me.buf; me.buf = tmp.length >= me.old.length ? tmp : new Float32Array(me.old.length); me.sig = [];   // 舊的那一格留著（接著內插用）
  me.tw = now;
  var h0 = M[1] * (F.X0 + 0.5 * c) + M[5] * (F.Y0 + 0.5 * c) + M[13], q = 0, t, i, u;
  // 每一格水面（上面那一格沒水的）的世界高度：水照層疊上去（flLevel）⇒ ⛔ 照「裝了幾成 × 格高」⇒ 只有底下一層空著的格（船殼彎進來、甲板梁）裝滿了水面畫在整格的頂，浮在半空
  var TI = me.ti && me.ti.length === F.N ? me.ti : (me.ti = new Int32Array(F.N).fill(-1)), tops = me.tops || (me.tops = []), S3 = S * S * S, op = fl.op;
  for (t = 0; t < tops.length; t += 2) TI[tops[t]] = -1; tops.length = 0;
  for (t = 0; t < fl.actN; t++) {
    i = fl.act[t]; if (!(cap[i] > 0.02) || A[i] < FL_THIN * cap[i] * Vc) { if (FL_STAT && A[i] > 1e-6) (me.thin || (me.thin = [])).push(i); continue; }   // thin：有水但太薄、沒畫（接縫地圖用）
    u = i + NXY; if (u < F.N && cap[u] > 0.02 && A[u] >= FL_THIN * cap[u] * Vc) continue;          // 上面那一格也有水 ⇒ 不是水面
    var ix = i % NX, iy = ((i / NX) | 0) % NY, iz = (i / NXY) | 0, W = A[i] / S3, hl = 0;
    for (var l = 0; l < c && W > 1e-6; l++) { var o = op[i * c + l]; if (o <= 0) continue; if (W >= o) { W -= o; hl = l + 1; } else { hl = l + W / o; W = 0; } }   // 空著 0 格的那一層（甲板）水過不去也不停在那裡 ⇒ 跳過
    if (W > 1e-6) hl = c;
    var hw = M[1] * (F.X0 + (ix + 0.5) * c) + M[5] * (F.Y0 + (iy + 0.5) * c) + M[9] * (iz * c + hl) + M[13];
    TI[i] = tops.length; tops.push(i, hw);
  }
  flFalls(sh, fl, me, TI, tops);                                          // 往下流的水幕（跟水面同一格重做）
  // 連成一池（Tim 2026-10-15：「角度有平滑 但是沒有接起來」）：左右前後相鄰（同一層或差一層）、水面差在 FL_JOIN 以內 ⇒ 同一池（水體；2026-10-16 以前是半格）。
  //   同一池裡每個角只算一次（那個角周圍四格裡、這一池的水面平均）⇒ 相鄰兩格用的是同一個角 ⇒ 一定接得起來。
  //   ⛔ 以前每一格自己算四個角（周圍水柱裡、跟「這一格」差不到半格的平均）⇒ 同一個角兩邊各算各的、高度不一樣 ⇒ 每一片都斜得平順，片跟片之間裂開。
  var TN = tops.length / 2, par = new Int32Array(TN);
  for (t = 0; t < TN; t++) par[t] = t;
  function root(a) { while (par[a] !== a) a = par[a] = par[par[a]]; return a; }
  for (t = 0; t < TN; t++) {
    i = tops[t * 2]; var jx0 = i % NX, jy0 = ((i / NX) | 0) % NY;
    for (var nb = 0; nb < 2; nb++) {
      if (nb ? jy0 >= NY - 1 : jx0 >= NX - 1) continue;
      for (var dzn = -1; dzn <= 1; dzn++) {
        var jn = i + (nb ? NX : 1) + dzn * NXY; if (jn < 0 || jn >= F.N) continue;
        var tj = TI[jn]; if (tj < 0 || Math.abs(tops[tj + 1] - tops[t * 2 + 1]) >= (FL_JOIN < 0 ? 0.5 * hc : FL_JOIN)) continue;
        var ra = root(t), rb = root(tj / 2); if (ra !== rb) par[ra] = rb;
      }
    }
  }
  var CS = new Map(), NC = (NX + 1) * (NY + 1);                           // 角 (ix, iy) × 池 ⇒ [水面加總, 幾格]
  for (t = 0; t < TN; t++) {
    i = tops[t * 2]; var r0 = root(t), qx = i % NX, qy = ((i / NX) | 0) % NY;
    for (var cc = 0; cc < 4; cc++) {
      var key = r0 * NC + (qy + (cc >> 1)) * (NX + 1) + qx + (cc & 1), e = CS.get(key);
      if (e) { e[0] += tops[t * 2 + 1]; e[1]++; } else CS.set(key, [tops[t * 2 + 1], 1]);
    }
  }
  var PS = new Float64Array(TN), PN = new Int32Array(TN);                 // 每一池的水面平均
  for (t = 0; t < TN; t++) { var rp = root(t); PS[rp] += tops[t * 2 + 1]; PN[rp]++; }
  var CV = new Map(); CS.forEach(function (e, k) { CV.set(k, e[0] / e[1]); });
  for (var it = 0; it < FL_SMOOTH; it++) {                                // 跟同一個水體的上下左右鄰角平均 ⇒ 落差攤到兩格寬
    var CV2 = new Map();
    CV.forEach(function (v, k) {
      var cx0 = (k % NC) % (NX + 1), rr = (k / NC) | 0, sm = v, nn = 1, nk = [cx0 > 0 ? k - 1 : -1, cx0 < NX ? k + 1 : -1, k - (NX + 1), k + (NX + 1)];
      for (var q2 = 0; q2 < 4; q2++) { if (nk[q2] < 0 || ((nk[q2] / NC) | 0) !== rr) continue; var w2 = CV.get(nk[q2]); if (w2 !== undefined) { sm += w2; nn++; } }
      CV2.set(k, sm / nn);
    });
    CV = CV2;
  }
  function corner(r, ix, iy) { return FL_FLAT * PS[r] / PN[r] + (1 - FL_FLAT) * CV.get(r * NC + iy * (NX + 1) + ix); }
  var ST = FL_STAT ? flSeams(F, cap, TI, tops, root) : null;
  if (ST) { ST.thin = (me.thin || []).map(function (k) { return [k % NX, ((k / NX) | 0) % NY]; }); me.thin = null; }
  // 每格切成 KS × KS 小片（約 2 格見方；Tim 2026-10-15：「進水顯示是否能嘗試跟鄰近的水表面合併成柔和曲面」）：高度照四個角（已跟鄰格平均）雙線性內插 ⇒ 相鄰的水面連成平順的一片；
  //   每一小片照中心那一點在不在兩舷船殼之間（flType 的 yM／yP，那個高度那一欄）⇒ 不在就不畫（Tim：「船殼外部也能進水」—— ⛔ 整格畫一塊 ⇒ 靠船殼那幾格的正方形伸出船外，最多 c − 1 格）。
  var KS = Math.max(1, Math.round(c / 2)), sc = c / KS, nxv = F.nxv, YP = F.yP, YM = F.yM, ZT = F.zTop, TRI6 = [0, 1, 2, 0, 2, 3];
  function bil(H, u, v) { return (H[0] * (1 - u) + H[1] * u) * (1 - v) + (H[3] * (1 - u) + H[2] * u) * v; }
  var INS = new Uint8Array(KS * KS);
  /** 格座標 (x, y)、水面世界高度 hw 那一點在不在兩舷船殼之間（那個高度那一欄）。 */
  function flInside(x, y, hw) {
    var z = Math.floor(clamp((hw - (M[1] * x + M[5] * y + M[13])) / M[9], 0, ZT - 1)), X = Math.floor(x), Y = Math.floor(y), kk = z * nxv + X - F.X0;
    return X >= F.X0 && X - F.X0 < nxv && YP[kk] >= 0 && Y > YM[kk] && Y < YP[kk] ? 1 : 0;
  }
  // 水邊（TASK-0654；Tim 2026-10-16：「水的邊緣是否能做一點不規則變化(用noise算法?) 演出用」；GFX.pedge）：這一格四邊（−x、+x、−y、+y）各是不是「開著的水邊」——
  //   鄰格裝得了水、但上下一層內都沒有水面（水攤開到一半的那一邊）⇒ 值 ＝ 0.35 ＋ 0.65 × 淺的程度（這一欄水深 0 → 1、FLE_DEEP 以上 → 0）；牆、同一池、別的池（有側面或水瀑）⇒ 0。
  //   著色器照這個值（邊上 → 往內一片內插到 0）加白沫、把淺的那幾邊照 noise 吃進去一點；深的邊只上白沫（⛔ 吃進去 ⇒ 水面跟側面分家）。
  function flEdgeM(i, jx, jy, jz, rt, hw) {
    var R = [0, 0, 0, 0]; if (!GFX.pedge) return R;
    var dep = -1;
    for (var d = 0; d < 4; d++) {
      var nx = jx + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = jy + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
      var has = false; for (var k = -1; k <= 1 && !has; k++) { var jz2 = jz + k; if (jz2 >= 0 && jz2 < F.NZ && TI[jz2 * NXY + ny * NX + nx] >= 0) has = true; }
      if (has || !(cap[jz * NXY + ny * NX + nx] > 0.02)) continue;
      if (dep < 0) {                                                       // 這一欄的水深（公尺）：從水面往下數開著的格層，碰到關著的（地板）或沒水的格就停
        var zs = (hw - (M[1] * (F.X0 + (jx + 0.5) * c) + M[5] * (F.Y0 + (jy + 0.5) * c) + M[13])) / M[9], zz = Math.floor(zs) - 1, n = 0;
        while (zz >= 0 && n < FLE_DEEP / S + 1) { var cz = (zz / c) | 0, ci = cz * NXY + jy * NX + jx; if (op[ci * c + zz - cz * c] <= 0 || !(A[ci] > 0)) break; zz--; n++; }
        dep = Math.max(0, zs - (zz + 1)) * S;
      }
      R[d] = 0.35 + 0.65 * clamp(1 - dep / FLE_DEEP, 0, 1);
    }
    return R;
  }
  for (t = 0; t < tops.length; t += 2) {
    i = tops[t]; var hw0 = tops[t + 1], jx = i % NX, jy = ((i / NX) | 0) % NY, jz = (i / NXY) | 0, f = Math.min(1, A[i] / (cap[i] * Vc));
    var x0 = F.X0 + jx * c, y0 = F.Y0 + jy * c, zl = jz * c - (FL_JOIN < 0 ? 1 : 3) * c, zh = jz * c + (FL_JOIN < 0 ? 2 : 4) * c, rt = root(t / 2);   // zl／zh：只防呆（同一個水體相鄰的差在 FL_JOIN 以內 ⇒ 細檔 1.2 m ≈ 2.4 格 ⇒ 角落在這一格下 3 格、上 4 格以內；夾到了才會裂）
    var H = [corner(rt, jx, jy), corner(rt, jx + 1, jy), corner(rt, jx + 1, jy + 1), corner(rt, jx, jy + 1)];
    var EM = flEdgeM(i, jx, jy, jz, rt, hw0);
    if ((q + 6 * KS * KS) * 5 > me.buf.length) { var nb = new Float32Array(Math.max(me.buf.length * 2, (q + 6 * KS * KS) * 10)); nb.set(me.buf); me.buf = nb; }
    var inn = 0; for (var a = 0; a < KS; a++) for (var b = 0; b < KS; b++) if ((INS[a * KS + b] = flInside(x0 + (a + 0.5) * sc, y0 + (b + 0.5) * sc, bil(H, (a + 0.5) / KS, (b + 0.5) / KS)))) inn++;
    if (ST) { var mt = ST.map.top[t / 2]; if (!inn) { ST.outTops++; mt[4] = 2; } else if (inn < KS * KS) { ST.cutTops++; ST.cutPieces += KS * KS - inn; mt[4] = 1; } }
    if (!inn) continue;
    var G = inn === KS * KS ? Math.min(2, KS) : KS, gs = c / G;               // 整格都在船殼裡 ⇒ 2 × 2 就夠（⛔ 每格都細切 ⇒ 粗檔維吉尼亞號 4,226 → 99,070 個三角形，每次進水更新都重建）；碰到船殼的那幾格才細切、丟掉外面的
    for (a = 0; a < G; a++) for (b = 0; b < G; b++) {
      if (G === KS && !INS[a * KS + b]) continue;                             // 這一片在船殼外（或那一欄沒有船殼）
      var u0 = a / G, u1 = (a + 1) / G, v0 = b / G, v1 = (b + 1) / G; me.sig.push(i * 64 + G * 8 + a * 4 + b);   // sig：拓撲（哪一格、切幾片、第幾片）
      var cs = [[x0 + a * gs, y0 + b * gs, bil(H, u0, v0)], [x0 + (a + 1) * gs, y0 + b * gs, bil(H, u1, v0)], [x0 + (a + 1) * gs, y0 + (b + 1) * gs, bil(H, u1, v1)], [x0 + a * gs, y0 + (b + 1) * gs, bil(H, u0, v1)]];
      for (var e6 = 0; e6 < 6; e6++) {
        var p = cs[TRI6[e6]], z = clamp((p[2] - (M[1] * p[0] + M[5] * p[1] + M[13])) / M[9], zl, zh);   // 同一個世界高度 ⇒ 船傾斜時水面還是平的
        var cu = TRI6[e6] === 1 || TRI6[e6] === 2 ? u1 : u0, cv = TRI6[e6] >= 2 ? v1 : v0;   // 這個角在格裡的位置 ⇒ 落在哪一邊上 ⇒ 那一邊的水邊值（aP.w；邊上 → 往內一片內插到 0）
        var ev = Math.max(cu === 0 ? EM[0] : 0, cu === 1 ? EM[1] : 0, cv === 0 ? EM[2] : 0, cv === 1 ? EM[3] : 0);
        me.buf[q * 5] = p[0]; me.buf[q * 5 + 1] = p[1]; me.buf[q * 5 + 2] = z; me.buf[q * 5 + 3] = ev; me.buf[q * 5 + 4] = z; q++;
      }
    }
  }
  flSides(sh, fl, me, F, tops, TI, root, corner, flInside);
  // 骨架內插（逐片）：這一片上一格也有（同一格、同樣切法、同一片 ⇒ 6 個頂點的 x、y 跟順序都一樣）⇒ 起點 ＝ 它畫面上現在的高度（上一格的起點、終點照 mix0 內插）；
  //   上一格沒有（新進水的格、切法變了）⇒ 起點 ＝ 終點（直接出現）。⛔ 整份網格一樣才接 ⇒ 還在進水時每一格都有新的格進來 ⇒ 一次都接不上（量過 9 次重做 0 次）
  var OM = new Map(), O = me.old, Bf = me.buf, same = 0;
  for (var s = 0; s < oldSig.length; s++) OM.set(oldSig[s], s);
  for (var s2 = 0; s2 < me.sig.length; s2++) {
    var ko = OM.get(me.sig[s2]); if (ko === undefined || (ko + 1) * 6 > oldN) continue;
    same++;
    for (var v = 0; v < 6; v++) { var vo = (ko * 6 + v) * 5, vn = (s2 * 6 + v) * 5; Bf[vn + 4] = O[vo + 4] + (O[vo + 2] - O[vo + 4]) * mix0; }
  }
  gl.bindVertexArray(me.vao); gl.bindBuffer(gl.ARRAY_BUFFER, me.vb);
  if (q * 5 > me.cap) { me.cap = me.buf.length; gl.bufferData(gl.ARRAY_BUFFER, me.cap * 4, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16); }
  if (q) gl.bufferSubData(gl.ARRAY_BUFFER, 0, me.buf, 0, q * 5);
  gl.bindVertexArray(null);
  me.n = q; me.gen = fl.gen; me.same = same; me.quads = me.sig.length; me.ms = performance.now() - now; if (ST) me.stat = ST; return me;   // same：這一次接著內插的片數；ms：這一次重做花幾毫秒
}
/** 接縫分類（FL_STAT；TASK-0654 先量再動手）：每一塊水面（tops）往前後左右看鄰格 ——
 *  join 同一池（接得起來）／step 別的池（兩池水面差 ≥ 半格 ⇒ 兩片平面之間沒有面 ⇒ 縫；每一側各算一次，dh 記水面差 m）／
 *  open 鄰格裝得了水但沒有水面（水面邊上懸空的那一邊）／wall 鄰格裝不了水（牆、甲板、船殼外、出界）。
 *  cutTops／cutPieces（在 flMesh 裡數）：靠船殼、丟掉幾片小片的水面；outTops：整塊都在船殼外、沒畫。 */
function flSeams(F, cap, TI, tops, root) {
  var NX = F.NX, NY = F.NY, NXY = NX * NY, TN = tops.length / 2, st = { tops: TN, pools: 0, join: 0, step: 0, open: 0, wall: 0, dh: [], cutTops: 0, cutPieces: 0, outTops: 0, map: { NX: NX, NY: NY, top: [], edge: [] } }, t;   // map：接縫地圖（81_floodlab.js 畫）
  for (t = 0; t < TN; t++) if (root(t) === t) st.pools++;
  for (t = 0; t < TN; t++) {
    var i = tops[t * 2], ix = i % NX, iy = ((i / NX) | 0) % NY, iz = (i / NXY) | 0, r = root(t);
    st.map.top.push([ix, iy, iz, r, 0]);                                  // 最後一格：0 整塊畫、1 船殼邊切掉幾片、2 整塊沒畫（flMesh 填）
    for (var d = 0; d < 4; d++) {
      var jx = ix + (d === 0 ? -1 : d === 1 ? 1 : 0), jy = iy + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (jx < 0 || jy < 0 || jx >= NX || jy >= NY) { st.wall++; continue; }
      var j0 = iz * NXY + jy * NX + jx, tj = -1;
      for (var k = 0; k < 3 && tj < 0; k++) { var jz = iz + (k === 0 ? 0 : k === 1 ? -1 : 1); if (jz >= 0 && jz < F.NZ && TI[jz * NXY + jy * NX + jx] >= 0) tj = TI[jz * NXY + jy * NX + jx] / 2; }
      if (tj >= 0) { if (root(tj) === r) st.join++; else { st.step++; st.dh.push(Math.abs(tops[tj * 2 + 1] - tops[t * 2 + 1])); st.map.edge.push([ix, iy, d, 1, tops[t * 2 + 1] - tops[tj * 2 + 1], tops[t * 2 + 1]]); } }   // 兩池交界：[ix, iy, 方向, 1, 這邊比鄰池高多少 m, 這邊的水面世界高度]
      else if (cap[j0] > 0.02) { st.open++; st.map.edge.push([ix, iy, d, 2]); } else st.wall++;
    }
  }
  return st;
}
// ── 水面的側面與水瀑（TASK-0654；Tim 2026-10-16：「接縫處直接當成往下的水流貼一片 目前這樣看起來像浮空的一片透明片」；畫質選項 GFX.pside）──
//   跟水面同一次重做（flMesh 呼叫），每一塊水面往前後左右看（同 flSeams 的分法）：
//   · 兩池交界、鄰池的水面比較低 ⇒ 從這一池的水面往下接到鄰池的水面；這段時間這條邊有水往外流（fl.lq ÷ fl.lqT ≥ FLS_MIN m³／秒）⇒ 水瀑（往下捲的條紋），沒有 ⇒ 側面。
//   · 懸空的邊（鄰格裝得了水但沒有水面）⇒ 從水面往下到這一格的水底（往下找滿的水格、再到那一格最下面空著的那層）。
//   · 鄰格是牆、甲板、船殼外 ⇒ 不畫；邊的中點（往格內退 0.5 格）在船殼外 ⇒ 不畫；高不到 0.3 格（3 cm）⇒ 不畫。
//   頂 ＝ 這一池的角（corner，跟水面同一個值）⇒ 側面頂跟水面接得起來。⚠ 側面不跟著水面的骨架內插：兩次重做之間（FL_MESH_MS）水面在升降，側面頂跟水面最多差那一段的升降量。
//   只動畫面：fl.lq 是 flTick 只記不讀的流量帳；每次重做讀完就清。
var FLS_MIN = 0.002, FL_DEPBLIT = 0;                                      // FL_DEPBLIT：深度吸光為了讀深度另外複製了幾次（量成本用）
function flSides(sh, fl, me, F, tops, TI, root, corner, flInside) {
  var c = F.c, NX = F.NX, NY = F.NY, NXY = NX * NY, A = fl.A, cap = fl.cap, op = fl.op, M = sh.M, Vc = Math.pow(c * S, 3), lqT = fl.lqT, t;
  var sq = 0, sideN = 0, fallN = 0, SB = me.sbuf || (me.sbuf = new Float32Array(7 * 6 * 256));
  var ss = me.sst = { n: 0, max: 0, at: null, xo: 0, xf: 0, xn: 0, xoMax: 0 };
  function gz(x, y, hw) { return (hw - (M[1] * x + M[5] * y + M[13])) / M[9]; }   // 世界高度 ⇒ 那一點的格 z
  if (GFX.pside) for (t = 0; t < tops.length; t += 2) {
    var i = tops[t], sx = i % NX, sy = ((i / NX) | 0) % NY, sz = (i / NXY) | 0, rs = root(t / 2), bx = F.X0 + sx * c, by = F.Y0 + sy * c;
    for (var d = 0; d < 4; d++) {
      var nx = sx + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = sy + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
      var tj = -1; for (var k = 0; k < 3 && tj < 0; k++) { var jz = sz + (k === 0 ? 0 : k === 1 ? -1 : 1), q0 = jz * NXY + ny * NX + nx; if (jz >= 0 && jz < F.NZ && TI[q0] >= 0) tj = TI[q0] / 2; }
      var hw = null, zf = 0;                                               // 底：鄰池的水面（世界高度）或這一格的水底（格 z）
      if (tj >= 0) { if (root(tj) === rs || tops[tj * 2 + 1] >= tops[t + 1] - 0.02) continue; hw = tops[tj * 2 + 1]; }
      else {
        if (!(cap[sz * NXY + ny * NX + nx] > 0.02)) continue;
        var kb = i; while (kb - NXY >= 0 && cap[kb - NXY] > 0.02 && A[kb - NXY] >= 0.98 * cap[kb - NXY] * Vc) kb -= NXY;
        var lb = 0; while (lb < c - 1 && op[kb * c + lb] <= 0) lb++; zf = ((kb / NXY) | 0) * c + lb;
      }
      var x0, y0, x1, y1, ha, hb;                                          // 邊的兩端（格座標）與兩端的水面（這一池的角）
      if (d === 0) { x0 = x1 = bx; y0 = by; y1 = by + c; ha = corner(rs, sx, sy); hb = corner(rs, sx, sy + 1); }
      else if (d === 1) { x0 = x1 = bx + c; y0 = by; y1 = by + c; ha = corner(rs, sx + 1, sy); hb = corner(rs, sx + 1, sy + 1); }
      else if (d === 2) { y0 = y1 = by; x0 = bx; x1 = bx + c; ha = corner(rs, sx, sy); hb = corner(rs, sx + 1, sy); }
      else { y0 = y1 = by + c; x0 = bx; x1 = bx + c; ha = corner(rs, sx, sy + 1); hb = corner(rs, sx + 1, sy + 1); }
      if (!flInside((x0 + x1) / 2 + (d === 0 ? 0.5 : d === 1 ? -0.5 : 0), (y0 + y1) / 2 + (d === 2 ? 0.5 : d === 3 ? -0.5 : 0), (ha + hb) / 2)) continue;
      var za = gz(x0, y0, ha), zb = gz(x1, y1, hb), za1 = hw === null ? zf : gz(x0, y0, hw), zb1 = hw === null ? zf : gz(x1, y1, hw);
      var kind = lqT > 0 && fl.lq[i * 4 + d] / lqT >= FLS_MIN ? 1 : 0;
      if (!kind && FL_FLOOR) {                                             // 一般側面只畫到自己這一欄的地板（2026-10-16 量：上層甲板的水挨著較低的鄰池 ⇒ 側面一路畫到鄰池水面、穿過上層甲板，維吉尼亞號中檔 13 片、最多 15 層）；水瀑（kind 1）照舊落到下面的水面
        var zf2 = -1; for (var zz2 = Math.floor(Math.max(za, zb)) - 1; zz2 >= 0 && zz2 > Math.min(za1, zb1) - 1; zz2--) { var cz2 = (zz2 / c) | 0; if (cz2 < F.NZ && op[(cz2 * NXY + sy * NX + sx) * c + zz2 - cz2 * c] <= 0) { zf2 = zz2 + 1; break; } }
        if (zf2 > za1) za1 = Math.min(zf2, za); if (zf2 > zb1) zb1 = Math.min(zf2, zb);
      }
      if (za - za1 < 0.3 && zb - zb1 < 0.3) continue;
      var Lm = Math.max(za - za1, zb - zb1) * S;
      if (kind) fallN++; else sideN++;
      if (FL_STAT) {                                                       // 報表：這片側面多高、從水面往下經過幾層關著的格層（自己這一欄／鄰欄；甲板或船殼外）
        var zl = Math.max(0, Math.floor(Math.min(za1, zb1))), zh = Math.floor(Math.max(za, zb)) - 1, xo = 0, xn = 0;
        for (var zz = zl; zz <= zh; zz++) { var cz = (zz / c) | 0, ll = zz - cz * c; if (cz >= F.NZ) break;
          if (!((zz + 1 > za1 + 0.01 && zz < za - 0.01) || (zz + 1 > zb1 + 0.01 && zz < zb - 0.01))) continue;   // 照兩端各自的範圍（⛔ 不用外框：一端收到地板、另一端沒收時外框會多算）
          if (op[(cz * NXY + sy * NX + sx) * c + ll] <= 0) xo++; if (op[(cz * NXY + ny * NX + nx) * c + ll] <= 0) xn++; }
        ss.n++; if (Lm > ss.max) { ss.max = Lm; ss.at = [sx, sy, d, sz]; } if (xo && !kind) (ss.xoAt || (ss.xoAt = [])).push([sx, sy, d, sz, xo, +za.toFixed(2), +zb.toFixed(2), +za1.toFixed(2), +zb1.toFixed(2), hw === null ? 0 : 1]); if (xo) { if (kind) ss.xf++; else ss.xo++; } if (xn) ss.xn++; if (xo > ss.xoMax) ss.xoMax = xo;
      }
      if ((sq + 6) * 7 > SB.length) { var SB2 = new Float32Array(SB.length * 2); SB2.set(SB); SB = me.sbuf = SB2; }
      var V = [[x0, y0, za, 0, 0], [x1, y1, zb, 1, 0], [x1, y1, zb1, 1, 1], [x0, y0, za, 0, 0], [x1, y1, zb1, 1, 1], [x0, y0, za1, 0, 1]];
      for (var e = 0; e < 6; e++) { var o = sq * 7, p = V[e]; SB[o] = p[0]; SB[o + 1] = p[1]; SB[o + 2] = p[2]; SB[o + 3] = p[3]; SB[o + 4] = p[4]; SB[o + 5] = Lm; SB[o + 6] = kind; sq++; }
    }
  }
  fl.lq.fill(0); fl.lqT = 0;
  if (!me.svao) {
    me.svao = gl.createVertexArray(); me.svb = gl.createBuffer(); me.scap = 0;
    gl.bindVertexArray(me.svao); gl.bindBuffer(gl.ARRAY_BUFFER, me.svb);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  }
  gl.bindVertexArray(me.svao); gl.bindBuffer(gl.ARRAY_BUFFER, me.svb);
  if (sq * 7 > me.scap) { me.scap = SB.length; gl.bufferData(gl.ARRAY_BUFFER, me.scap * 4, gl.DYNAMIC_DRAW); }
  if (sq) gl.bufferSubData(gl.ARRAY_BUFFER, 0, SB, 0, sq * 7);
  gl.bindVertexArray(null);
  me.sn = sq; me.sideN = sideN; me.fallN = fallN;
}
/** 這一格內插到哪（0 ＝ 上一格的高度、1 ＝ 這一格的）；FL_SNAP ⇒ 直接 1（報表截圖）。 */
function flMix(me) { return FL_SNAP ? 1 : clamp((performance.now() - me.tw) / FL_MESH_MS, 0, 1); }
/** 畫艙內的水面（海與白沫之後；開始沉、斷了就不畫 —— 那時候海已經畫進船艙）。 */
function flDraw() {
  if (!P.pool || FL_HIDE) return;                                           // FL_HIDE：對照用（__game.flood(i, { hide: true })）
  var any = false, fs = [], L = [], R = [];
  SHIPS.forEach(function (sh) {
    var fl = sh.fl; if (!fl || !fl.actN || ((sh.broken || sh.sinkingFinal) && !fl.vis) || sh.sunk) return;   // 沉船的水照畫（floodVis）
    var me = flMesh(sh, fl); if (GFX.fall && me.fn) fs.push([sh, me]);
    if ((GFX.proom || sh.wrs) && sh.T.wrm && sh.M[9] > 0.2 * S) { var wm = wrwMesh(sh); if (wm.n || wrvOn(sh, wm)) R.push([sh, wm]); return; }   // 照房間畫（TASK-0811，63_wrwater_gl.js）：水格的水面、側面不畫（水幕照畫）；翻過去了 ⇒ 照舊；透視 ⇒ 體積（灌滿的房間沒有水面也要畫）
    if (me.n || me.sn) L.push([sh, me]);
  });
  // 深度吸光（GFX.pdep）：要不透明場景的深度 —— 折射開到高（refr 2）⇒ 畫海之前已經複製到 RT.B（60_render.js），直接讀；其他檔 ⇒ 這裡複製一次深度（只在有水要畫的那幾格）。透視開著 ⇒ 不讀（見 FL_DEP_GLSL）。
  var dep = GFX.pdep && !FLX3 && (L.length || R.length) && RT && RT.B ? 1 : 0;
  if (dep && GFX.refr !== 2) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, RT.A.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, RT.B.fb);
    gl.blitFramebuffer(0, 0, RT.w, RT.h, 0, 0, RT.w, RT.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.A.fb); FL_DEPBLIT++;
  }
  function depU(p) { gl.uniform1f(p.u.uDep, dep); gl.uniform2f(p.u.uView, RT.w, RT.h); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, RT.B.dep); gl.uniform1i(p.u.uSceneD, 3); }   // 取樣器一律接到第 3 號（⛔ 留在預設 0 號 ⇒ 可能跟別的型別的取樣器撞同一號，畫不出來）
  function begin() { if (any) return; any = true; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); if (FLX3) gl.disable(gl.DEPTH_TEST); }   // 停格的「🔍 透視」開著 ⇒ 隔著船殼看得到（72_floodui.js）
  var on = false;
  L.forEach(function (e) {
    var sh = e[0], me = e[1]; if (!me.n) return;
    if (!on) { on = true; begin(); gl.useProgram(P.pool.prog); setCommon(P.pool); gl.uniform1f(P.pool.u.uX, FLX3 ? 1 : 0); gl.uniform1f(P.pool.u.uEdge, GFX.pedge && !FLX3 ? 1 : 0); gl.uniform1f(P.pool.u.uVox, S); depU(P.pool); }   // uVox：格 → 公尺（S 載入船型才有 ⇒ ⛔ 編著色器時還是 undefined）
    gl.uniformMatrix4fv(P.pool.u.uModel, false, sh.M); gl.uniform1f(P.pool.u.uMix, flMix(me)); gl.bindVertexArray(me.vao); gl.drawArrays(gl.TRIANGLES, 0, me.n);
  });
  on = false;
  R.forEach(function (e) {                                                  // 房間的水面（TASK-0811）：同一套著色，頂點著色器照船的姿態把世界高度換回船上的 z
    var sh = e[0], me = e[1]; if (wrvOn(sh, me) || !me.n) return;          // 透視畫成體積（下一段）⇒ 水面不畫
    if (!on) { on = true; begin(); gl.useProgram(P.wpool.prog); setCommon(P.wpool); gl.uniform1f(P.wpool.u.uX, FLX3 ? 1 : 0); gl.uniform1f(P.wpool.u.uEdge, 0); gl.uniform1f(P.wpool.u.uVox, S); depU(P.wpool); }
    wrwRipples(sh, me); wrwRipU(P.wpool, sh, me);                           // 細波：粒子、水幕落進水面的漣漪（只給畫面）
    gl.uniformMatrix4fv(P.wpool.u.uModel, false, sh.M); gl.uniform1f(P.wpool.u.uMix, wrwMix(me)); gl.bindVertexArray(me.vao); gl.drawArrays(gl.TRIANGLES, 0, me.n);
  });
  on = false;
  R.forEach(function (e) {                                                  // 透視的水：體積（63_wrwater_gl.js wrvDraw；只在透視）
    var sh = e[0], me = e[1]; if (!wrvOn(sh, me)) return;
    if (!on) { on = true; begin(); gl.useProgram(P.wvol.prog); setCommon(P.wvol); gl.uniform1f(P.wvol.u.uVox, S); gl.uniform1f(P.wvol.u.uSig, WRV_SIG); gl.uniform1f(P.wvol.u.uLit, 0.55 + 0.45 * wxSun()); }
    wrvDraw(P.wvol, sh, me);
  });
  on = false;
  R.forEach(function (e) {                                                  // 房間的水的側面（63_wrwater_gl.js wrwSides；只在透視、剖面有）：同一支側面著色器
    var sh = e[0], me = e[1]; if (!me.sn) return;
    if (!on) { on = true; begin(); gl.useProgram(P.pside.prog); setCommon(P.pside); gl.uniform1f(P.pside.u.uX, FLX3 ? 1 : 0); depU(P.pside); }
    gl.uniformMatrix4fv(P.pside.u.uModel, false, sh.M); gl.bindVertexArray(me.svao); gl.drawArrays(gl.TRIANGLES, 0, me.sn);
  });
  on = false;
  L.forEach(function (e) {                                                  // 側面與水瀑（flSides，GFX.pside）
    var sh = e[0], me = e[1]; if (!GFX.pside || !me.sn) return;
    if (!on) { on = true; begin(); gl.useProgram(P.pside.prog); setCommon(P.pside); gl.uniform1f(P.pside.u.uX, FLX3 ? 1 : 0); depU(P.pside); }
    gl.uniformMatrix4fv(P.pside.u.uModel, false, sh.M); gl.bindVertexArray(me.svao); gl.drawArrays(gl.TRIANGLES, 0, me.sn);
  });
  if (fs.length) {                                                          // 水幕（flFalls）：跟水面同一套混色、不寫深度
    begin();
    gl.useProgram(P.fall.prog); setCommon(P.fall); gl.uniform1f(P.fall.u.uX, FLX3 ? 1 : 0);
    fs.forEach(function (e) { gl.uniformMatrix4fv(P.fall.u.uModel, false, e[0].M); gl.uniform1f(P.fall.u.uMix, flMix(e[1])); gl.bindVertexArray(e[1].fvao); gl.drawArrays(gl.TRIANGLES, 0, e[1].fn); });
  }
  if (any) { gl.depthMask(true); gl.enable(gl.DEPTH_TEST); }
}
/** 噴進來的粒子放進點精靈的緩衝（60_render.js 的 pushPt）。 */
function flPushJets(pushPt) {
  var b = 0.55 + 0.45 * wxSun(), col = [0.72 * b, 0.84 * b, 0.9 * b];
  SHIPS.forEach(function (sh) {
    var fl = sh.fl; if (!fl || ((sh.broken || sh.sinkingFinal) && !fl.vis) || sh.sunk) return;
    var J = fl.J, M = sh.M;
    for (var i = 0; i < J.n; i++) { var o = i * 3; pushPt(M4.pt(M, J.p[o], J.p[o + 1], J.p[o + 2]), 0.12 + 0.6 * Math.cbrt(J.vol[i]), col, 0.75, -1); }
    if (sh.wrs && sh.wrs.J.n) { var J2 = sh.wrs.J, up = sh.wrs.upm; for (var i2 = 0; i2 < J2.n; i2++) { var o2 = i2 * 3; pushPt(M4.pt(M, J2.p[o2], J2.p[o2 + 1], J2.p[o2 + 2]), 0.12 + 0.6 * Math.cbrt(J2.u[i2] / up), col, 0.75, -1); } }   // 房間模擬的粒子（TASK-0808，33_wrsim.js；進水報表 wsim=1）
    var FS = GFX.fall && !FL_HIDE && fl.mesh && fl.mesh.fn ? fl.mesh.falls : null;   // 水幕的落點：每一道每一格幾顆水花（只給畫面：Math.random，⛔ 不碰 rnd()／rndF()）
    if (FS) for (var k = 0; k < FS.length; k++) {
      var f = FS[k], n = 1 + Math.min(3, Math.round(f.r * 6)), hw = f.w / S * 0.5;
      for (var e = 0; e < n; e++) pushPt(M4.pt(M, f.x + (Math.random() - 0.5) * 2 * hw, f.y + (Math.random() - 0.5) * 2 * hw, f.z1 + Math.random() * 3), 0.05 + 0.08 * Math.random(), [0.85 * b, 0.92 * b, 0.95 * b], 0.45, -1);
    }
  });
}
