import { spawn } from 'node:child_process';
const parser = new URL('../tools/feeds/parse-article.py', import.meta.url);
export function extractArticle(html, url) {
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[parser.pathname,url],{stdio:['pipe','pipe','ignore']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Article extraction timed out'));},5000);
    child.stdout.on('data',d=>{output+=d;if(output.length>6e6)child.kill();});
    child.stdin.on('error',()=>{});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('Article extraction failed');resolve(JSON.parse(output));}catch(e){reject(e);}});
    child.stdin.end(String(html).slice(0,3*1024*1024));
  });
}
