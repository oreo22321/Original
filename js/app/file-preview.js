// バイナリファイルの表示 (画像はそのまま、ほかは種類・大きさと Python での読み方)
import { h, modal, shareFile, icon, copyText, toast } from './ui.js'
import { IMAGE_EXT, mimeOf, humanSize, kindOf } from './bin.js'
import * as vfs from './vfs.js'

const HINTS = [
  [/\.(png|jpe?g|gif|webp|bmp)$/i, p => `from PIL import Image\nimg = Image.open(${JSON.stringify(p)})\nprint(img.size)`],
  [/\.(xlsx|xlsm)$/i, p => `import openpyxl\nwb = openpyxl.load_workbook(${JSON.stringify(p)})\nprint(wb.sheetnames)`],
  [/\.(db|sqlite3?)$/i, p => `import sqlite3\ncon = sqlite3.connect(${JSON.stringify(p)})\nprint(con.execute("select name from sqlite_master").fetchall())`],
  [/\.(pkl|pickle)$/i, p => `import pickle\nwith open(${JSON.stringify(p)}, "rb") as f:\n    data = pickle.load(f)`],
  [/\.npy$/i, p => `import numpy as np\na = np.load(${JSON.stringify(p)})`],
]

export function previewFile(path, bytes) {
  const name = vfs.basename(path)
  const body = h('div', { class: 'file-preview' })
  let url = null
  if (IMAGE_EXT.test(name)) {
    url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }))
    body.append(h('div', { class: 'fp-image' }, h('img', { src: url, alt: name })))
  } else body.append(h('div', { class: 'fp-icon' }, icon('file', 40)))
  body.append(h('div', { class: 'fp-meta' }, `${kindOf(name, bytes)} ・ ${humanSize(bytes.length)}`))
  const hint = HINTS.find(([re]) => re.test(name))
  if (hint) {
    const code = hint[1](path)
    body.append(h('div', { class: 'set-desc' }, 'Python で読むには:'), h('pre', { class: 'fp-code' }, code),
      h('button', { class: 'btn small ghost', onclick: () => copyText(code).then(() => toast('コピーしました', { icon: 'copy' })) }, icon('copy', 14), 'コードをコピー'))
  } else body.append(h('div', { class: 'set-desc' }, `Python では open(${JSON.stringify(path)}, "rb") で読めます`))
  modal({
    title: name, body, wide: true,
    onClose: () => { if (url) URL.revokeObjectURL(url) },
    actions: [{ label: '共有 / 保存', run: () => { shareFile(name, new Blob([bytes], { type: mimeOf(name) }), mimeOf(name)); return false } }, { label: '閉じる', primary: true, value: null }],
  })
}
