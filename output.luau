-- /$$$$$$     /$$$$$$$$     /$$$$$$      /$$$$$$      /$$$$$$$
--| $$__  $$    | $$_____/   | $$  \__/   |_  $$_/    | $$____/
--| $$  \ $$   | $$         | $$ /$$$$      | $$      | $$
--| $$$$$$$$    | $$$$$      | $$|_  $$      | $$      | $$$$$$$
--| $$__  $$    | $$__/      | $$  \ $$     | $$      |____  $$
--| $$  | $$    | $$         |  $$$$$$/      | $$       /$$  \ $$
--|__/  |__/    | $$$$$$$$    \______/      /$$$$$$    |  $$$$$$/
-- AegisLuau V3 generated output
local r=94
local a1167=function(a)local s={};for i=1,#a do s[i]=string.char(a[i]~r) end;return table.concat(s) end
local x50=function(n)return _G[n] end
local r6738=setmetatable({},{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end})
local b1674=function(n,v)r6738[n]=v;_G[n]=v end
local m=setmetatable({},{__index=function(t,k)local x=r6738[k];if x~=nil then return x end;return _G[k] end})
local _0x8e3cb9
local q3722={[4]=function(r9881) local v=r9881.P.z[r9881.b+1];local t=v[1];if t==1 then r9881.r[r9881.a]=a1167(v[2]) elseif t==0 then r9881.r[r9881.a]=nil elseif t==2 then r9881.r[r9881.a]=true elseif t==3 then r9881.r[r9881.a]=false elseif t==4 then r9881.r[r9881.a]=(v[2]-v[4])/v[3] elseif t==5 then r9881.r[r9881.a]=v[2]-v[3] end end,[8]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b] end,[27]=function(r9881) r9881.r[r9881.a]=x50(a1167(r9881.P.n[r9881.b+1])) end,[10]=function(r9881) b1674(a1167(r9881.P.n[r9881.a+1]),r9881.r[r9881.b]) end,[6]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b][r9881.r[r9881.c]] end,[34]=function(r9881) r9881.r[r9881.a][r9881.r[r9881.b]]=r9881.r[r9881.c] end,[28]=function(r9881) r9881.r[r9881.a]={} end,[32]=function(r9881) r9881.r[r9881.a]=_0x8e3cb9(r9881.P.f[r9881.b+1]) end,[25]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b](table.unpack(r9881.r[r9881.c])) end,[21]=function(r9881) r9881.ret=true;r9881.rv=r9881.r[r9881.a] end,[24]=function(r9881) r9881.pc=r9881.a end,[22]=function(r9881) if not r9881.r[r9881.a] then r9881.pc=r9881.b end end,[29]=function(r9881) if r9881.r[r9881.a]>r9881.r[r9881.b] then r9881.pc=r9881.k end end,[17]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]+r9881.r[r9881.c] end,[18]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]-r9881.r[r9881.c] end,[11]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]*r9881.r[r9881.c] end,[2]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]/r9881.r[r9881.c] end,[15]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]//r9881.r[r9881.c] end,[12]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]%r9881.r[r9881.c] end,[13]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]^r9881.r[r9881.c] end,[20]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]..r9881.r[r9881.c] end,[23]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]==r9881.r[r9881.c] end,[19]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]~=r9881.r[r9881.c] end,[7]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]<r9881.r[r9881.c] end,[30]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]>r9881.r[r9881.c] end,[26]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]<=r9881.r[r9881.c] end,[31]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b]>=r9881.r[r9881.c] end,[9]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b] and r9881.r[r9881.c] end,[16]=function(r9881) r9881.r[r9881.a]=r9881.r[r9881.b] or r9881.r[r9881.c] end,[33]=function(r9881) r9881.r[r9881.a]=not r9881.r[r9881.b] end,[5]=function(r9881) r9881.r[r9881.a]=-r9881.r[r9881.b] end,[1]=function(r9881) r9881.r[r9881.a]=#r9881.r[r9881.b] end,[3]=function(r9881) r9881.r[r9881.a]=~r9881.r[r9881.b] end,[14]=function(r9881) r9881.junk=(((r9881.junk or 0)*1103515245+12345)%2147483647) end,}
local q={o={33,58},a={58,59},b={8,8},c={5,5},k={63,63},z={},p={},n={},q={},r=1,f={}}
local b3122=534222347
local function q699(_0x89fd31,...)
 local a1055, _0x5bc9c4 = {}, 1
 for i=1,_0x89fd31.r do a1055[i]=nil end
 local st={P=_0x89fd31,r=a1055,pc=1,ret=false,rv=nil,z=_0x89fd31.z,junk=0,a=0,b=0,c=0,k=0,I=0}
 local argv={...};for i=1,#argv do local rr=st.P.q[i]; if rr then st.r[rr]=argv[i] end end
 while not st.ret do
  local p=st.P; if st.pc>#p.o then break end
  local q=(p.o[st.pc]~47); local h=q3722[q]; if not h then error('VM dispatch fault') end
  st.a=(p.a[st.pc]~58); st.b=(p.b[st.pc]~8); st.c=(p.c[st.pc]~5); st.k=(p.k[st.pc]~63); st.I=st.pc
  -- dispatch permutation + opaque branch
  if (((598*598)-(597*597))==(1195) and ((148~(148~598))==598)) then h(st) else h(st) end
  st.pc=st.pc+1
 end
 return st.rv end
_0x8e3cb9=function(p)return function(...)return q699(p,...)end end
local __dg={114,101,116,117,114,110,32,102,117,110,99,116,105,111,110,40,120,41,32,114,101,116,117,114,110,32,120,32,43,32,48,32,101,110,100};local __ds=a1167(__dg);local __loader=loadstring or load;local __dynamic=nil;if __loader then local __f=__loader(__ds);if __f then __dynamic=__f() end end
local __seal=(1320612494~47~58~8~5~63);if __seal==0 and __dynamic then return __dynamic(0) end
local __fallback_key=75; local __fallback_chunks={{59,57,34,37,63,99,105,60,35,36,107,34,56,107,44,36,47,116,116,107,2,63,107,38,46,98}}
local function __fallback() local z={};for _,q in ipairs(__fallback_chunks) do for i=1,#q do z[#z+1]=string.char(q[i]~__fallback_key) end end;local f,e=(loadstring or load)(table.concat(z));if not f then error(e) end;return f() end
return __fallback()
