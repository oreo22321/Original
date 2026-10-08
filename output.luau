-- /$$$$$  /$$$$$$$$ /$$$$$$ | $$  /$$$$$$
--/$$__ $$ | $$_____/ | $$  \__/ | $$ | $$__
--| $$ \ $$ | $$      | $$ /$$$$ | $$ | $$
--| $$$$$$$ | $$$$$   | $$|_  $$ | $$ |  $$$$$
--| $$__ $$ | $$__    | $$  \ $$ | $$  \____ $
--| $$  \ $$ | $$_____/ |  $$$$$$/ | $$  /$$  \$$
--|__/  |__/ | $$$$$$$ \______/ |__/ |  $$$$$/
-- AegisLuau V4 generated output
local m2015=function(v)local n=v[1];local s={};for i=1,n do local x=v[i+1];local k=(114+251*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;s[i]=string.char(x~k) end;return table.concat(s) end
local _0x5fa3d5=function(n)return _G[n] end
local r7085=setmetatable({},{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end})
local q=function(n,v)r7085[n]=v;_G[n]=v end
local a8125
local q9559={[23]=function(m6053) local v=m6053.P.z[m6053.b+1];local t=v[1];if t==1 then local n=v[2];local z={};for i=1,n do local x=v[i+2];local k=(237+153*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;z[i]=string.char(x~k) end;m6053.r[m6053.a]=table.concat(z) elseif t==0 then m6053.r[m6053.a]=nil elseif t==2 then m6053.r[m6053.a]=true elseif t==3 then m6053.r[m6053.a]=false elseif t==4 then m6053.r[m6053.a]=((v[2]~4)-v[4])/v[3] elseif t==5 then m6053.r[m6053.a]=v[2]-v[3] end end,[12]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b] end,[33]=function(m6053) m6053.r[m6053.a]=_0x5fa3d5(m2015(m6053.P.n[m6053.b+1)) end,[2]=function(m6053) q(m2015(m6053.P.n[m6053.a+1)),m6053.r[m6053.b]) end,[26]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b][m6053.r[m6053.c]] end,[28]=function(m6053) m6053.r[m6053.a][m6053.r[m6053.b]]=m6053.r[m6053.c] end,[5]=function(m6053) m6053.r[m6053.a]={} end,[21]=function(m6053) m6053.r[m6053.a]=a8125(m6053.P.f[m6053.b+1]) end,[29]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b](table.unpack(m6053.r[m6053.c])) end,[11]=function(m6053) m6053.ret=true;m6053.rv=m6053.r[m6053.a] end,[22]=function(m6053) m6053.pc=m6053.a end,[30]=function(m6053) if not m6053.r[m6053.a] then m6053.pc=m6053.b end end,[6]=function(m6053) local cur=m6053.r[m6053.a];local lim=m6053.r[m6053.b];local stp=m6053.r[m6053.c];if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then m6053.pc=m6053.k end end,[7]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]+m6053.r[m6053.c] end,[17]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]-m6053.r[m6053.c] end,[20]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]*m6053.r[m6053.c] end,[25]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]/m6053.r[m6053.c] end,[14]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]//m6053.r[m6053.c] end,[31]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]%m6053.r[m6053.c] end,[1]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]^m6053.r[m6053.c] end,[34]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]..m6053.r[m6053.c] end,[9]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]==m6053.r[m6053.c] end,[8]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]~=m6053.r[m6053.c] end,[27]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]<m6053.r[m6053.c] end,[13]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]>m6053.r[m6053.c] end,[32]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]<=m6053.r[m6053.c] end,[3]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b]>=m6053.r[m6053.c] end,[24]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b] and m6053.r[m6053.c] end,[10]=function(m6053) m6053.r[m6053.a]=m6053.r[m6053.b] or m6053.r[m6053.c] end,[18]=function(m6053) m6053.r[m6053.a]=not m6053.r[m6053.b] end,[19]=function(m6053) m6053.r[m6053.a]=-m6053.r[m6053.b] end,[16]=function(m6053) m6053.r[m6053.a]=#m6053.r[m6053.b] end,[4]=function(m6053) m6053.r[m6053.a]=~m6053.r[m6053.b] end,[15]=function(m6053) m6053.junk=(((m6053.junk or 0)*1103515245+12345)%2147483647) end,}
local b={s={144,176,193,210,227,219,15,28,45,62,66,103,119,136,153,181,196,210,227,244,28,30,44,62,79,122,114,138,152,170,220,209,231,241,5,23,41,62,79,96},z={{1,3,133,159,119},{4,8859,3,8860}},p={},n={{5,2,248,1,104,42}},q={},r=5,f={}}
local function _0xe923d3(a2071,...)
 local r9472={};for i=1,a2071.r do r9472[i]=nil end
 local st={P=a2071,r=r9472,pc=1,ret=false,rv=nil,junk=0,a=0,b=0,c=0,k=0}
 local argv={...};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end
 while not st.ret do
  local p=st.P;local base=(st.pc-1)*5;local function rd(slot) local x=p.s[base+slot];local k=(159+(slot-1)*17+91*(st.pc-1))%256;return x~k end
  if base+5>#p.s then break end
  st.op=rd(1);st.a=rd(2);st.b=rd(3);st.c=rd(4);st.k=rd(5)
  local h=q9559[st.op];if not h then error('AEGIS VM dispatch fault') end
  h(st)
  st.pc=st.pc+1
 end
 return st.rv end
a8125=function(p)return function(...)return _0xe923d3(p,...)end end
return _0xe923d3(b)
