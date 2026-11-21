// ターミナルのシェルのテスト:  node tests/shell.test.mjs
// ファイルはメモリの中 (アプリのプロジェクトの代わり)。python / pip は呼ばれた内容を記録するだけ
import { Shell, lex, parse, resolvePath, strWidth } from '../js/app/shell.js'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

const files = new Map(Object.entries({
  'main.py': 'print("hi")\nimport util\n',
  'util.py': 'def f():\n    return 1\n',
  'data/a.csv': 'name,score\nalice,90\nbob,72\ncarol,85\n',
  'data/b.txt': 'apple\nbanana\napple\ncherry\n',
  'notes.md': '# memo\nTODO: print report\n',
  '.hidden': 'x',
}))
const dirs = new Set(['data'])
const calls = []
let changed = 0
// アプリと同じく、一覧は changed() で読み直すまで古いまま (シェルが自分の変更を覚えているかを確かめる)
const listNow = () => [...[...dirs].map(p => ({ path: p, dir: true })), ...[...files].map(([p, c]) => ({ path: p, dir: false, size: c.length, mtime: 1700000000000 }))]
let snapshot = listNow()
const host = {
  files: () => snapshot,
  read: async p => (files.has(p) ? files.get(p) : null),
  write: async (p, t) => { files.set(p, t) },
  mkdir: async p => { let q = ''; for (const part of p.split('/')) { q = q ? q + '/' + part : part; dirs.add(q) } },
  remove: async p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(p + '/')) files.delete(k); for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d) },
  rename: async (a, b) => {
    for (const [k, v] of [...files]) if (k === a || k.startsWith(a + '/')) { files.delete(k); files.set(b + k.slice(a.length), v) }
    for (const d of [...dirs]) if (d === a || d.startsWith(a + '/')) { dirs.delete(d); dirs.add(b + d.slice(a.length)) }
  },
  changed: async () => { changed++; snapshot = listNow() },
  python: async opts => { calls.push(['python', opts]); opts.out(`ran ${opts.entry} ${JSON.stringify(opts.argv)} cwd=${opts.cwd} stdin=${JSON.stringify(opts.stdin)}\n`); return 0 },
  pip: async args => { calls.push(['pip', args]); return 0 },
  pyVersion: () => 'Python 3.14.0',
  open: async (p, line) => { calls.push(['open', p, line]) },
  runFile: async p => { calls.push(['run', p]) },
  command: async id => { calls.push(['command', id]) },
  fetch: async url => ({ ok: true, status: 200, statusText: 'OK', headers: new Map(), text: async () => `body of ${url}` }),
  storage: async () => ({ usage: 1024 * 1024, quota: 1024 * 1024 * 1024 }),
}
let replStarted = null, cleared = 0
const term = { startRepl: o => { replStarted = o }, clear: () => { cleared++ }, exit: () => {}, historyList: () => ['ls', 'pwd'], clearHistory: () => {} }
const sh = new Shell(host)
async function run(line, { cols = 80 } = {}) {
  const out = [], err = []
  const status = await sh.run(line, { out: s => out.push(s), err: s => err.push(s), tty: true, cols: () => cols, term, signal: new AbortController().signal })
  return { status, out: strip(out.join('')), err: strip(err.join('')) }
}

// ---- 字句・構文 ----
ok('lex quotes', JSON.stringify(lex(`echo "a b" 'c d' e\\ f`).map(t => t.word.map(s => s.v).join(''))) === '["echo","a b","c d","e f"]')
ok('lex operators', lex('a | b && c || d; e > f 2>&1').filter(t => t.op).map(t => t.op).join(' ') === '| && || ; > 2>&1')
ok('parse pipeline', parse(lex('cat x | grep y | wc -l'))[0].pipe.length === 3)
ok('resolve paths', resolvePath('a/b', '../c') === 'a/c' && resolvePath('a', '~/x') === 'x' && resolvePath('a', '/x/./y') === 'x/y' && resolvePath('', '/home/pyodide/project/z') === 'z')
ok('wide chars', strWidth('あa') === 3)

