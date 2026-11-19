// Explicit host boundary: BIOS memory/random helpers and sound scheduling.
export function installHost(m,onSound=()=>{}) {
 m.hooks.set(0x80014a78,c=>{onSound(c.r[4]&65535,c.r[5]&65535);return 0;});
 m.hooks.set(0xa0,c=>{
  const r=c.r,a=r[4]>>>0,b=r[5]>>>0,n=r[6]>>>0;
  switch(r[9]) {
   case 0x28:if(!a||(b|0)<=0)return 0;c.bytes.fill(0,c.addr(a),c.addr(a)+b);r[4]=a+b;r[5]=0;return a;
   case 0x2a:if(n)c.bytes.copyWithin(c.addr(a),c.addr(b),c.addr(b)+n);return a;
   case 0x2b:if(n)c.bytes.fill(b&255,c.addr(a),c.addr(a)+n);return a;
   case 0x2f:{const s=(Math.imul(c.u32(0x9010),1103515245)+12345)>>>0;c.w32(0x9010,s);r[3]=s;return (s>>>16)&32767;}
   case 0x30:c.w32(0x9010,a);return;
   default:throw Error(`Unsupported BIOS A0:${r[9].toString(16)} from ${(r[31]>>>0).toString(16)}`);
  }
 });
}
