// 何でも動かせます (Discord 以外の bot や、定期的に動かす処理など)
console.log('起動しました');
setInterval(() => {
  console.log(new Date().toLocaleTimeString('ja-JP'), '動いています');
}, 10_000);