// ---- ファイル ----
let r = await run('ls')
ok('ls lists names', /data/.test(r.out) && /main\.py/.test(r.out) && !/\.hidden/.test(r.out), r.out)
r = await run('ls -a')
ok('ls -a shows hidden', /\.hidden/.test(r.out))
r = await run('ls -l data')
ok('ls -l', /a\.csv/.test(r.out) && /^-rw/m.test(r.out), r.out)
r = await run('ls nope')
ok('ls missing', r.status === 2 && /nope/.test(r.err))
r = await run('cd data && pwd')
ok('cd + pwd', r.out.trim() === '~/data', r.out)
r = await run('cat a.csv | head -n 2')
ok('relative read after cd', r.out === 'name,score\nalice,90\n', JSON.stringify(r.out))
r = await run('cd .. ; cd nowhere')
ok('cd missing dir', r.status === 1 && /nowhere/.test(r.err) && sh.cwd === '')
r = await run('cd data; cd -')
ok('cd -', sh.cwd === '' && /~/.test(r.out))
r = await run('cat -n util.py')
ok('cat -n', /^\s+1\tdef f/m.test(r.out) && /^\s+2\t/m.test(r.out), r.out)
r = await run('wc -l data/a.csv')
ok('wc -l', /^\s*4 data\/a\.csv/.test(r.out), r.out)
r = await run('cat data/b.txt | sort | uniq -c')
ok('sort | uniq -c', /2 apple/.test(r.out) && /1 cherry/.test(r.out), r.out)
r = await run('sort -t , -k 2 -n data/a.csv | head -1')
ok('sort -k -n', /bob/.test(r.out) || /name/.test(r.out), r.out)
r = await run('grep -n apple data/b.txt')
ok('grep -n', r.out === '1:apple\n3:apple\n', JSON.stringify(r.out))
r = await run('grep -rn print .')
ok('grep -r', /main\.py:1:print\("hi"\)/.test(r.out) && /notes\.md:2:TODO/.test(r.out), r.out)
r = await run('grep "print(" main.py')
ok('grep parentheses are plain characters', r.status === 0 && /print\("hi"\)/.test(r.out), r.err + r.out)
r = await run('grep -c apple data/b.txt; grep zzz data/b.txt')
ok('grep -c and no match status', /^2$/m.test(r.out) && r.status === 1)
r = await run('find . -name "*.py"')
ok('find -name', r.out === './main.py\n./util.py\n', JSON.stringify(r.out))
r = await run('find data -type f')
ok('find -type f', r.out === 'data/a.csv\ndata/b.txt\n', JSON.stringify(r.out))
r = await run('tree')
ok('tree', /├── data/.test(r.out) && /│   ├── a\.csv/.test(r.out) && /1 個のフォルダ, 5 個のファイル/.test(r.out), r.out)
r = await run('echo *.py')
ok('glob', r.out === 'main.py util.py\n', JSON.stringify(r.out))
r = await run('echo data/*.csv "*.py" \\*.py')
ok('glob in folders, quoted globs stay', r.out === 'data/a.csv *.py *.py\n', JSON.stringify(r.out))

