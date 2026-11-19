import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'garden-setup-test-'));
const project='00000000-0000-4000-8000-000000000001';
const script=fileURLToPath(new URL('./setup-messaging.mjs',import.meta.url));
const cli=join(root,'photon');
await writeFile(cli,`#!/usr/bin/env node
if(process.env.TEST_CLI_FAIL){process.stderr.write('dummy-secret-must-not-escape');process.exit(1)}
console.log(JSON.stringify(process.argv.includes('secret')?{projectSecret:'dummy-secret-must-not-escape'}:{name:'Test project',plan:process.env.TEST_PLAN||'free'}));
`,{mode:0o700});
const mock=join(root,'mock.mjs');await writeFile(mock,"globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({succeed:true,data:{tier:'free',subscription_id:null,customer_id:null}})});\n");
async function run(directory,extra={}){
 try{const result=await exec(process.execPath,['--import',mock,script,'--project',project],{env:{...process.env,GARDENER_DATA:directory,PHOTON_CLI:cli,...extra}});return {ok:true,...result};}
 catch(e){return {ok:false,stdout:e.stdout||'',stderr:e.stderr||''};}
}
test('owner bootstrap privately writes credentials and preserves existing recipients',async()=>{
 const directory=join(root,'good');await mkdir(join(directory,'messages'),{recursive:true});const config=join(directory,'messages/config.json');
 await writeFile(config,JSON.stringify({projectId:project,projectSecret:'old-dummy',recipients:[{id:'resident',name:'Resident',phone:'+15555550101'}]}));
 const result=await run(directory);assert.equal(result.ok,true);assert.ok(!result.stdout.includes('dummy-secret'));assert.ok(!result.stderr.includes('dummy-secret'));
 const saved=JSON.parse(await readFile(config));assert.equal(saved.recipients.length,1);assert.equal(saved.projectSecret,'dummy-secret-must-not-escape');assert.equal((await stat(config)).mode&0o777,0o600);
});
test('a different configured project and a paid project are preserved, not overwritten',async()=>{
 const directory=join(root,'different');await mkdir(join(directory,'messages'),{recursive:true});const config=join(directory,'messages/config.json');const original=JSON.stringify({projectId:'another-project',recipients:[]});await writeFile(config,original);
 const result=await run(directory);assert.equal(result.ok,false);assert.equal(await readFile(config,'utf8'),original);
 const paid=await run(join(root,'paid'),{TEST_PLAN:'business'});assert.equal(paid.ok,false);assert.match(paid.stderr,/not free/);
});
test('CLI failure never prints captured secrets',async()=>{
 const result=await run(join(root,'failure'),{TEST_CLI_FAIL:'1'});assert.equal(result.ok,false);assert.ok(!result.stderr.includes('dummy-secret'));assert.match(result.stderr,/CLI request failed/);
});
test.after(async()=>rm(root,{recursive:true,force:true}));
