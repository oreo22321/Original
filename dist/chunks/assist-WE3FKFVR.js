import{a as x}from"./chunk-5YFU3I5N.js";import"./chunk-6YYWDLBJ.js";import{j as E,k as M}from"./chunk-Q6LWNVQE.js";import"./chunk-OGXIANOP.js";var k=t=>/^[ \t]*/.exec(t)[0],N=t=>new Set(t.filter(r=>/Undefined/.test(r.kind||"")).map(r=>(r.args||[])[0]||r.msg)),Y=t=>t.some(r=>r.severity==="error");function S(t,r=1){let s=String(r+t.length).length;return t.map((l,a)=>`${String(r+a).padStart(s)}| ${l}`).join(`
`)}function j(t){let r=/```(?:python|py)?[^\n]*\n([\s\S]*?)(?:```|$)/.exec(t);return r?r[1].replace(/\s+$/,""):null}async function A(t,r,s,l){if(s===r)return{ok:!1,why:"unchanged"};let a=await x(t,s);if(Y(a))return{ok:!1,why:"syntax",error:a.find(i=>i.severity==="error")};let o=N(l||await x(t,r));for(let i of N(a))if(!o.has(i))return{ok:!1,why:"undefined",name:i};return{ok:!0,lint:a}}var I=`You are a meticulous Python 3 reviewer helping a beginner.
Report only REAL bugs that make the program behave wrongly or crash: wrong logic, wrong method or attribute names, wrong argument order or count, type mistakes (e.g. comparing input() text with a number), off-by-one errors, infinite loops, unreachable code, missing return, using a variable before it is set, mutating a list while iterating it.
Do NOT report style, naming, comments, docstrings, type hints, performance or things that are only unusual.
Answer with at most 4 lines in exactly this format and nothing else:
L<line number>: <what is wrong, in Japanese, under 50 characters> => <the whole corrected line>
If there is no real bug, answer exactly: NONE`;async function U(t,r,{known:s=[],signal:l,gen:a=E}={}){let o=r.split(`
`);if(!r.trim()||o.length>400)return[];let i=o.slice(0,260),e=await x(t,r);if(Y(e))return[];let c=s.slice(0,12).map(g=>`L${g.line}: ${g.message}`).join(`
`),n=[{role:"system",content:I},{role:"user",content:`${S(i)}${c?`

Already reported (do not repeat):
${c}`:""}`}],h=await a(n,{signal:l,maxTokens:320,temperature:.1,kind:"check"});if(/^\s*NONE\b/i.test(h))return[];let u=[];for(let g of h.split(`
`)){let p=/^\s*[-*]?\s*L?(\d+)\s*[:：|]\s*(.+?)(?:\s*=>\s*(.*))?\s*$/.exec(g);if(!p)continue;let d=Number(p[1]);if(d<1||d>i.length)continue;let f=p[2].replace(/`/g,"").trim();if(!f||f.length>140||/^none$/i.test(f)||s.some(m=>m.line===d))continue;let y=o[d-1],b=null,v=!!(p[3]&&p[3].trim()&&p[3].trim()!=="-");if(v){let m=p[3].replace(/^`+|`+$/g,"").replace(/\s+$/,"");if(m=k(y)+m.trimStart(),m.trim()!==y.trim()){let w=[...o];w[d-1]=m,(await A(t,r,w.join(`
`),e)).ok&&(b={line:d,text:m})}}if(!(v&&!b)&&!(!b&&!(y.match(/[A-Za-z_]\w{2,}/g)||[]).some(w=>f.includes(w)))&&(u.push({line:d,message:f,fix:b}),u.length>=4))break}return u}var O="You fix bugs in Python 3 programs written by beginners.\nYou get the error, the whole file for context, and a few lines to rewrite.\nReturn ONLY the corrected version of those lines in one ```python block, keeping the same indentation and everything that is not part of the bug.\nThen add one short sentence in Japanese explaining the fix.";function P(t,r){let s=Math.max(0,Math.min(t.length-1,r-1)),l=k(t[s]).length,a=Math.max(0,s-6),o=Math.min(t.length-1,s+6);for(let i=s;i>=Math.max(0,s-40);i--){let e=t[i];if(/^\s*(async\s+def|def|class)\s/.test(e)&&k(e).length<Math.max(1,l)){let c=k(e).length,n=i+1;for(;n<t.length&&n-i<60&&(!t[n].trim()||k(t[n]).length>c);)n++;for(a=i,o=Math.max(s,n-1);o>s&&!t[o].trim();)o--;break}}return{start:a+1,end:o+1}}async function _(t,{code:r,path:s="main.py",error:l,signal:a,onText:o,gen:i=E}){let e=r.split(`
`),c=Number(l.line)||1;if(c>e.length)return null;let{start:n,end:h}=P(e,c),u=e.slice(n-1,h).join(`
`),g=String(l.text||`${l.type}: ${l.message}`).split(`
`).slice(-14).join(`
`),p=e.length<=160?S(e):S(e.slice(Math.max(0,n-40),Math.min(e.length,h+40)),Math.max(1,n-39)),d=await x(t,r),f="";for(let y=0;y<2;y++){let b=[{role:"system",content:O},{role:"user",content:`File ${s}:
${p}

Error when running it:
${g}

Rewrite lines ${n}-${h} (the bug is around line ${c}):
\`\`\`python
${u}
\`\`\`${f}`}],v=await i(b,{signal:a,maxTokens:700,temperature:.15,kind:"fix",onText:o}),m=j(v);if(!m)continue;let w=k(e[n-1]);w&&!m.startsWith(w)&&(m=m.split(`
`).map(L=>L.trim()?w+L:L).join(`
`));let R=[...e.slice(0,n-1),...m.split(`
`),...e.slice(h)].join(`
`),$=await A(t,r,R,d);if($.ok){let L=v.replace(/```[\s\S]*?(```|$)/g,"").replace(/\s+/g," ").trim().slice(0,200);return{start:n,end:h,before:u,after:m,code:R,why:L}}f=$.why==="syntax"?`

Your previous answer had a syntax error (${$.error.msg} at line ${$.error.line}). Return valid Python.`:$.why==="undefined"?`

Your previous answer used the undefined name "${$.name}". Do not invent names.`:`

Your previous answer did not change anything. Fix the bug.`}return null}async function D(t,r,{signal:s}={}){let l=t.slice(-3e3),a=r.slice(0,800),o=await M(l,a,{signal:s,maxTokens:64});if(!o)return"";o=o.replace(/\r/g,"").replace(/<\|[^|]*\|>/g,"");let i=l.slice(l.lastIndexOf(`
`)+1),e=o.split(`
`);if(i.trim())e=e.slice(0,1);else{let h=[];for(let u of e)if(!u.trim()&&h.length||(h.push(u),h.length>=6))break;e=h}let c=e.join(`
`).replace(/\s+$/,"");if(!c.trim())return"";let n=a.split(`
`).find(h=>h.trim())||"";return n.trim()&&c.trim()===n.trim()?"":(/^\s*$/.test(i)&&i.length&&c.startsWith(i)&&(c=c.slice(i.length)),c)}var T="You are a Python 3 expert. Fix the problems listed and return the complete corrected program in one ```python block. Do not explain.";async function W(t,r,{signal:s,run:l,onStep:a=()=>{},gen:o=E}={}){let i=[],e=r;for(let n=0;n<2;n++){let u=(await x(t,e)).filter(f=>f.severity==="error"||/Undefined/.test(f.kind||""));if(!u.length)break;a("wrench",`見つけた問題 (${u.length} 件) を AI が直しています`);let g=u.slice(0,8).map(f=>`line ${f.line}: ${f.msg}`).join(`
`),p=await o([{role:"system",content:T},{role:"user",content:`\`\`\`python
${e}
\`\`\`

Problems:
${g}`}],{signal:s,maxTokens:1400,temperature:.1,kind:"chat"}),d=j(p);if(!d||d===e)break;e=d,i.push(`問題を ${u.length} 件直しました`)}let c=await x(t,e);if(c.some(n=>n.severity==="error")&&i.push("まだ構文エラーが残っています"),l&&!c.some(n=>n.severity==="error")&&!/\binput\s*\(|tkinter|turtle|pygame|while\s+True/.test(e)){a("play","作ったコードを試しに実行しています");let n=null;try{n=await l(e)}catch{}if(n&&n.errors&&n.errors.length){let h=n.errors[0];a("wrench","実行エラーを AI が直しています");let u=await o([{role:"system",content:T},{role:"user",content:`\`\`\`python
${e}
\`\`\`

Running it failed:
${String(h.text).split(`
`).slice(-8).join(`
`)}`}],{signal:s,maxTokens:1400,temperature:.1,kind:"chat"}),g=j(u);g&&g!==e&&!(await x(t,g)).some(p=>p.severity==="error")?(e=g,i.push("実行して見つかったエラーを直しました")):i.push("実行するとエラーになりました")}else n&&n.started&&i.push("実行して確かめました")}return{code:e,notes:i}}export{U as aiCheck,D as aiComplete,_ as aiFixError,P as fixWindow,W as refineCode};
