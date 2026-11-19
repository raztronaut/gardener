import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const parser=fileURLToPath(new URL('../feeds/parse-feed.py',import.meta.url));
const parse=(input,args=[])=>spawnSync('python3',['-I',parser,...args],{input,encoding:'utf8'});
test('JSON Feed extracts readable text and rejects executable/credential links',()=>{
 const result=parse(JSON.stringify({version:'https://jsonfeed.org/version/1.1',items:[{title:'A real story',url:'https://example.org/article',content_html:'<p>Readable <strong>words</strong></p><script>unsafe()</script>',date_published:'2026-11-05T00:00:00Z'},{title:'Unsafe',url:'javascript:alert(1)',content_text:'hidden'},{title:'Credentials',url:'https://name:secret@example.org/private'}]}));
 assert.equal(result.status,0);const items=JSON.parse(result.stdout);assert.equal(items.length,1);assert.equal(items[0].content,'Readable words');assert.equal(items[0].date,'2026-11-05T00:00:00Z');
 assert.notEqual(parse('{"items":[]}').status,0);
});
test('RSS entity declarations remain forbidden',()=>{
 assert.notEqual(parse('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title></item></channel></rss>').status,0);
});

test('Almanac website fallback extracts real article headings, labels coverage and leaves unknown dates blank',()=>{
 const r=parse('<nav><h3>Navigation</h3><a href="/store">Buy now</a></nav><h3 class="field-content"><a href="/a-real-guide">A real garden guide</a></h3><h3 class="field-content"><a href="https://elsewhere.example/ad">An unrelated ad</a></h3>',['almanac']);
 assert.equal(r.status,0);const items=JSON.parse(r.stdout);assert.equal(items.length,1);assert.equal(items[0].url,'https://www.almanac.com/a-real-guide');assert.equal(items[0].coverage,'website excerpt');assert.equal(items[0].date,'');
 const empty=parse('<rss><channel><title>Feed</title></channel></rss>');assert.deepEqual(JSON.parse(empty.stdout),[]);
});
