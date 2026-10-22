// ───────────────────────── 確認彈窗（Tim 2026-10-17：「設定頁面的 道具設定 船隻設定 以及其他類似的設定 是否可以加一個 全部回到預設(可以彈窗確認)」「主頁面也可以加一個 全部回到預設按鈕」） ─────────────────────────
// 頁面裡自己畫的一層（template.html #askp）：⛔ 不用 confirm()：畫廊彈窗的 iframe 沒開 allow-modals，confirm 直接回 false（71_input.js shipR 那一段）。
// askOk(標題, 內文, 確定鈕的字, 按確定之後做的事)：預設停在「取消」（Enter ＝ 取消、要確定得點或 Tab 過去）；Esc、點外面 ＝ 取消。
// 開著的時候鍵盤不往下傳（捕獲階段、stopImmediatePropagation）⇒ 鍵位設定頁等新鍵、71_input.js 的 Esc 關頁都收不到；⛔ askUI 要比 keysUI 先掛（同掛在 window 的捕獲階段照掛的先後）。
var ASK_DO = null;
function askOk(title, body, ok, fn) {
  $('askT').textContent = title; $('askM').textContent = body; $('askY').textContent = ok;
  ASK_DO = fn; $('askp').classList.add('on'); $('askN').focus();
}
function askClose(yes) { var fn = ASK_DO; ASK_DO = null; $('askp').classList.remove('on'); if (yes && fn) fn(); }
function askUI() {
  $('askY').onclick = function () { askClose(true); };
  $('askN').onclick = function () { askClose(false); };
  $('askp').onclick = function (e) { if (e.target === $('askp')) askClose(false); };
  window.addEventListener('keydown', function (e) {
    if (!ASK_DO) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); askClose(false); }   // 其他鍵照瀏覽器的預設（Tab 換鈕、Enter／空白鍵按下有焦點的那顆）
  }, true);
}
