--   /$$$$$$    /$$$$$$$$   /$$$$$$  /$$$$$$  /$$$$$$
--  /$$__  $$  | $$_____/  /$$__  $$|_  $$_/ /$$__  $$
-- | $$  \ $$  | $$       | $$  \ $$  | $$  | $$  \__/
-- | $$ /$$$$  | $$$$$    | $$ /$$$$  | $$  |  $$$$$$
-- | $$|_  $$  | $$__/    | $$|_  $$  | $$   \____  $$
-- | $$  \ $$  | $$       | $$  \ $$  | $$  /$$  \ $$
-- |  $$$$$$/  | $$$$$$$$ |  $$$$$$/ /$$$$$$|  $$$$$$/
--  \______/  |________/  \______/ |______/ \______/
-- AegisLuau V4 generated output
local q7860=function(v)local n=v[1];local s={};for i=1,n do local x=v[i+1];local k=(147+157*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;s[i]=string.char(x~k) end;return table.concat(s) end
local m7930=function(n)return _G[n] end
local r=setmetatable({},{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end})
local m1921=function(n,v)r[n]=v;_G[n]=v end
local x
local a6079={[17]=function(a) local v=a.P.z[a.b+1];local t=v[1];if t==1 then local n=v[2];local z={};for i=1,n do local x=v[i+2];local k=(59+10*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;z[i]=string.char(x~k) end;a.r[a.a]=table.concat(z) elseif t==0 then a.r[a.a]=nil elseif t==2 then a.r[a.a]=true elseif t==3 then a.r[a.a]=false elseif t==4 then a.r[a.a]=((v[2]~241)-v[4])/v[3] elseif t==5 then a.r[a.a]=v[2]-v[3] end end,[22]=function(a) a.r[a.a]=a.r[a.b] end,[3]=function(a) a.r[a.a]=m7930(q7860(a.P.n[a.b+1)) end,[20]=function(a) m1921(q7860(a.P.n[a.a+1)),a.r[a.b]) end,[14]=function(a) a.r[a.a]=a.r[a.b][a.r[a.c]] end,[31]=function(a) a.r[a.a][a.r[a.b]]=a.r[a.c] end,[1]=function(a) a.r[a.a]={} end,[26]=function(a) a.r[a.a]=x(a.P.f[a.b+1]) end,[25]=function(a) a.r[a.a]=a.r[a.b](table.unpack(a.r[a.c])) end,[21]=function(a) a.ret=true;a.rv=a.r[a.a] end,[8]=function(a) a.pc=a.a end,[24]=function(a) if not a.r[a.a] then a.pc=a.b end end,[13]=function(a) local cur=a.r[a.a];local lim=a.r[a.b];local stp=a.r[a.c];if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then a.pc=a.k end end,[12]=function(a) a.r[a.a]=a.r[a.b]+a.r[a.c] end,[29]=function(a) a.r[a.a]=a.r[a.b]-a.r[a.c] end,[9]=function(a) a.r[a.a]=a.r[a.b]*a.r[a.c] end,[15]=function(a) a.r[a.a]=a.r[a.b]/a.r[a.c] end,[34]=function(a) a.r[a.a]=a.r[a.b]//a.r[a.c] end,[2]=function(a) a.r[a.a]=a.r[a.b]%a.r[a.c] end,[16]=function(a) a.r[a.a]=a.r[a.b]^a.r[a.c] end,[19]=function(a) a.r[a.a]=a.r[a.b]..a.r[a.c] end,[11]=function(a) a.r[a.a]=a.r[a.b]==a.r[a.c] end,[23]=function(a) a.r[a.a]=a.r[a.b]~=a.r[a.c] end,[28]=function(a) a.r[a.a]=a.r[a.b]<a.r[a.c] end,[33]=function(a) a.r[a.a]=a.r[a.b]>a.r[a.c] end,[10]=function(a) a.r[a.a]=a.r[a.b]<=a.r[a.c] end,[5]=function(a) a.r[a.a]=a.r[a.b]>=a.r[a.c] end,[32]=function(a) a.r[a.a]=a.r[a.b] and a.r[a.c] end,[27]=function(a) a.r[a.a]=a.r[a.b] or a.r[a.c] end,[6]=function(a) a.r[a.a]=not a.r[a.b] end,[4]=function(a) a.r[a.a]=-a.r[a.b] end,[18]=function(a) a.r[a.a]=#a.r[a.b] end,[7]=function(a) a.r[a.a]=~a.r[a.b] end,[30]=function(a) a.junk=(((a.junk or 0)*1103515245+12345)%2147483647) end,}
local r1238={s={168,199,216,233,250,31,41,62,79,96,147,150,164,181,198,233,248,10,27,44,95,93,113,129,146,171,196,212,226,248,3,40,56,76,94,149,149,162,179,196},z={{1,3,122,56,12},{4,6098,9,5914}},p={},n={{5,227,18,164,32,115}},q={},r=5,f={}}
local function a3324(b2677,...)
 local v7470={};for i=1,b2677.r do v7470[i]=nil end
 local st={P=b2677,r=v7470,pc=1,ret=false,rv=nil,junk=0,a=0,b=0,c=0,k=0}
 local argv={...};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end
 while not st.ret do
  local p=st.P;local base=(st.pc-1)*5;local function rd(slot) local x=p.s[base+slot];local k=(182+(slot-1)*17+102*(st.pc-1))%256;return x~k end
  if base+5>#p.s then break end
  st.op=rd(1);st.a=rd(2);st.b=rd(3);st.c=rd(4);st.k=rd(5)
  local h=a6079[st.op];if not h then error('AEGIS VM dispatch fault') end
  h(st)
  st.pc=st.pc+1
 end
 return st.rv end
x=function(p)return function(...)return a3324(p,...)end end
return a3324(r1238)