// ---- 書き込み ----
r = await run('echo hello > out.txt && echo world >> out.txt && cat out.txt')
ok('redirect > and >>', r.out === 'hello\nworld\n' && files.get('out.txt') === 'hello\nworld\n', JSON.stringify(r.out))
ok('changes reported once per command', changed >= 2)
r = await run('mkdir -p src/pkg && touch src/pkg/__init__.py && ls src/pkg')
ok('mkdir -p + touch', /__init__\.py/.test(r.out) && files.has('src/pkg/__init__.py'), r.out + r.err)
r = await run('mkdir a/b')
ok('mkdir without -p', r.status === 1 && /-p/.test(r.err))
r = await run('cp main.py src/ && cp -r data backup && ls backup')
ok('cp into dir, cp -r', files.has('src/main.py') && files.get('backup/a.csv') === files.get('data/a.csv') && /a\.csv/.test(r.out), r.err)
r = await run('cp data x')
ok('cp dir needs -r', r.status === 1 && /-r/.test(r.err))
r = await run('mv out.txt notes.txt && ls notes.txt && cat out.txt')
ok('mv', files.has('notes.txt') && !files.has('out.txt') && r.status === 1, r.err)
r = await run('mv backup data2 && ls')
ok('mv dir', /data2/.test(r.out) && files.has('data2/a.csv'))
r = await run('rm data2')
ok('rm dir needs -r', r.status === 1 && files.has('data2/a.csv'))
r = await run('rm -rf data2 && ls')
ok('rm -rf', !/data2/.test(r.out) && !files.has('data2/a.csv'))
r = await run('rm -rf ~')
ok('rm cannot remove the project', r.status === 1 && files.has('main.py'))
r = await run("sed -i 's/hi/hello/' main.py && cat main.py")
ok('sed -i', /print\("hello"\)/.test(r.out), r.out + r.err)
r = await run("echo 'print(1)' | sed 's/print(\\(.*\\))/p(\\1)/'")
ok('sed groups', r.out === 'p(1)\n', JSON.stringify(r.out) + r.err)
r = await run('echo a,b,c | cut -d , -f 2,3')
ok('cut', r.out === 'b,c\n', JSON.stringify(r.out))
r = await run('echo hello | tr a-z A-Z')
ok('tr', r.out === 'HELLO\n')
r = await run('cat data/b.txt | tee copy.txt | wc -l')
ok('tee', files.get('copy.txt') === files.get('data/b.txt') && /4/.test(r.out), r.out)
r = await run('diff data/b.txt copy.txt; echo $?')
ok('diff same', r.out === '0\n', JSON.stringify(r.out))
files.set('copy.txt', 'apple\nBANANA\napple\ncherry\n')
snapshot = listNow()
r = await run('diff data/b.txt copy.txt')
ok('diff shows changes', r.status === 1 && /^-banana$/m.test(r.out) && /^\+BANANA$/m.test(r.out), r.out)

// ---- 変数・置き換え・制御 ----
r = await run('NAME=forge; echo "hi $NAME" \'$NAME\' ${NAME}!')
ok('variables', r.out === 'hi forge $NAME forge!\n', JSON.stringify(r.out))
r = await run('echo "files: $(ls *.py | wc -l)"')
ok('command substitution', r.out === 'files: 2\n', JSON.stringify(r.out))
r = await run('false || echo fallback; true && echo yes')
ok('&& ||', r.out === 'fallback\nyes\n', JSON.stringify(r.out))
r = await run('nosuchcmd')
ok('command not found', r.status === 127 && /コマンドが見つかりません/.test(r.err))
r = await run('main.py')
ok('hint for python files', /python main\.py/.test(r.err))
r = await run('echo "unterminated')
ok('syntax error message', r.status === 2 && /閉じられていません/.test(r.err))
r = await run('alias hello="echo hi there"; hello you')
ok('alias', r.out === 'hi there you\n', JSON.stringify(r.out))
r = await run('printf "%s=%03d\\n" a 7 b 12')
ok('printf', r.out === 'a=007\nb=012\n', JSON.stringify(r.out))
r = await run('seq 3 | sort -r')
ok('seq', r.out === '3\n2\n1\n')
r = await run('echo -e "a\\tb"')
ok('echo -e', r.out === 'a\tb\n')
r = await run('cat < data/b.txt | head -1')
ok('< redirect', r.out === 'apple\n')
r = await run('ls nope 2> err.txt; cat err.txt')
ok('2> redirect', /nope/.test(r.out) && !r.err, r.out + '|' + r.err)
r = await run('ls nope > all.txt 2>&1; cat all.txt')
ok('2>&1', /nope/.test(files.get('all.txt') || ''))

