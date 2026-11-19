import assert from 'node:assert/strict';
import {directAction} from '../../../src/voice-fast.mjs';
const cases=[
 ['give me a daily brief with things like the weather and quick summary of news for today and the bus stops and whatever','briefing'],
 ['show me a morning briefing','briefing'],['give me a briefing with just weather and buses','briefing'],['give me a commute briefing','briefing'],
 ['make this a new widget','pin'],['save that as a widget','pin'],['turn this into a widget','pin'],['show the genui demo','genui'],
 ['directions to ferry building','transit'],['show me the buses to ferry building','transit'],['how do i get to golden gate park','transit'],
];
for(const [text,command]of cases)assert.equal(directAction(text)?.input?.name,command,text);
for(const text of ['give me a daily brief with weather actually cancel','make this widget red','directions to ferry building instead golden gate park'])assert.equal(directAction(text),null,text);
assert.equal(directAction('stop the timer')?.input?.name,'timer');
console.log('PASS: 15 briefing, save, demo, visual directions and correction-boundary cases');
