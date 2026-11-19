// Daily source files, server-side credentials; never log credential-bearing URLs.
import '../../src/config.mjs';
import {paths} from '../../src/config.mjs';
import {mkdir,writeFile,rename,stat} from 'node:fs/promises';
await mkdir(paths.DATA+'/transit',{recursive:true});
for(const agency of ['SF','BA']){
 const path=`${paths.DATA}/transit/${agency}.zip`;
 try{if(Date.now()-(await stat(path)).mtimeMs<86400000){console.log(agency,'cached');continue;}}catch{}
 const url=new URL('https://api.511.org/transit/datafeeds');url.search=new URLSearchParams({api_key:process.env.GARDENER_511_KEY,operator_id:agency});
 try{const r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Download unavailable');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>100*1024*1024||bytes[0]!==80||bytes[1]!==75)throw Error('Invalid feed');await writeFile(path+'.tmp',bytes);await rename(path+'.tmp',path);console.log(agency,bytes.length,'bytes');}catch{console.error(agency,'schedule download failed');process.exitCode=1;}
}