// ---- Python・アプリ ----
calls.length = 0
r = await run('cd data && python ../main.py one "two words"')
let pc = calls.find(c => c[0] === 'python')
ok('python file + argv + cwd', pc && pc[1].entry === 'main.py' && JSON.stringify(pc[1].argv) === '["../main.py","one","two words"]' && pc[1].cwd === 'data', JSON.stringify(pc && pc[1]))
await run('cd ~')
calls.length = 0
await run('python -c "print(1)" x')
pc = calls.find(c => c[0] === 'python')
ok('python -c', pc && pc[1].source === 'print(1)' && JSON.stringify(pc[1].argv) === '["-c","x"]')
calls.length = 0
await run('python -m this')
pc = calls.find(c => c[0] === 'python')
ok('python -m', pc && /run_module\("this"/.test(pc[1].source))
calls.length = 0
r = await run('echo 5 | python main.py')
pc = calls.find(c => c[0] === 'python')
ok('pipe into python stdin', pc && pc[1].stdin === '5\n', JSON.stringify(pc && pc[1].stdin))
r = await run('python main.py | grep ran')
ok('python output can be piped', /ran main\.py/.test(r.out))
replStarted = null
await run('python')
ok('python alone starts the REPL', replStarted && replStarted.ns === 'repl-new')
r = await run('python missing.py')
ok('python missing file', r.status === 2 && /missing\.py/.test(r.err))
calls.length = 0
await run('python -m pip install emoji')
ok('python -m pip', calls.some(c => c[0] === 'pip' && c[1][0] === 'install' && c[1][1] === 'emoji'))
files.set('requirements.txt', 'emoji  # comment\n\ntabulate\n')
snapshot = listNow()
calls.length = 0
await run('pip install -r requirements.txt')
ok('pip -r', calls.some(c => c[0] === 'pip' && JSON.stringify(c[1]) === '["install","emoji","tabulate"]'), JSON.stringify(calls))
calls.length = 0
await run('code util.py:2')
ok('open with line', calls.some(c => c[0] === 'open' && c[1] === 'util.py' && c[2] === 2))
await run('open new.py')
ok('open creates a file', files.has('new.py'))
await run('clear')
ok('clear', cleared === 1)
r = await run('curl https://example.com/x.csv -o x.csv')
ok('curl -o', files.get('x.csv') === 'body of https://example.com/x.csv')
r = await run('python --version')
ok('python --version', r.out === 'Python 3.14.0\n')
r = await run('help')
ok('help lists commands', /python ファイル\.py/.test(r.out) && /grep/.test(r.out))

// ---- 補完 ----
let c = sh.complete('pyt')
ok('complete command', c.items.some(i => i.label === 'python'))
c = sh.complete('cat da')
ok('complete folder', c.items.length === 1 && c.items[0].text === 'data/' && c.start === 4)
c = sh.complete('cat data/a')
ok('complete inside folder', c.items[0].text === 'data/a.csv ')
c = sh.complete('cd ')
ok('cd completes folders only', c.items.every(i => i.dir))
c = sh.complete('ls | gr')
ok('complete after pipe', c.items.some(i => i.label === 'grep'))

// 作ってすぐ使える (アプリの一覧が古いままでも)
r = await run('mkdir fresh && cd fresh && echo x > y.txt && cat y.txt && cd ..')
ok('new folder and file usable at once', r.out === 'x\n' && r.status === 0, r.out + r.err)
r = await run('rm -r fresh; ls fresh')
ok('removed folder is gone at once', r.status === 2)

// ---- 制御 (for / while / if / 関数 / スクリプト) ----
r = await run('for f in *.py; do echo "[$f]"; done')
ok('for loop over files', r.out === '[main.py]\n[new.py]\n[util.py]\n', JSON.stringify(r.out))
r = await run('i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done')
ok('while + test + arithmetic', r.out === '0\n1\n2\n', JSON.stringify(r.out) + r.err)
r = await run('if [ -f main.py ]; then echo yes; else echo no; fi; if [ -d nope ]; then echo a; elif [ "x" = "x" ]; then echo b; fi')
ok('if / elif / else', r.out === 'yes\nb\n', JSON.stringify(r.out) + r.err)
r = await run('echo $(( (2 + 3) * 4 - 10 / 3 )) $((2**10)) $((7 % 3))')
ok('arithmetic expansion', r.out === '17 1024 1\n', JSON.stringify(r.out))
r = await run('greet() { echo "hi $1 ($#)"; return 3; }; greet bob x; echo "status $?"')
ok('functions with arguments and return', r.out === 'hi bob (2)\nstatus 3\n', JSON.stringify(r.out) + r.err)
r = await run('for i in 1 2 3 4; do if [ $i -eq 2 ]; then continue; fi; if [ $i -eq 4 ]; then break; fi; echo $i; done')
ok('break / continue', r.out === '1\n3\n', JSON.stringify(r.out))
r = await run('printf "a 1\nb 2\n" | while read name n; do echo "$n:$name"; done')
ok('while read from a pipe', r.out === '1:a\n2:b\n', JSON.stringify(r.out) + r.err)
files.set('build.sh', '#!/bin/sh\n# comment\necho "args: $@"\nfor x in $@; do\n  echo "- $x"\ndone\ncd data\nexit 4\necho never\n')
snapshot = listNow()
r = await run('sh build.sh one two; echo "code $?"; pwd')
ok('sh script with args, exit code, subshell cwd', r.out === 'args: one two\n- one\n- two\ncode 4\n~\n', JSON.stringify(r.out) + r.err)
r = await run('./build.sh z | head -1')
ok('./script.sh runs the script', r.out === 'args: z\n', JSON.stringify(r.out) + r.err)
r = await run('ls *.py | xargs wc -l | tail -1')
ok('xargs', /合計/.test(r.out), r.out + r.err)
r = await run('echo hello | base64 && echo aGVsbG8K | base64 -d')
ok('base64', r.out === 'aGVsbG8K\nhello\n', JSON.stringify(r.out))
r = await run('echo -n abc | sha256sum')
ok('sha256sum', /^ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/.test(r.out), r.out)
r = await run('zip -r -q pack.zip data && unzip -l pack.zip && mkdir -p out && unzip -q -d out pack.zip && cat out/data/b.txt | head -1')
ok('zip / unzip', /data\/a\.csv/.test(r.out) && /apple$/m.test(r.out) && files.get('pack.zip') instanceof Uint8Array, r.out + r.err)
r = await run('cat pack.zip')
ok('cat refuses binary files', r.status === 1 && /バイナリ/.test(r.err))
r = await run('file pack.zip main.py')
ok('file command', /pack\.zip: 圧縮ファイル/.test(r.out) && /main\.py: テキスト/.test(r.out), r.out)
ok('incomplete input is detected', sh.isIncomplete('for x in a b; do') && sh.isIncomplete('echo "abc') && !sh.isIncomplete('echo ok'))
r = await run('if true; then')
ok('incomplete line reports missing part', r.status === 2 && /fi|がありません/.test(r.err), r.err)

// ---- 表示 ----
r = await run('ls', { cols: 20 })
ok('ls fits the width', r.out.split('\n').every(l => strWidth(l) <= 20), r.out)

// ---- v15: 構文 (case・ヒアドキュメント・${…}・{1..3}・&) ----
r = await run('x=hello.tar.gz; echo ${x%.gz} ${x%%.*} ${x#*.} ${#x} ${x^^} ${y:-def} ${x/l/L} ${x//l/L} ${x:1:3}')
ok('param expansion', r.out.trim() === 'hello.tar hello tar.gz 12 HELLO.TAR.GZ def heLlo.tar.gz heLLo.tar.gz ell', r.out)
r = await run('unset z; echo ${z:=set}; echo $z; echo ${z:+alt}; echo ${a:-${z}x}')
ok('param default/assign', r.out === 'set\nset\nalt\nsetx\n', JSON.stringify(r.out))
r = await run('echo a{b,c,d}e {1..5} {05..07} {a..c} {10..1..3}')
ok('brace expansion', r.out.trim() === 'abe ace ade 1 2 3 4 5 05 06 07 a b c 10 7 4 1', r.out)
r = await run('for f in x{1..3}; do printf "%s;" $f; done')
ok('brace in for', r.out === 'x1;x2;x3;', r.out)
r = await run('for v in apple 42 zz x.py; do case $v in\n  a*) echo "$v: a で始まる" ;;\n  [0-9]*) echo "$v: 数" ;;\n  *.py|*.txt) echo "$v: ファイル" ;;\n  *) echo "$v: その他" ;;\nesac; done')
ok('case', r.out === 'apple: a で始まる\n42: 数\nzz: その他\nx.py: ファイル\n', JSON.stringify(r.out + r.err))
r = await run('name=World\ncat <<EOF\nHello $name\n  $((1 + 2)) items\nEOF')
ok('heredoc expands', r.out === 'Hello World\n  3 items\n', JSON.stringify(r.out + r.err))
r = await run("cat <<'EOF' | wc -l\n$not expanded\nline2\nEOF")
ok('heredoc quoted + pipe', r.out.trim() === '2', JSON.stringify(r.out + r.err))
r = await run('tr a-z A-Z <<< "here string"')
ok('here string', r.out === 'HERE STRING\n', JSON.stringify(r.out + r.err))
ok('heredoc incomplete', sh.isIncomplete('cat <<EOF\nabc') && !sh.isIncomplete('cat <<EOF\nabc\nEOF'))
r = await run('sleep 0.2 && echo bg-done > bg.txt &')
ok('background job starts', /\[1\] sleep 0\.2/.test(r.err), r.err)
r = await run('jobs')
ok('jobs lists', /\[1\]\+\s+実行中/.test(r.out), r.out)
r = await run('wait; cat bg.txt')
ok('wait for job', /bg-done/.test(r.out), r.out + r.err)
r = await run('sleep 5 & kill %1; wait; echo after')
ok('kill %1', /after/.test(r.out), r.out + r.err)
r = await run('eval "echo evaluated \\$((2*3))"')
ok('eval', r.out.trim() === 'evaluated 6', r.out + r.err)

// ---- v15: コマンド ----
r = await run("awk -F, 'NR > 1 { s += $2; n++ } END { printf \"%.1f\\n\", s / n }' data/a.csv")
ok('awk average', r.out.trim() === '82.3', r.out + r.err)
r = await run("awk '{ c[$1]++ } END { for (k in c) print k, c[k] }' data/b.txt | sort")
ok('awk count', r.out === 'apple 2\nbanana 1\ncherry 1\n', JSON.stringify(r.out + r.err))
r = await run("echo 'a b c' | awk '{ print $NF, NF; print toupper($1) }'")
ok('awk NF toupper', r.out === 'c 3\nA\n', JSON.stringify(r.out + r.err))
r = await run("echo '{\"users\": [{\"name\": \"ann\", \"age\": 30}, {\"name\": \"bo\", \"age\": 20}]}' > u.json && jq -r '.users[] | select(.age > 25) | .name' u.json")
ok('jq select', r.out === 'ann\n', JSON.stringify(r.out + r.err))
r = await run("jq -c '{n: (.users | length), names: [.users[].name]}' u.json")
ok('jq object', r.out.trim() === '{"n":2,"names":["ann","bo"]}', r.out + r.err)
r = await run("jq '.users | map(.age) | add' u.json")
ok('jq map add', r.out.trim() === '50', r.out + r.err)
r = await run("echo 'scale=3; 10/3; 2^10' | bc")
ok('bc', r.out === '3.333\n1024\n', JSON.stringify(r.out + r.err))
r = await run("printf 'hi\\n' | xxd")
ok('xxd', /00000000: 6869 0a\s+hi\./.test(r.out), r.out + r.err)
r = await run('printf abc | md5sum && printf abc | sha1sum')
ok('md5 sha1', /900150983cd24fb0d6963f7d28e17f72/.test(r.out) && /a9993e364706816aba3e25717850c26c9cd0d89d/.test(r.out), r.out + r.err)
r = await run('tar -czf pack.tgz data && rm -r data && tar -tzf pack.tgz && tar -xzf pack.tgz && cat data/a.csv | head -1')
ok('tar roundtrip', /data\/a\.csv/.test(r.out) && /name,score/.test(r.out), r.out + r.err)
r = await run('printf "a b\\nlonger c\\n" | column -t')
ok('column -t', r.out === 'a       b\nlonger  c\n', JSON.stringify(r.out + r.err))
r = await run('seq 3 | tac | paste -s -d,')
ok('tac paste', r.out.trim() === '3,2,1', r.out + r.err)
r = await run('echo hello > g.txt && gzip g.txt && ls g.txt.gz && zcat g.txt.gz')
ok('gzip zcat', /g\.txt\.gz/.test(r.out) && /hello/.test(r.out), r.out + r.err)
r = await run('timeout 0.1 sleep 3; echo code=$?')
ok('timeout', /code=124/.test(r.out), r.out + r.err)

console.log(`shell: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
