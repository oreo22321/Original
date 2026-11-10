// Python 実行用 Web Worker (Pyodide を CDN から読み込みます)
let pyodide = null
let loadingUrl = null
let buf = []
let last = 0

function flush() {
  if (buf.length) { self.postMessage({ type: 'output', items: buf }); buf = [] }
  last = performance.now()
}
function emit(kind, text) {
  buf.push({ kind, text })
  if (buf.length > 200 || performance.now() - last > 60) flush()
}
setInterval(flush, 80)

async function load(indexURL) {
  if (pyodide) return pyodide
  const urls = [indexURL, 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/', 'https://cdn.jsdelivr.net/npm/pyodide@0.29.5/']
  let lastErr = null
  for (const u of urls) {
    if (!u) continue
    const base = u.endsWith('/') ? u : u + '/'
    try {
      if (loadingUrl !== base) {
        importScripts(base + 'pyodide.js')
        loadingUrl = base
      }
      pyodide = await self.loadPyodide({ indexURL: base })
      return pyodide
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error('Python (Pyodide) を読み込めませんでした。インターネット接続を確認してください。' + (lastErr ? ' (' + lastErr.message + ')' : ''))
}

const PROJECT = '/home/pyodide/project'

function writeProject(py, files) {
  const FS = py.FS
  const mkdirp = p => {
    let cur = ''
    for (const part of p.split('/').filter(Boolean)) {
      cur += '/' + part
      try { FS.mkdir(cur) } catch {}
    }
  }
  mkdirp(PROJECT)
  const snapshot = {}
  for (const [path, content] of Object.entries(files)) {
    const full = PROJECT + '/' + path
    mkdirp(full.slice(0, full.lastIndexOf('/')))
    FS.writeFile(full, content)
    snapshot[path] = content
  }
  return snapshot
}

function walk(py, dir, base = '') {
  const out = {}
  for (const name of py.FS.readdir(dir)) {
    if (name === '.' || name === '..' || name === '__pycache__') continue
    const full = dir + '/' + name
    const rel = base ? base + '/' + name : name
    const st = py.FS.stat(full)
    if (py.FS.isDir(st.mode)) Object.assign(out, walk(py, full, rel))
    else if (st.size < 2 * 1024 * 1024) {
      try { out[rel] = py.FS.readFile(full, { encoding: 'utf8' }) } catch {}
    }
  }
  return out
}

self.onmessage = async e => {
  const msg = e.data
  if (msg.type !== 'run') return
  let py
  try {
    py = await load(msg.indexURL)
    self.postMessage({ type: 'ready', version: py.version })
  } catch (err) {
    flush()
    self.postMessage({ type: 'error', text: String(err.message || err) })
    self.postMessage({ type: 'done', reason: 'error' })
    return
  }
  const stdinLines = (msg.stdin || '').split('\n')
  if (stdinLines.length && stdinLines[stdinLines.length - 1] === '') stdinLines.pop()
  py.setStdout({ batched: s => emit('print', s) })
  py.setStderr({ batched: s => emit('error', s) })
  py.setStdin({
    stdin: () => {
      if (!stdinLines.length) return null
      const v = stdinLines.shift()
      emit('input', '> ' + v)
      return v
    },
    autoEOF: true,
  })
  let before = {}
  try {
    before = writeProject(py, msg.files || {})
    py.runPython(`import os, sys\nos.chdir(${JSON.stringify(PROJECT)})\nif ${JSON.stringify(PROJECT)} not in sys.path: sys.path.insert(0, ${JSON.stringify(PROJECT)})\nfor _m in [m for m in list(sys.modules) if getattr(sys.modules[m], '__file__', '') and str(getattr(sys.modules[m], '__file__', '')).startswith(${JSON.stringify(PROJECT)})]:\n    del sys.modules[_m]`)
  } catch (err) {
    self.postMessage({ type: 'error', text: 'プロジェクトの準備に失敗しました: ' + err.message })
  }
  try {
    try {
      await py.loadPackagesFromImports(msg.source, { messageCallback: m => emit('meta', m), errorCallback: m => emit('warn', m) })
    } catch {}
    // 実行ごとに新しいグローバル (前回の変数を残さない)
    const globals = py.toPy({ __name__: '__main__', __file__: PROJECT + '/' + msg.path })
    await py.runPythonAsync(msg.source, { globals, filename: msg.path })
    globals.destroy()
    flush()
    self.postMessage({ type: 'done', reason: 'done' })
  } catch (err) {
    flush()
    let text = String(err.message || err)
    // Pyodide 内部のトレースバック行を省略
    text = text.split('\n').filter(l => !/File "\/lib\/python|_pyodide\/|pyodide\/_base\.py/.test(l)).join('\n')
    self.postMessage({ type: 'error', text: text.trim() })
    self.postMessage({ type: 'done', reason: 'error' })
  }
  // Python が書いたファイルをプロジェクトに反映
  try {
    const after = walk(py, PROJECT)
    for (const [p, c] of Object.entries(after)) if (before[p] !== c) self.postMessage({ type: 'fs', path: p, content: c })
  } catch {}
}
