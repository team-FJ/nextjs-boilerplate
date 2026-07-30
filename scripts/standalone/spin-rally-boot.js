/**
 * 単体HTML版の起動見張り。ゲーム本体より前に読み込む。
 *
 * 相手の端末で何が起きたかは見えないので、「真っ黒な画面」で終わらせないための保険。
 *  - スクリプトが動かない環境（チャットやファイルアプリのプレビュー）→ 案内文が残る
 *  - 途中で落ちた                                                   → その場に例外を出す
 *
 * ここはビルド時に HTML へそのまま埋め込まれる。**テンプレート文字列に書かないこと**——
 * 改行のエスケープが二重に潰れて構文エラーになる（実際に踏んだ）。
 */
(function () {
  function show(text) {
    var el = document.getElementById("boot-message");
    if (!el) {
      el = document.createElement("div");
      el.id = "boot-message";
      document.body.appendChild(el);
    }
    el.setAttribute(
      "style",
      "color:#ff8fa3;font-family:ui-monospace,monospace;font-size:13px;line-height:1.8;" +
        "padding:24px;white-space:pre-wrap;word-break:break-word",
    );
    el.textContent =
      "SPIN RALLY を起動できませんでした\n\n" +
      text +
      "\n\nこの文面をそのまま伝えてもらえれば直せます。";
  }

  window.addEventListener("error", function (e) {
    var where = e && e.filename ? e.filename + ":" + e.lineno : "";
    show((e && e.message ? e.message : "不明なエラー") + (where ? "\n" + where : ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var reason = e && e.reason;
    show(String((reason && reason.message) || reason || "不明なエラー"));
  });
})();
