// Public HTTPS only, with DNS pinned per request and redirect.
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
const block = new BlockList();
for (const [ip,n] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) block.addSubnet(ip,n,'ipv4');
for (const [ip,n] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]]) block.addSubnet(ip,n,'ipv6');
export function publicAddress(ip) { const v=isIP(ip);return !!v&&!block.check(ip,v===6?'ipv6':'ipv4'); }
export function feedURL(raw) {
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.href.length>2048)throw new Error('Use a public HTTPS website or RSS URL.');
  u.hash='';return u;
}
export async function fetchFeedURL(raw,{etag,lastModified}={},hops=0) {
  const u=feedURL(raw), host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=await lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('That address is not a public feed.');
  const chosen=addresses.find(a=>a.family===4)||addresses[0];
  const result=await new Promise((resolve,reject)=>{
    const req=https.get(u,{agent:false,lookup:(_host,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family),headers:{'user-agent':'GardenOS Feed Reader','accept':'application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, application/xml, text/html;q=0.5',...(etag?{'if-none-match':etag}:{}),...(lastModified?{'if-modified-since':lastModified}:{})}},res=>{
      const chunks=[];let bytes=0;
      res.on('data',c=>{bytes+=c.length;if(bytes>1048576){res.destroy(new Error('Feed exceeds 1 MB.'));return;}chunks.push(c);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),url:u.href}));
    });
    const deadline=setTimeout(()=>req.destroy(new Error('Feed timed out.')),8000);
    req.on('close',()=>clearTimeout(deadline));req.on('error',reject);
  });
  if([301,302,303,307,308].includes(result.status)) {
    if(hops>=3||!result.headers.location)throw new Error('Too many feed redirects.');
    return fetchFeedURL(new URL(result.headers.location,u).href,{},hops+1);
  }
  if(result.status!==200&&result.status!==304)throw new Error(`Publisher returned HTTP ${result.status}.`);
  return result;
}
