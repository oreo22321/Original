// localStorage を使えない環境 (一部の埋め込み表示・プライベートモードなど) でも動くよう、
// メモリ上の代わりを用意します (その場合、設定などはページを閉じると消えます)
(() => {
  let ok = false
  try {
    const k = '__forgecode_probe'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    ok = true
  } catch {}
  if (ok) return
  const mem = new Map()
  const store = {
    getItem: k => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)) },
    removeItem: k => { mem.delete(String(k)) },
    clear: () => mem.clear(),
    key: i => { const keys = [...mem.keys()]; return i < keys.length ? keys[i] : null },
    get length() { return mem.size },
  }
  try { Object.defineProperty(window, 'localStorage', { value: store, configurable: true }) } catch {}
})()
