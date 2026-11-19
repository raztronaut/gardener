// Owner setup only. Captures CLI secrets privately, never prints them.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {paths} from '../src/config.mjs';
import {requireFreeProject} from '../src/messages.mjs';
const run=promisify(execFile);
async function cli(args){
  let result;try{result=await run(process.env.PHOTON_CLI||'photon',args,{timeout:30000,maxBuffer:1024*1024});}
  catch{throw Error('Photon CLI request failed. Install the CLI and run photon login --no-browser, then retry.');}
  try{return JSON.parse(result.stdout);}catch{throw Error('Photon CLI returned an unexpected response. No configuration was changed.');}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--project'||!/^[a-f0-9-]{36}$/i.test(args[1]))throw Error('Usage: node tools/setup-messaging.mjs --project PROJECT_ID');
  const id=args[1],directory=join(paths.DATA,'messages'),file=join(directory,'config.json');
  let current;try{current=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Existing messaging configuration could not be read. It was preserved.');}
  if(current&&current.projectId!==id)throw Error('A different Photon project is already configured. It was preserved.');
  const project=await cli(['projects','show','--project',id,'--json']);
  if(project.plan!=='free')throw Error('This project is not free. No configuration was changed.');
  const secret=await cli(['projects','secret','--project',id,'--json']);
  if(typeof secret.projectSecret!=='string'||!secret.projectSecret)throw Error('The project has no usable secret.');
  const next={...current,projectId:id,projectSecret:secret.projectSecret,recipients:current?.recipients||[]};
  await requireFreeProject(next);
  await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
  const temp=file+'.setup.tmp';await fs.writeFile(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600});await fs.rename(temp,file);
  console.log(`Connected free Photon project ${project.name||'GardenOS'}. Existing residents preserved. Open /residents on the wall to manage phones.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
