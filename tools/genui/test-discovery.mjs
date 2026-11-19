import assert from 'node:assert/strict';
import {directAction,directLayout} from '../../src/voice-fast.mjs';
for(const phrase of ['show benchmarks','open the benchmarks','show me the benchmark page','show the performance lab','show me the performance benchmarks','show the genui performance demo','open the a2ui performance demo'])assert.equal(directAction(phrase)?.input?.name,'benchmarks',phrase);
for(const phrase of ['show benchmarks actually cancel','show the performance lab instead weather','show performance improvements','make performance lab red'])assert.equal(directAction(phrase),null,phrase);
for(const flow of ['home','briefing','commute','controls','focus','packing','catalog']){const action=directAction('show me the genui '+flow+' demo');assert.equal(action?.input?.name,'genui',flow);assert.equal(action?.input?.arg,flow);}
for(const phrase of ['show genui controls actually cancel','show genui packing instead focus','show genui nonexistent'])assert.equal(directAction(phrase),null,phrase);
assert.equal(directLayout('make the performance lab wide')?.widget,'benchmarks');
console.log('PASS benchmark voice discovery, correction fallthrough and resize alias');
