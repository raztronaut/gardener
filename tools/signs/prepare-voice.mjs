// One-time local synthesis. Runtime only plays these small cached clips.
import {createRequire} from 'node:module';
import {mkdir,writeFile,access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SIGN_PROMPTS} from '../../src/sign-speech.mjs';
const sherpa=createRequire(import.meta.url)('sherpa-onnx-node');
const base=join(process.cwd(),'data/voice/tts-models/kokoro-int8-multi-lang-v1_0');
const out=join(process.cwd(),'data/signs/speech');await mkdir(out,{recursive:true});
const tts=new sherpa.OfflineTts({model:{kokoro:{model:join(base,'model.int8.onnx'),voices:join(base,'voices.bin'),tokens:join(base,'tokens.txt'),lexicon:join(base,'lexicon-us-en.txt')},numThreads:2,provider:'cpu',debug:0},maxNumSentences:1,silenceScale:.8});
let old;try{old=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));}catch{}
for(const [name,text]of Object.entries(SIGN_PROMPTS)){try{await access(join(out,name+'.wav'));if(old?.prompts?.[name]===text)continue;}catch{}const start=Date.now();const audio=tts.generate({text,sid:3,speed:1});sherpa.writeWave(join(out,name+'.wav'),audio);console.log(JSON.stringify({name,ms:Date.now()-start,seconds:audio.samples.length/audio.sampleRate}));}
await writeFile(join(out,'manifest.json'),JSON.stringify({engine:'Kokoro v1.0 int8',voice:'af_heart',speakerId:3,prompts:SIGN_PROMPTS},null,2));
