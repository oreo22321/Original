// 画面を描く前にテーマ (ライト / ダーク / 端末に合わせる) を当てる (ちらつかないように)
(function () {
  try {
    var t = localStorage.getItem('bothost-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* 保存が使えない */ }
})();
