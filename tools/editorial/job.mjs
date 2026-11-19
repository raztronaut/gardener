#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { prepareEditorial, publishEditorial, fetchEditorialArticle } from '../../src/editorial.mjs';
const [command,kind,file]=process.argv.slice(2);
try {
 let result;
 if(command==='prepare') {
  const d=await prepareEditorial(kind,{force:process.argv.includes('--force')});
  result={inputFile:d.inputFile,day:d.day,days:d.days,articles:d.articles?.map(({title,url,source})=>({title,url,source})),feeds:d.feeds,alreadyPublished:d.alreadyPublished};
 }else if(command==='publish')result=await publishEditorial(kind,JSON.parse(await readFile(file,'utf8')));
 else if(command==='article')result=await fetchEditorialArticle(kind,file);
 else throw Error('Usage: job.mjs prepare changelog|reading; publish changelog|reading result.json; article input.json url');
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
