// Keep device/paper defaults, but enforce the household's monochrome-only policy.
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const tags={integer:0x21,boolean:0x22,enum:0x23,text:0x41,name:0x42,keyword:0x44,uri:0x45,charset:0x47,language:0x48,mime:0x49};
function u16(n){const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;}
export function encodeIpp(operation,attributes,jobAttributes=[]){
 const header=Buffer.alloc(8);header[0]=1;header[1]=1;header.writeUInt16BE(operation,2);header.writeUInt32BE(1,4);
 const parts=[header];
 for(const [group,rows]of [[1,[['attributes-charset','charset','utf-8'],['attributes-natural-language','language','en'],...attributes]],[2,jobAttributes]]){
 if(!rows.length)continue;parts.push(Buffer.from([group]));
 for(const [name,type,value] of rows){
  for(const [i,v] of (Array.isArray(value)?value:[value]).entries()){
   const key=Buffer.from(i?'':name);let data;
   if(type==='integer'||type==='enum'){data=Buffer.alloc(4);data.writeInt32BE(v);}else if(type==='boolean')data=Buffer.from([v?1:0]);else data=Buffer.from(String(v));
   parts.push(Buffer.from([tags[type]]),u16(key.length),key,u16(data.length),data);
  }
 }
 }
 return Buffer.concat([...parts,Buffer.from([3])]);
}
export function decodeIpp(data){
 if(data.length<9)throw Error('Incomplete printer response');
 const groups=[];let group=null,name='',offset=8;
 while(offset<data.length){
  const tag=data[offset++];if(tag===3)break;
  if(tag<0x10){group={};groups.push(group);continue;}
  if(offset+2>data.length)throw Error('Incomplete printer attribute');
  const nl=data.readUInt16BE(offset);offset+=2;
  if(offset+nl+2>data.length)throw Error('Incomplete printer attribute');
  if(nl)name=data.toString('utf8',offset,offset+nl);offset+=nl;
  const vl=data.readUInt16BE(offset);offset+=2;if(offset+vl>data.length)throw Error('Incomplete printer value');
  const bytes=data.subarray(offset,offset+vl);offset+=vl;
  const value=(tag===0x21||tag===0x23)&&vl===4?bytes.readInt32BE():tag===0x22?!!bytes[0]:tag===0x32&&vl===9?{x:bytes.readInt32BE(0),y:bytes.readInt32BE(4),units:bytes[8]}:bytes.toString('utf8');
  if(group&&name){if(name in group)group[name]=[...([group[name]].flat()),value];else group[name]=value;}
 }
 return {status:data.readUInt16BE(2),groups,attributes:Object.assign({},...groups)};
}
export function ippRequest(uri,operation,attributes=[],document=null,jobAttributes=[]){
 const url=new URL(uri);if(!['ipp:','ipps:'].includes(url.protocol))throw Error('Configure an IPP printer URI.');
 const body=Buffer.concat([encodeIpp(operation,[['printer-uri','uri',uri],...attributes],jobAttributes),...(document?[document]:[])]);
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='ipps:'?https:http).request({hostname:url.hostname,port:url.port||(url.protocol==='ipps:'?443:631),path:url.pathname,method:'POST',headers:{'Content-Type':'application/ipp','Content-Length':body.length},timeout:15000},res=>{
   const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>1024*1024)req.destroy(Error('Printer response too large'));else chunks.push(b);});
   res.on('end',()=>{try{if(res.statusCode!==200)throw Error('Printer HTTP '+res.statusCode);const r=decodeIpp(Buffer.concat(chunks));resolve(r);}catch(e){e.uncertain=operation===2;reject(e);}});
   res.on('error',e=>{e.uncertain=operation===2;reject(e);});
  });
  req.on('timeout',()=>req.destroy(Error('Printer timed out')));
  req.on('error',e=>{e.uncertain=operation===2&&!['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH','ENETUNREACH'].includes(e.code);reject(e);});req.end(body);
 });
}
// Require a grayscale JPEG SOF, so color cannot slip through even if a driver
// ignores its monochrome setting. Never silently transform an approved artifact.
export function isMonochromeJpeg(bytes){
 if(bytes[0]!==0xff||bytes[1]!==0xd8)return false;
 let p=2;
 while(p+4<=bytes.length){
  if(bytes[p++]!==0xff)return false;while(bytes[p]===0xff)p++;
  const marker=bytes[p++];if(marker===0xda||marker===0xd9)return false;
  if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
  const size=bytes.readUInt16BE(p);if(size<2||p+size>bytes.length)return false;
  if([0xc0,0xc1,0xc2].includes(marker))return size>=8&&bytes[p+7]===1;
  p+=size;
 }return false;
}
export function createPrinter(uri,{request=ippRequest}={}){
 return {
  async inspect(){
   if(!uri)throw Error('No printer is configured.');
   const r=await request(uri,11,[['requested-attributes','keyword',['printer-name','printer-state','printer-is-accepting-jobs','printer-state-reasons','document-format-supported','media-default','media-ready','orientation-requested-default','sides-default','print-color-mode-default','print-color-mode-supported','printer-resolution-default','media-left-margin-supported','media-bottom-margin-supported','media-top-margin-supported','media-right-margin-supported']]]);
   if(r.status>255)throw Error('The printer did not return its settings.');
   return r.attributes;
  },
  async submit(file,title,expectedMedia,expectedHash){
   const attrs=await this.inspect();
   if(!attrs['printer-is-accepting-jobs'])throw Error('The printer is not accepting jobs.');
   if(attrs['media-default']!==expectedMedia)throw Error('The printer paper default changed. This template needs Letter paper; restore that default or add a matching paper template.');
   if(![attrs['document-format-supported']].flat().includes('image/jpeg'))throw Error('This printer cannot accept the approved JPEG.');
   if(![attrs['print-color-mode-supported']].flat().includes('monochrome'))throw Error('The printer did not confirm monochrome support. Nothing was sent.');
   const bytes=await readFile(file);
   if(!isMonochromeJpeg(bytes))throw Error('This older preview contains color. Create a new black-and-white preview before printing.');
   if(expectedHash&&createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Error('The approved print image changed. Review a new preview.');
   const r=await request(uri,2,[['requesting-user-name','name','GardenOS'],['job-name','name',title],['document-format','mime','image/jpeg']],bytes,[['print-color-mode','keyword','monochrome']]);
   if(r.status>255)throw Error(r.attributes['status-message']||'The printer rejected the job.');
   if(!r.attributes['job-id']){const e=Error('The printer response did not identify the job. Check its queue before trying again.');e.uncertain=true;throw e;}
   return {jobId:r.attributes['job-id'],jobState:r.attributes['job-state'],printer:attrs['printer-name'],status:'submitted'};
  },
  async find(title){
   const r=await request(uri,10,[['which-jobs','keyword','all'],['requested-attributes','keyword',['job-id','job-name','job-state']]]);
   if(r.status>255)throw Error('The printer queue could not be checked.');
   const row=r.groups.find(g=>g['job-name']===title);return row?{jobId:row['job-id'],jobState:row['job-state'],status:'submitted'}:null;
  }
 };
}
