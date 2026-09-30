import test from 'node:test';
import assert from 'node:assert/strict';
import {changeWatch, videoSource, validRoom} from './hangout.js';
test('watch host controls, validation and takeover', () => {
  const host = {session_id:'a', name:'Host'}, guest = {session_id:'b', name:'Guest'};
  let watch = changeWatch(null, {action:'start', video:{kind:'youtube', id:'M7lc1UVf-VE'}}, host, false, 1000);
  assert.throws(() => changeWatch(watch, {action:'sync',position:30,playing:true}, guest,true));
  watch = changeWatch(watch, {action:'sync',position:30,playing:true},host,true,2000);
  assert.throws(() => changeWatch(watch, {action:'sync',position:NaN,playing:true},host,true));
  watch = changeWatch(watch, {action:'claim'},guest,false,5000);
  assert.equal(watch.position,33);
  assert.equal(watch.host_id,'b');
  assert.equal(changeWatch(watch,{action:'stop'},guest,true),null);
  assert.equal(videoSource({kind:'direct',url:'javascript:alert(1)'}),null);
  assert.equal(videoSource({kind:'youtube',id:12345678901}),null);
  assert.equal(videoSource({kind:'direct',url:'https://example.com/song.ogg'}),null);
  assert.equal(videoSource({kind:'direct',url:'https://example.com/song.mp3'}),null);
  assert.equal(validRoom('../main'),false);
});
