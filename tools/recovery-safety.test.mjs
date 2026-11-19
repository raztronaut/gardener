import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=resolve(fileURLToPath(new URL('..',import.meta.url)));
async function fixture(t){
 const root=await fs.mkdtemp(join(tmpdir(),'garden-preservation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp(join(source,'src'),join(root,'src'),{recursive:true});await fs.symlink(join(source,'node_modules'),join(root,'node_modules'),'dir');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Test');
 await fs.writeFile(join(root,'.gitignore'),'data/\nnode_modules/\n');await fs.writeFile(join(root,'tracked.txt'),'original');git('add','.');git('commit','-qm','baseline');const head=git('rev-parse','HEAD');
 const node=code=>execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8',env:{...process.env,GARDENER_DATA:join(root,'data'),ANTHROPIC_API_KEY:'',GARDENER_NO_RECOVER:'1'}});
 return {root,git,head,node};
}
test('timer skips tracked, staged and untracked edits without consuming feedback or changing files',async t=>{
 const {root,git,head,node}=await fixture(t);
 await fs.writeFile(join(root,'tracked.txt'),'human edit');await fs.writeFile(join(root,'staged.txt'),'staged edit');git('add','staged.txt');await fs.mkdir(join(root,'new-widget'));await fs.writeFile(join(root,'new-widget/widget.js'),'untracked widget');
 const status=git('status','--porcelain','-uall');const out=node("process.argv[2]='timer';await import('./src/iterate.mjs');");assert.match(out,/skipping tending without changing files/);
 assert.equal(git('status','--porcelain','-uall'),status);assert.equal(git('rev-parse','HEAD'),head);assert.equal(await fs.readFile(join(root,'tracked.txt'),'utf8'),'human edit');assert.equal(await fs.readFile(join(root,'new-widget/widget.js'),'utf8'),'untracked widget');
 node("import {unfinishedIterations} from './src/db.mjs';if(unfinishedIterations().length)throw Error('created an iteration');");
});
test('destructive compatibility API refuses even a clean tree; later edits also survive',async t=>{
 const {root,git,head,node}=await fixture(t);const attempt="import {resetHard} from './src/gitlib.mjs';try{resetHard('HEAD~1');throw Error('reset allowed')}catch(e){if(!e.message.includes('disabled'))throw e}";
 node(attempt);await fs.writeFile(join(root,'new.txt'),'preserve me');node(attempt);assert.equal(git('rev-parse','HEAD'),head);assert.equal(await fs.readFile(join(root,'new.txt'),'utf8'),'preserve me');
});
test('crash recovery preserves dirty work and newer HEAD without reporting a rollback',async t=>{
 const {root,git,head,node}=await fixture(t);await fs.writeFile(join(root,'tracked.txt'),'new committed work');git('add','tracked.txt');git('commit','-qm','newer human work');const newer=git('rev-parse','HEAD');
 await fs.writeFile(join(root,'tracked.txt'),'new uncommitted work');await fs.writeFile(join(root,'new.txt'),'new widget');
 // Stub only iteration bookkeeping: exercise the real recovery and git modules.
 await fs.writeFile(join(root,'src/db.mjs'),`export const unfinishedIterations=()=>[{id:172,pid:99999999,status:'running',base_commit:${JSON.stringify(head)}}];export const finishIteration=(id,status,details)=>{if(status!=='crashed'||!details.error.includes('preserved'))throw Error('incorrect recovery status')};export const clearStaleLock=()=>{};export const pidAlive=()=>false;`);
 node("import {recover} from './src/recover.mjs';recover();");assert.equal(git('rev-parse','HEAD'),newer);assert.equal(await fs.readFile(join(root,'tracked.txt'),'utf8'),'new uncommitted work');assert.equal(await fs.readFile(join(root,'new.txt'),'utf8'),'new widget');
});
test('Git status errors fail closed rather than treating unknown state as clean',async t=>{
 const {root,node}=await fixture(t);await fs.rename(join(root,'.git'),join(root,'.git-disabled'));
 assert.throws(()=>node("import {isDirty} from './src/gitlib.mjs';isDirty();"));
});
