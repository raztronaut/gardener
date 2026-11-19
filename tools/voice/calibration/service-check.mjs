// Real HTTP/state-machine checks in a separate service, using synthetic silence.
import {spawn,execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,symlinkSync,readFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'garden-room-service-'));mkdirSync(join(root,'voice'));symlinkSync(join(process.cwd(),'data/voice/models'),join(root,'voice/models'));const wav=join(root,'silence.wav');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','30',wav]);
const child=spawn(process.execPath,['src/voice.mjs'],{env:{...process.env,GARDENER_DATA:root,GARDENER_VOICE_PORT:'8897',GARDENER_VOICE_WAV:wav},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);
const url='http://127.0.0.1:8897',read=path=>fetch(url+path).then(r=>r.json()),post=async body=>{const r=await fetch(url+'/control',{method:'POST',body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
try{
 for(let i=0;i<150;i++){try{if((await read('/status')).state==='idle')break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert((await post({calibrationAction:'start'})).ok);assert.equal((await post({calibrationAction:'start'})).status,409);assert((await post({calibrationAction:'pause'})).ok);
 const paused=await read('/calibration');assert(paused.active&&paused.session.paused);const left=paused.session.left;await new Promise(r=>setTimeout(r,1100));assert.equal((await read('/calibration')).session.left,left);
 assert((await post({calibrationAction:'resume'})).ok);assert((await post({calibrationAction:'cancel'})).ok);assert.equal((await read('/status')).state,'idle');assert.equal((await read('/calibration')).active,false);
 assert((await post({calibrationAction:'start'})).ok);assert((await post({cancel:true})).ok);assert.equal((await read('/status')).state,'idle');assert(!existsSync(join(root,'voice','calibration.json')),'cancel must not save settings');
 const report=JSON.parse(readFileSync(join(root,'voice','room-calibration-report.json')));assert.equal(report.cancelled,true);assert(!('samples'in report));assert(!('transcript'in report));
 assert((await post({enabled:false})).ok);assert.equal((await post({calibrationAction:'start'})).status,409);console.log('PASS separate service: start/busy, pause/resume, both cancel paths, state cleanup, unchanged profile, metadata-only report, disabled rejection');
}finally{child.kill('SIGTERM');if(error)console.error(error.slice(-800));}
