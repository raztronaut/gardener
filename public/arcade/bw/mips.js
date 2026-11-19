// Bounded R3000 routine interpreter. Game bytes remain in private household data.
export class Mips {
  constructor(bytes) { this.bytes = bytes; this.mem = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.r = new Int32Array(32); this.hooks = new Map(); this.count = 0; }
  addr(a) { const p = a & 0x1fffffff; if (p >= this.bytes.length) throw Error(`Unmapped ${ (a>>>0).toString(16)} at ${(this.pc>>>0).toString(16)}`); return p; }
  u8(a) { return this.mem.getUint8(this.addr(a)); }
  u16(a) { return this.mem.getUint16(this.addr(a), true); }
  u32(a) { return this.mem.getUint32(this.addr(a), true); }
  w8(a,v) { this.mem.setUint8(this.addr(a),v); }
  w16(a,v) { this.mem.setUint16(this.addr(a),v,true); }
  w32(a,v) { this.mem.setUint32(this.addr(a),v,true); }
  call(pc,args=[],limit=2000000) {
    const r=this.r; r.fill(0); r[28]=0x800789f0; r[29]=0x801ff000; r[31]=0x80000000;
    args.forEach((v,i)=>r[4+i]=v); this.pc=pc>>>0; this.next=(pc+4)>>>0; this.loadReg=0; this.loadValue=0; this.hi=0;this.lo=0;
    for(let n=0;n<limit;n++) { if(this.pc===0x80000000) {this.count=n;return r[2]>>>0;} this.step(); }
    throw Error(`Routine ${pc.toString(16)} exceeded limit at ${this.pc.toString(16)}`);
  }
  step() {
    const r=this.r, pc=this.pc, hook=this.hooks.get(pc);
    if(hook) { if(this.loadReg) r[this.loadReg]=this.loadValue;this.loadReg=0; const ret=hook(this); if(ret!==undefined)r[2]=ret;this.pc=r[31]>>>0;this.next=(this.pc+4)>>>0;r[0]=0;return; }
    const ins=this.u32(pc),op=ins>>>26,rs=ins>>>21&31,rt=ins>>>16&31,rd=ins>>>11&31,sa=ins>>>6&31,fn=ins&63,imm=ins<<16>>16;
    const a=r[rs],b=r[rt],merge=this.loadReg===rt?this.loadValue:b;
    if(this.loadReg)r[this.loadReg]=this.loadValue;this.loadReg=0;
    const next=this.next; let after=(next+4)>>>0; const address=(a+imm)>>>0;
    const ld=v=>{this.loadReg=rt;this.loadValue=v|0;};
    if(op===0) {
      switch(fn) {
        case 0:r[rd]=b<<sa;break;case 2:r[rd]=b>>>sa;break;case 3:r[rd]=b>>sa;break;
        case 4:r[rd]=b<<(a&31);break;case 6:r[rd]=b>>>(a&31);break;case 7:r[rd]=b>>(a&31);break;
        case 8:after=a>>>0;break;case 9:r[rd]=pc+8;after=a>>>0;break;
        case 16:r[rd]=this.hi;break;case 17:this.hi=a;break;case 18:r[rd]=this.lo;break;case 19:this.lo=a;break;
        case 24:case 25:{const p=BigInt(fn===24?a:a>>>0)*BigInt(fn===24?b:b>>>0);this.lo=Number(BigInt.asIntN(32,p));this.hi=Number(BigInt.asIntN(32,p>>32n));break;}
        case 26: if(b===0){this.lo=a<0?1:-1;this.hi=a;}else{this.lo=(a/b)|0;this.hi=a%b;}break;
        case 27: if(b===0){this.lo=-1;this.hi=a;}else{this.lo=((a>>>0)/(b>>>0))|0;this.hi=(a>>>0)%(b>>>0);}break;
        case 32:case 33:r[rd]=a+b;break;case 34:case 35:r[rd]=a-b;break;case 36:r[rd]=a&b;break;case 37:r[rd]=a|b;break;case 38:r[rd]=a^b;break;case 39:r[rd]=~(a|b);break;
        case 42:r[rd]=+(a<b);break;case 43:r[rd]=+((a>>>0)<(b>>>0));break;
        default:throw Error(`SPECIAL ${fn.toString(16)} at ${pc.toString(16)}`);
      }
    } else switch(op) {
      case 1:if(rt===16||rt===17)r[31]=pc+8;if((rt&1)?a>=0:a<0)after=(pc+4+(imm<<2))>>>0;break;
      case 2:case 3:if(op===3)r[31]=pc+8;after=((pc+4)&0xf0000000)|((ins&0x3ffffff)<<2);break;
      case 4:if(a===b)after=pc+4+(imm<<2);break;case 5:if(a!==b)after=pc+4+(imm<<2);break;
      case 6:if(a<=0)after=pc+4+(imm<<2);break;case 7:if(a>0)after=pc+4+(imm<<2);break;
      case 8:case 9:r[rt]=a+imm;break;case 10:r[rt]=+(a<imm);break;case 11:r[rt]=+((a>>>0)<(imm>>>0));break;
      case 12:r[rt]=a&(ins&65535);break;case 13:r[rt]=a|(ins&65535);break;case 14:r[rt]=a^(ins&65535);break;case 15:r[rt]=ins<<16;break;
      case 32:ld(this.u8(address)<<24>>24);break;case 33:ld(this.u16(address)<<16>>16);break;case 35:ld(this.u32(address));break;
      case 36:ld(this.u8(address));break;case 37:ld(this.u16(address));break;
      case 34:{const s=(address&3)*8;ld((merge & (0xffffff >>> s)) | (this.u32(address&~3) << (24-s)));break;}
      case 38:{const s=(address&3)*8;ld((merge & (s===0?0:0xffffffff<<(32-s))) | (this.u32(address&~3) >>> s));break;}
      case 40:this.w8(address,b);break;case 41:this.w16(address,b);break;case 43:this.w32(address,b);break;
      case 42:{const s=(address&3)*8,old=this.u32(address&~3);this.w32(address&~3,(old & (s===24?0:0xffffffff<<(s+8))) | (b>>>(24-s)));break;}
      case 46:{const s=(address&3)*8,old=this.u32(address&~3);this.w32(address&~3,(old & (s===0?0:0xffffffff>>>(32-s))) | (b<<s));break;}
      default:throw Error(`Opcode ${op.toString(16)} (${ins.toString(16)}) at ${pc.toString(16)}`);
    }
    r[0]=0;this.pc=next>>>0;this.next=after>>>0;
  }
}
