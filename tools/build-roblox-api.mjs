// Roblox API ダンプ (API-Dump.json) を ForgeCode 用の軽量フォーマットに変換します。
//
// 使い方:
//   node build-roblox-api.mjs [API-Dump.json のパス]
// パスを省略すると MaximumADHD/Roblox-Client-Tracker から最新版を取得します。
//
// 出力: ../data/roblox-api.json
//   {
//     v: "<Roblox バージョン>",
//     c: { ClassName: { s: Superclass, t: "SND", m: [[kind, name, type, flags], ...] } },
//     e: { EnumName: [[ItemName, Value], ...] }
//   }
//   kind: p=Property f=Function e=Event c=Callback
//   flags: d=Deprecated r=ReadOnly y=Yields s=セキュリティ制限あり h=Hidden
//   class t: S=Service N=NotCreatable D=Deprecated

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = 'https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/'

async function load() {
  const p = process.argv[2]
  if (p) return JSON.parse(await readFile(p, 'utf8'))
  const res = await fetch(SRC + 'API-Dump.json')
  if (!res.ok) throw new Error('API-Dump.json の取得に失敗: ' + res.status)
  return res.json()
}

function typeName(t) {
  if (!t) return 'any'
  if (t.Category === 'Enum') return 'Enum.' + t.Name
  return t.Name
}

function params(list) {
  return '(' + (list || []).map(p => {
    let s = p.Name + ': ' + typeName(p.Type)
    if (p.Default !== undefined && p.Default !== null) s += '?'
    return s
  }).join(', ') + ')'
}

const dump = await load()
let version = String(dump.Version)
try {
  if (!process.argv[2]) {
    const r = await fetch(SRC + 'version.txt')
    if (r.ok) version = (await r.text()).trim()
  }
} catch {}

const out = { v: version, c: {}, e: {} }
let memberCount = 0

for (const cls of dump.Classes) {
  const tags = cls.Tags || []
  let t = ''
  if (tags.includes('Service')) t += 'S'
  if (tags.includes('NotCreatable')) t += 'N'
  if (tags.includes('Deprecated')) t += 'D'
  const members = []
  for (const m of cls.Members) {
    const mt = m.Tags || []
    // Hidden = プロパティ欄に出ないだけで、スクリプトからは使える (BasePart.Position など)
    if (mt.includes('NotScriptable')) continue
    let flags = ''
    if (mt.includes('Hidden')) flags += 'h'
    if (mt.includes('Deprecated')) flags += 'd'
    if (mt.includes('ReadOnly')) flags += 'r'
    if (mt.includes('Yields')) flags += 'y'
    const sec = m.Security
    const secName = typeof sec === 'string' ? sec : (sec && (sec.Read || sec.Write))
    if (secName && secName !== 'None' && secName !== 'PluginSecurity') flags += 's'
    let kind, type
    switch (m.MemberType) {
      case 'Property': kind = 'p'; type = typeName(m.ValueType); break
      case 'Function': kind = 'f'; type = params(m.Parameters) + ': ' + typeName(m.ReturnType); break
      case 'Event': kind = 'e'; type = params(m.Parameters); break
      case 'Callback': kind = 'c'; type = params(m.Parameters) + ': ' + typeName(m.ReturnType); break
      default: continue
    }
    const row = [kind, m.Name, type]
    if (flags) row.push(flags)
    members.push(row)
    memberCount++
  }
  const entry = { m: members }
  if (cls.Superclass && cls.Superclass !== '<<<ROOT>>>') entry.s = cls.Superclass
  if (t) entry.t = t
  out.c[cls.Name] = entry
}

for (const en of dump.Enums) {
  out.e[en.Name] = en.Items.map(i => [i.Name, i.Value])
}

const file = path.join(here, '..', 'data', 'roblox-api.json')
await writeFile(file, JSON.stringify(out))
console.log(`OK: ${Object.keys(out.c).length} classes, ${memberCount} members, ${Object.keys(out.e).length} enums -> ${file}`)
