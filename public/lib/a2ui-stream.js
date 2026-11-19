// Incremental framing only. The A2UI host validates protocol and component/action
// schemas before rendering. A malformed/over-budget decoder is terminal.
const white=c=>c===' '||c==='\t'||c==='\n'||c==='\r';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function addCodeUnit(counter,c){
 const n=c.charCodeAt(0),low=n>=0xdc00&&n<=0xdfff,high=n>=0xd800&&n<=0xdbff;
 counter.bytes+=counter.high&&low?1:n<0x80?1:n<0x800?2:3;counter.high=high;
}
export class A2uiJsonlDecoder {
 constructor(onMessage,{maxLine=131072,maxBytes=1048576,maxMessages=200}={}){
  this.onMessage=onMessage;this.maxLine=maxLine;this.maxBytes=maxBytes;this.maxMessages=maxMessages;this.bytes=0;this.totalSize={bytes:0,high:false};this.pending='';this.lineSize={bytes:0,high:false};this.decoder=new TextDecoder('utf-8',{fatal:true});this.closed=false;this.count=0;
 }
 push(chunk){
  if(this.closed)throw Error('Stream already ended.');
  try{
   let text;if(typeof chunk==='string'){text=this.decoder.decode()+chunk;for(let i=0;i<chunk.length;i++)addCodeUnit(this.totalSize,chunk[i]);this.bytes=this.totalSize.bytes;}else{if(!(chunk instanceof Uint8Array))throw Error('Expected text or UTF-8 bytes.');this.totalSize.bytes+=chunk.byteLength;this.totalSize.high=false;this.bytes=this.totalSize.bytes;text=this.decoder.decode(chunk,{stream:true});}
   if(this.bytes>this.maxBytes)throw Error('UI stream is too large.');this.consume(text);
  }catch(e){this.closed=true;throw e;}
 }
 consume(text){for(const c of text){if(c==='\n'){this.line(this.pending.trim());this.pending='';this.lineSize={bytes:0,high:false};continue;}this.pending+=c;for(let i=0;i<c.length;i++)addCodeUnit(this.lineSize,c[i]);if(this.lineSize.bytes>this.maxLine)throw Error('UI message is too large.');}}
 line(line){if(!line)return;const value=JSON.parse(line);if(!object(value))throw Error('Expected an A2UI message object.');if(++this.count>this.maxMessages)throw Error('Too many UI messages.');this.onMessage(value);}
 finish(){if(this.closed)return;try{this.consume(this.decoder.decode());if(this.pending.trim())this.line(this.pending.trim());this.pending='';}finally{this.closed=true;}}
}
// Tool input is one JSON object, not JSONL. This scanner tracks root properties,
// strings, escapes and nested values; a quoted/nested `messages` cannot activate
// dispatch. It consumes each character once and emits complete array elements.
export class A2uiToolDecoder {
 constructor(onMessage,{maxBytes=1048576,maxMessage=131072,maxMessages=200,maxDepth=24}={}){
  this.onMessage=onMessage;this.maxBytes=maxBytes;this.maxMessage=maxMessage;this.maxMessages=maxMessages;this.maxDepth=maxDepth;
  this.buffer='';this.cursor=0;this.phase='root';this.size={bytes:0,high:false};this.count=0;this.closed=false;this.keys=new Set();this.key='';
 }
 push(text){
  if(this.closed)throw Error('Stream already ended.');
  try{if(typeof text!=='string')throw Error('Expected tool JSON text.');for(let i=0;i<text.length;i++)addCodeUnit(this.size,text[i]);if(this.size.bytes>this.maxBytes)throw Error('UI tool is too large.');this.buffer+=text;this.scan();}catch(e){this.closed=true;throw e;}
 }
 startValue(kind){this.valueKind=kind;this.valueStart=this.cursor;this.depth=0;this.inString=false;this.escape=false;this.tokenStarted=false;this.valueSize={bytes:0,high:false};this.phase='value';}
 endValue(end){
  const value=JSON.parse(this.buffer.slice(this.valueStart,end));
  if(this.valueKind==='message'){if(!object(value))throw Error('Expected an A2UI message object.');if(++this.count>this.maxMessages)throw Error('Too many UI messages.');this.onMessage(value);this.phase='array-comma';}
  else this.phase='comma';
 }
 scan(){
  while(this.cursor<this.buffer.length){
   const c=this.buffer[this.cursor];
   if(this.phase==='key'){if(!this.scanKey())return;continue;}
   if(this.phase==='value'){
    if(!this.inString&&this.depth===0&&this.tokenStarted&&(white(c)||c===','||c==='}')){this.endValue(this.cursor);continue;}
    addCodeUnit(this.valueSize,c);if(this.valueKind==='message'&&this.valueSize.bytes>this.maxMessage)throw Error('UI message is too large.');this.tokenStarted=true;
    if(this.inString){if(this.escape)this.escape=false;else if(c==='\\')this.escape=true;else if(c==='"')this.inString=false;}
    else if(c==='"')this.inString=true;
    else if(c==='{'||c==='['){if(++this.depth>this.maxDepth)throw Error('UI nesting is too deep.');}
    else if(c==='}'||c===']'){if(--this.depth<0)throw Error('Invalid JSON value.');}
    this.cursor++;
    if(!this.inString&&this.depth===0&&(c==='}'||c===']'||c==='"'))this.endValue(this.cursor);
    continue;
   }
   if(white(c)){this.cursor++;continue;}
   switch(this.phase){
   case 'root':if(c!=='{')throw Error('Expected tool JSON object.');this.phase='key-first';break;
   case 'key-first':case 'key-next':
    if(c==='}'&&this.phase==='key-first'){this.phase='done';break;}
    if(c!=='"')throw Error('Expected a top-level property.');this.keyStart=this.cursor;this.escape=false;this.phase='key';break;
   case 'colon':if(c!==':')throw Error('Expected a property separator.');this.phase=this.key==='messages'?'array-start':'value-start';break;
   case 'value-start':this.startValue('other');continue;
   case 'array-start':if(c!=='[')throw Error('Expected messages array.');this.phase='array-first';break;
   case 'array-first':case 'array-next':
    if(c===']'&&this.phase==='array-first'){this.phase='comma';break;}
    if(c!=='{')throw Error('Expected an A2UI message object.');this.startValue('message');continue;
   case 'array-comma':if(c===',')this.phase='array-next';else if(c===']')this.phase='comma';else throw Error('Expected a message separator.');break;
   case 'comma':if(c===',')this.phase='key-next';else if(c==='}')this.phase='done';else throw Error('Expected a property separator.');break;
   case 'done':throw Error('Unexpected content after tool JSON.');
   }
   this.cursor++;

  }
 }
 scanKey(){
  while(this.cursor<this.buffer.length){const k=this.buffer[this.cursor++];if(this.escape){this.escape=false;continue;}if(k==='\\'){this.escape=true;continue;}if(k==='"'){this.key=JSON.parse(this.buffer.slice(this.keyStart,this.cursor));if(this.keys.has(this.key))throw Error('Duplicate top-level property.');this.keys.add(this.key);this.phase='colon';return true;}}
  return false;
 }
 finish(){
  if(this.closed)return;try{this.scan();const input=JSON.parse(this.buffer);if(this.phase!=='done'||!object(input)||!Array.isArray(input.messages)||input.messages.length!==this.count)throw Error('Incomplete A2UI tool input.');}finally{this.closed=true;}
 }
}
