import test from 'node:test';import assert from 'node:assert/strict';
import {A2uiJsonlDecoder,A2uiToolDecoder}from'../../public/lib/a2ui-stream.js';
const messages=[{version:'v0.9',createSurface:{surfaceId:'test',catalogId:'https://garden.local/catalogs/house-v1.json'}},{version:'v0.9',updateComponents:{surfaceId:'test',components:[{id:'root',component:'Text',text:'Escapes: " \\ \n 🙂 café'}]}}];
function chunks(text,width){const out=[];for(let i=0;i<text.length;i+=width)out.push(text.slice(i,i+width));return out;}
test('tool messages stream through every string chunk width, including escaped strings and surrogate splits',()=>{
 const text=JSON.stringify({title:'A title with "messages": [{"wrong":true}]',other:{messages:[{wrong:true}]},messages,status:'Done'});
 for(let width=1;width<=text.length;width++){const out=[],d=new A2uiToolDecoder(m=>out.push(m));for(const part of chunks(text,width))d.push(part);d.finish();assert.deepEqual(out,messages,'width '+width);}
});
test('quoted and nested messages properties never dispatch, including braces and escaped quotes',()=>{
 for(const input of [{title:'"messages":[{"wrong":1}]',messages:[]},{before:{messages:[{wrong:true}]},messages:[]},{messages:[],after:{messages:[{wrong:true}]}}]){const out=[],d=new A2uiToolDecoder(m=>out.push(m));for(const c of JSON.stringify(input))d.push(c);d.finish();assert.deepEqual(out,[]);}
});
test('only complete root messages objects dispatch before the parent tool is complete',()=>{
 const out=[],d=new A2uiToolDecoder(m=>out.push(m));d.push('{"title":"Working", "messages":['+JSON.stringify(messages[0]));assert.deepEqual(out,[messages[0]]);d.push(',{"partial":');assert.equal(out.length,1);assert.throws(()=>d.finish());assert.throws(()=>d.push('3}]}'),/ended/);
});
test('an escaped root key is parsed semantically rather than matched inside text',()=>{
 const out=[],d=new A2uiToolDecoder(m=>out.push(m));for(const c of '{"mess\\u0061ges":[{"ok":true}]}')d.push(c);d.finish();assert.deepEqual(out,[{ok:true}]);
});
test('invalid array grammar, root grammar, primitive messages and duplicate keys are rejected',()=>{
 for(const input of ['[]','{"messages":{}}','{"messages":[1]}','{"messages":[{},]}','{"messages":[{} {}]}','{"messages":[],"messages":[]}','{"title":invalid,"messages":[]}','{"messages":[]}{}','{"messages":[],}']){const d=new A2uiToolDecoder(()=>{});assert.throws(()=>{for(const c of input)d.push(c);d.finish();},input);assert.throws(()=>d.push(' '),/ended/);}
});
test('tool budgets count UTF-8 bytes across arbitrary surrogate chunks and bound each object/count/depth',()=>{
 const text=JSON.stringify({messages:[{text:'🙂é'}]}),bytes=new TextEncoder().encode(text).length;
 const out=[],d=new A2uiToolDecoder(m=>out.push(m),{maxBytes:bytes});for(let i=0;i<text.length;i++)d.push(text[i]);d.finish();assert.equal(out.length,1);
 assert.throws(()=>new A2uiToolDecoder(()=>{},{maxBytes:bytes-1}).push(text),/too large/);
 assert.throws(()=>new A2uiToolDecoder(()=>{},{maxMessage:10}).push('{"messages":[{"text":"éééééé"}]}'),/too large/);
 assert.throws(()=>new A2uiToolDecoder(()=>{},{maxMessages:1}).push('{"messages":[{},{}]}'),/Too many/);
 assert.throws(()=>new A2uiToolDecoder(()=>{},{maxDepth:2}).push('{"messages":[{"x":{"y":[]}}]}'),/deep/);
});
test('JSONL handles every UTF-8 byte chunk width and final lines without newline',()=>{
 const text=messages.map(m=>JSON.stringify(m)).join('\r\n'),bytes=new TextEncoder().encode(text);
 for(let width=1;width<=bytes.length;width++){const out=[],d=new A2uiJsonlDecoder(m=>out.push(m));for(let i=0;i<bytes.length;i+=width)d.push(bytes.slice(i,i+width));d.finish();assert.deepEqual(out,messages,'width '+width);}
});
test('JSONL waits for a complete line and rejects malformed UTF-8, JSON and non-object messages',()=>{
 const out=[],d=new A2uiJsonlDecoder(m=>out.push(m));d.push('{"ok":');assert.equal(out.length,0);d.push('true}\n');assert.deepEqual(out,[{ok:true}]);d.finish();assert.throws(()=>d.push('\n'),/ended/);
 for(const input of ['1\n','[]\n','null\n','{invalid}\n'])assert.throws(()=>new A2uiJsonlDecoder(()=>{}).push(input));
 assert.throws(()=>new A2uiJsonlDecoder(()=>{}).push(new Uint8Array([0xff])),/encoded|encoding|valid/i);
 const partial=new A2uiJsonlDecoder(()=>{});partial.push(new Uint8Array([0xf0,0x9f]));assert.throws(()=>partial.finish());
});
test('JSONL budgets limit stream bytes, message bytes and message count',()=>{
 assert.throws(()=>new A2uiJsonlDecoder(()=>{},{maxBytes:8}).push('{"x":"é"}'),/too large/);
 assert.throws(()=>new A2uiJsonlDecoder(()=>{},{maxLine:8}).push('{"x":"é"}\n'),/too large/);
 assert.throws(()=>new A2uiJsonlDecoder(()=>{},{maxMessages:1}).push('{}\n{}\n'),/Too many/);
 const text='{"x":"🙂"}',out=[],d=new A2uiJsonlDecoder(m=>out.push(m),{maxBytes:new TextEncoder().encode(text).length});for(let i=0;i<text.length;i++)d.push(text[i]);d.finish();assert.equal(out.length,1);
});
test('callback errors terminate both decoders without repeating an action',()=>{
 for(const [Decoder,text]of [[A2uiToolDecoder,'{"messages":[{}]}'],[A2uiJsonlDecoder,'{}\n']]){let n=0;const d=new Decoder(()=>{n++;throw Error('Consumer failed');});assert.throws(()=>d.push(text),/Consumer failed/);assert.throws(()=>d.push(text),/ended/);assert.equal(n,1);}
});
