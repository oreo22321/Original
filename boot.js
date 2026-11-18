// 起動: 配信用にまとめたファイル (dist) を読みます
// 開発・テストでは index.html?src で開くと、ソース (js/) のまま動きます
const src = /[?&]src\b/.test(location.search)
import(src ? './js/app/main.js' : './dist/app/main.js').catch(e => {
  const b = document.querySelector('.boot-sub')
  if (b) b.textContent = '読み込みに失敗しました。通信を確認して、もう一度開いてください (' + (e && e.message || e) + ')'
})
