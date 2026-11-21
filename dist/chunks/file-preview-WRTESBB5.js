import{b as y,e as p,f as b,g as u}from"./chunk-OCXOK7H2.js";import{g as c}from"./chunk-DAL56S24.js";import{a as i,b as a,f as m,g as f,p as d,r as g}from"./chunk-3B4WXQCL.js";var $=[[/\.(png|jpe?g|gif|webp|bmp)$/i,e=>`from PIL import Image
img = Image.open(${JSON.stringify(e)})
print(img.size)`],[/\.(xlsx|xlsm)$/i,e=>`import openpyxl
wb = openpyxl.load_workbook(${JSON.stringify(e)})
print(wb.sheetnames)`],[/\.(db|sqlite3?)$/i,e=>`import sqlite3
con = sqlite3.connect(${JSON.stringify(e)})
print(con.execute("select name from sqlite_master").fetchall())`],[/\.(pkl|pickle)$/i,e=>`import pickle
with open(${JSON.stringify(e)}, "rb") as f:
    data = pickle.load(f)`],[/\.npy$/i,e=>`import numpy as np
a = np.load(${JSON.stringify(e)})`]];function O(e,s){let n=c(e),t=i("div",{class:"file-preview"}),o=null;y.test(n)?(o=URL.createObjectURL(new Blob([s],{type:p(n)})),t.append(i("div",{class:"fp-image"},i("img",{src:o,alt:n})))):t.append(i("div",{class:"fp-icon"},a("file",40))),t.append(i("div",{class:"fp-meta"},`${u(n,s)} ・ ${b(s.length)}`));let r=$.find(([l])=>l.test(n));if(r){let l=r[1](e);t.append(i("div",{class:"set-desc"},"Python で読むには:"),i("pre",{class:"fp-code"},l),i("button",{class:"btn small ghost",onclick:()=>d(l).then(()=>m("コピーしました",{icon:"copy"}))},a("copy",14),"コードをコピー"))}else t.append(i("div",{class:"set-desc"},`Python では open(${JSON.stringify(e)}, "rb") で読めます`));f({title:n,body:t,wide:!0,onClose:()=>{o&&URL.revokeObjectURL(o)},actions:[{label:"共有 / 保存",run:()=>(g(n,new Blob([s],{type:p(n)}),p(n)),!1)},{label:"閉じる",primary:!0,value:null}]})}export{O as previewFile};
