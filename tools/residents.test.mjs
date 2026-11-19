import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'garden-resident-test-'));process.env.GARDENER_DATA=temp;
const {createResidentManager,normalizePhone}=await import('../src/residents.mjs');
const {directAction}=await import('../src/voice-fast.mjs');
function fixture(){
 let saved={projectId:'test-project',projectSecret:'dummy-private-value',recipients:[{id:'razi',name:'Razi',phone:'+15555550101',aliases:['razee']}]};
 let users=[{id:'owner',type:'shared',phoneNumber:'+15555550999',meta:{project_owner:true}},{id:'user-razi',type:'shared',phoneNumber:'+15555550101',assignedPhoneNumber:'+15555550888',meta:{opt_in:true}}];
 const calls=[];let failedDelete=false,paid=false,offline=false;
 const manager=createResidentManager({read:async()=>structuredClone(saved),write:async c=>{saved=structuredClone(c);},request:async(c,path,method='GET',body)=>{
  calls.push({path,method,body});if(offline)throw Error('offline');
  if(path==='billing/subscription')return {tier:paid?'business':'free',subscription_id:paid?'paid':null,customer_id:null};
  if(path==='users/'&&method==='GET')return {users:structuredClone(users)};
  if(path==='users/'&&method==='POST'){
    const old=users.find(u=>u.phoneNumber===body.phoneNumber);
    if(old){old.firstName=body.firstName;return structuredClone(old);}
    const u={id:'new-'+users.length,type:'shared',phoneNumber:body.phoneNumber,firstName:body.firstName,assignedPhoneNumber:'+15555550777',meta:{}};users.push(u);return structuredClone(u);
  }
  if(method==='DELETE'){if(failedDelete)throw Error('provider delete failed');const id=decodeURIComponent(path.split('/')[1]);users=users.filter(u=>u.id!==id);return {userId:id};}
  throw Error('Unexpected request');
 }});
 return {manager,calls,get config(){return saved;},get users(){return users;},failDelete:()=>failedDelete=true,setPaid:()=>paid=true,setOffline:()=>offline=true};
}
test('normalize familiar phone formats, require country codes for international phones',()=>{
 assert.equal(normalizePhone('(555) 555-0102'),'+15555550102');assert.equal(normalizePhone('+44 20 7946 0123'),'+442079460123');
 assert.throws(()=>normalizePhone('555'),/country code/);assert.throws(()=>normalizePhone('call me'),/phone number/);
 assert.deepEqual(directAction('manage residents'),{name:'command',input:{name:'residents',arg:''}});
});
test('add a shared user without an invitation or guessed email; retain credentials and existing residents',async()=>{
 const f=fixture();const result=await f.manager.save({name:'Gui',phone:'555-555-0102',aliases:['Guy']});
 assert.equal(result.resident.state,'pending');assert.equal(result.resident.assignedPhoneNumber,'+15555550777');
 assert.equal(f.config.projectSecret,'dummy-private-value');assert.equal(f.config.recipients.length,2);
 assert.deepEqual(f.calls.find(c=>c.method==='POST').body,{type:'shared',phoneNumber:'+15555550102',firstName:'Gui'});
 assert.deepEqual(f.config.recipients[1].aliases,['guy']);
 const list=await f.manager.list();assert.equal(list.residents[0].state,'ready');assert.equal(list.residents[1].state,'pending');assert.ok(!JSON.stringify(list).includes('dummy-private-value'));
});
test('reject duplicate phones, names and speech aliases before provisioning',async()=>{
 const f=fixture();
 for(const input of [{name:'Other',phone:'+15555550101'},{name:'Razi',phone:'+15555550102'},{name:'New',phone:'+15555550102',aliases:['razee']}])await assert.rejects(f.manager.save(input),/already/);
 assert.equal(f.calls.length,0);assert.equal(f.config.recipients.length,1);
});
test('editing preserves stable identity and activation; phone replacement cannot silently retarget a person',async()=>{
 const f=fixture();const result=await f.manager.save({id:'razi',name:'Razi H',phone:'+15555550101',aliases:['razy']});
 assert.equal(result.resident.id,'razi');assert.equal(result.resident.state,'ready');assert.equal(f.config.recipients[0].name,'Razi H');
 await assert.rejects(f.manager.save({id:'razi',name:'Razi H',phone:'+15555550102'}),/replace a phone/);
});
test('concurrent saves serialize and do not overwrite each other',async()=>{
 const f=fixture();await Promise.all([f.manager.save({name:'Gui',phone:'+15555550102'}),f.manager.save({name:'Max',phone:'+15555550103'})]);
 assert.deepEqual(f.config.recipients.map(r=>r.id),['razi','gui','max']);
});
test('paid projects cannot provision or upgrade',async()=>{
 const f=fixture();f.setPaid();await assert.rejects(f.manager.save({name:'Gui',phone:'+15555550102'}),/zero-billing/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(f.config.recipients.length,1);
});
test('remove only the requested shared registration, preserving the project owner',async()=>{
 const f=fixture();await f.manager.remove('razi');assert.equal(f.config.recipients.length,0);assert.equal(f.users.length,1);assert.equal(f.users[0].id,'owner');
 assert.deepEqual(f.calls.filter(c=>c.method==='DELETE').map(c=>c.path),['users/user-razi/']);
 await assert.rejects(f.manager.remove('razi'),/already removed/);
});
test('failed removal retains saved recipient and offline activation is never marked ready',async()=>{
 const f=fixture();f.failDelete();await assert.rejects(f.manager.remove('razi'),/delete failed/);assert.equal(f.config.recipients.length,1);
 f.setOffline();const list=await f.manager.list();assert.equal(list.remoteAvailable,false);assert.equal(list.residents[0].state,'unknown');
});
test.after(async()=>rm(temp,{recursive:true,force:true}));
