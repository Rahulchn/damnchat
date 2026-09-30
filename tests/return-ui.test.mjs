import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/static/return-ui.js';
const ui = globalThis.returnUI;
test('saved rooms accept only bounded, unique local room records', () => {
  const id = 'a'.repeat(32);
  assert.deepEqual(ui.parseSaved('not json'),[]);
  assert.deepEqual(ui.parseSaved('{}'),[]);
  assert.deepEqual(ui.parseSaved(JSON.stringify([
    {id,label:'  Friends  ',secret:'ignored'}, {id,label:'Duplicate'},
    {id:'javascript:alert(1)',label:'Bad'}, {id:'b'.repeat(32),label:' '},
    {id:'c'.repeat(32),label:'x'.repeat(41)}, null,
  ])),[{id,label:'Friends'}]);
  assert.equal(ui.parseSaved(JSON.stringify(Array.from({length:20},(_,i)=>({id:i.toString(16).padStart(32,'0'),label:'Room'})))).length,12);
});
test('search combines literal name/body queries with the chosen media filter', () => {
  const message = {name:'Alice',body:'Watch https://example.com/video',image_url:null,party:null};
  assert.equal(ui.matches(message,' ALICE ','links'),true);
  assert.equal(ui.matches(message,'watch','photos'),false);
  assert.equal(ui.matches(message,'.*','all'),false);
  assert.equal(ui.matches({...message,body:'',image_url:'/api/uploads/file.webp'},'Alice','photos'),true);
  assert.equal(ui.matches({...message,party:{room_id:'a'.repeat(32)}},'watch','invites'),true);
  assert.equal(ui.matches({name:'नाम',body:'नमस्ते'},'नमस्ते','all'),true);
});
