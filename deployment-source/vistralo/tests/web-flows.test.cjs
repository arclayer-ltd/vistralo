'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {buildSync} = require('esbuild');

function load(entry, globals = {}) {
  const bundled = buildSync({entryPoints:[path.join(__dirname,'../web/features/'+entry+'.ts')],bundle:true,write:false,platform:'browser',format:'cjs'}).outputFiles[0].text;
  const module = {exports:{}};
  vm.runInNewContext(bundled, {module,exports:module.exports,URL,File,Blob,Date,setTimeout,clearTimeout,...globals});
  return module.exports;
}
const {buildClipPlan,validateVideo,publicWebsite,MAX_UPLOAD_BYTES,walkthroughScriptEdit,STOP_TEXT_LIMIT} = load('flow-utils');

test('reviewed trim plan keeps selected source, exact end boundary and chronological adjacent clips',()=>{
  const edits = [{start:'0',end:'2.25'},{start:'2.25',end:'4.125'}];
  const snapshot = JSON.stringify(edits), result = buildClipPlan('imports/source.webm',4.125,edits);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{version:1,source:'imports/source.webm',clips:[{start:0,end:2.25},{start:2.25,end:4.125}]});
  assert.equal(JSON.stringify(edits),snapshot,'Review inputs must not be modified by validation');
});

test('trim planning refuses unknown or non-finite source durations',()=>{
  for(const duration of [null,0,-1,NaN,Infinity,-Infinity]) assert.throws(()=>buildClipPlan('imports/source.webm',duration,[{start:'0',end:'2'}]),/duration/);
  assert.throws(()=>buildClipPlan('',10,[{start:'0',end:'2'}]),/source recording/);
});

test('trim planning rejects missing, non-finite, reversed, overlapping and out-of-bounds cuts',()=>{
  for(const clips of [
    [{start:'',end:'1'}], [{start:'0',end:''}], [{start:'NaN',end:'1'}], [{start:'0',end:'Infinity'}],
    [{start:'-1',end:'2'}], [{start:'2',end:'2'}], [{start:'2',end:'1'}], [{start:'0',end:'10.0001'}],
    [{start:'0',end:'5'},{start:'4.9',end:'8'}], [{start:'6',end:'8'},{start:'0',end:'2'}],
  ]) assert.throws(()=>buildClipPlan('imports/source.webm',10,clips),/Part \d/);
  assert.throws(()=>buildClipPlan('imports/source.webm',10,[]),/1 and 200/);
  assert.throws(()=>buildClipPlan('imports/source.webm',1000,Array.from({length:201},(_,i)=>({start:i,end:i+1}))),/1 and 200/);
});

test('video import enforces extension, nonempty source and the documented upload bound',()=>{
  assert.doesNotThrow(()=>validateVideo({name:'source.WEBM',size:MAX_UPLOAD_BYTES}));
  assert.throws(()=>validateVideo({name:'source.mp4',size:0}),/not empty/);
  assert.throws(()=>validateVideo({name:'source.mp4',size:MAX_UPLOAD_BYTES+1}),/20 GB/);
  assert.throws(()=>validateVideo({name:'source.html',size:10}),/MP4, WebM, MOV or MKV/);
});

test('website creation rejects credentials and obvious private or executable input before creating a project',()=>{
  assert.equal(publicWebsite(' https://example.com/path '),'https://example.com/path');
  assert.equal(publicWebsite('mercury.com'),'https://mercury.com/');
  assert.equal(publicWebsite('www.example.com/pricing'),'https://www.example.com/pricing');
  assert.equal(publicWebsite('example.com:8443'),'https://example.com:8443/');
  assert.equal(publicWebsite('http://example.com'),'http://example.com/');
  for(const url of ['javascript:alert(1)','file:///tmp/a','https://user:pass@example.com','http://localhost:8000','http://127.0.0.1','http://192.168.1.1','http://10.0.0.2','http://172.16.1.2','relative/path','localhost:8000','192.168.1.1','mailto:someone@example.com','']) assert.throws(()=>publicWebsite(url));
});

test('recording recovery closes its database if a synchronous quota failure prevents staging',async()=>{
  let closed = 0;
  const quota = new Error('Quota exceeded');
  const db = {close(){closed++;},transaction(){return {objectStore(){return {put(){throw quota;}};}};}};
  const indexedDB = {open(){const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}};
  const {stageRecording} = load('recording-store',{indexedDB,queueMicrotask});
  await assert.rejects(stageRecording(new File(['recording bytes'],'capture.webm',{type:'video/webm'})),/Quota exceeded/);
  assert.equal(closed,1);
});

test('recording recovery closes its database when opening a transaction itself fails',async()=>{
  let closed = 0;
  const db = {close(){closed++;},transaction(){throw new Error('Database is closing');}};
  const indexedDB = {open(){const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}};
  const {recoverRecording} = load('recording-store',{indexedDB,queueMicrotask});
  await assert.rejects(recoverRecording(),/Database is closing/);
  assert.equal(closed,1);
});

test('the recorder names an audio codec only when there is audio to record',()=>{
  const {recorderMime} = load('create/recording-media');
  const firefox = type => !type.includes('vp9');
  // Firefox's recorder asked for opus with no audio track never produces data and never stops.
  assert.equal(recorderMime(false,false,firefox),'video/webm;codecs=vp8');
  assert.equal(recorderMime(false,false,()=>true),'video/webm;codecs=vp9');
  assert.equal(recorderMime(false,true,firefox),'video/webm;codecs=vp8,opus');
  assert.equal(recorderMime(true,true,()=>true),'video/webm;codecs=vp8,opus');
  assert.equal(recorderMime(false,false,type=>type==='video/mp4'),'video/mp4');
});

test('reviewed script edits keep every screen and its timing, and change only the words', () => {
  const draft = {stops:[{at:0,label:'Hero',text:'Old hero line.',frame:'u/p/j/a.jpg',build:{effect:'x'}},{at:4.5,label:'Cards',text:'Old cards line.'}]};
  const edited = walkthroughScriptEdit(draft, [{text:'  New   hero\n line. '},{text:''}], ' Closing words. ');
  assert.equal(edited.stops.length, 2);
  assert.equal(edited.stops[0].text, 'New hero line.');
  assert.equal(edited.stops[0].at, 0);
  assert.equal(edited.stops[0].frame, 'u/p/j/a.jpg');
  assert.deepEqual(edited.stops[0].build, {effect:'x'});
  assert.equal(edited.stops[1].text, '', 'an emptied screen stays, silent');
  assert.equal(edited.closing, 'Closing words.');
  assert.equal(draft.stops[0].text, 'Old hero line.', 'the saved draft is not mutated');
});

test('reviewed script edits refuse a changed screen count and over-long parts', () => {
  const draft = {stops:[{at:0,text:'a'},{at:1,text:'b'}]};
  assert.throws(() => walkthroughScriptEdit(draft, [{text:'only one'}], ''), /changed while you were editing/);
  assert.throws(() => walkthroughScriptEdit(draft, 'not a list', ''), /changed while you were editing/);
  assert.throws(() => walkthroughScriptEdit(draft, [{text:'x'.repeat(STOP_TEXT_LIMIT + 1)},{text:''}], ''), /Screen 1 is longer/);
  assert.throws(() => walkthroughScriptEdit(draft, [{text:''},{text:''}], 'y'.repeat(STOP_TEXT_LIMIT + 1)), /closing is longer/);
  assert.doesNotThrow(() => walkthroughScriptEdit(draft, [{text:'x'.repeat(STOP_TEXT_LIMIT)},{text:null}], ''));
});

// A tiny IndexedDB: one object store, each request completing its transaction on the next microtask.
function memoryIndexedDB() {
  const data = new Map();
  const db = {close(){}, transaction(){
    const tx = {objectStore(){
      const request = run => { const r = {result:run()}; queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return r; };
      return {get:key => request(() => data.get(key)), put:value => request(() => { data.set(value.key, value); }), delete:key => request(() => { data.delete(key); })};
    }};
    return tx;
  }};
  return {data, indexedDB:{open(){ const request = {result:db}; queueMicrotask(() => request.onsuccess()); return request; }}};
}

test('a recording kept in this browser remembers the project it is being saved into, and only its own copy is linked',async()=>{
  const {data, indexedDB} = memoryIndexedDB();
  const {stageRecording, linkRecording, recoverRecording, clearRecordingIf} = load('recording-store',{indexedDB,queueMicrotask});
  const take = new File(['eight hours of screen'],'take.webm',{type:'video/webm'});
  await stageRecording(take);
  // A different file (not the kept copy) never claims the waiting recording.
  await linkRecording('p-other', new File(['x'],'other.webm'));
  assert.equal((await recoverRecording()).project, undefined);
  await linkRecording('p1', take);
  const waiting = await recoverRecording();
  assert.equal(waiting.project, 'p1');
  assert.equal(waiting.file.size, take.size);
  // Clearing names the recording it saved, so a newer take kept meanwhile survives.
  await clearRecordingIf('2000-01-01T00:00:00.000Z');
  assert.ok(data.has('pending'));
  await clearRecordingIf(waiting.created);
  assert.equal(data.has('pending'), false);
});

test('a waiting recording is matched to its project: surely when linked, as a guess when an older version kept it',()=>{
  const {recordingFor} = load('recording-store',{indexedDB:{},queueMicrotask});
  const project = {id:'p1', source:'screen', created:'2026-11-18T05:48:59.908Z'};
  assert.equal(recordingFor({created:'2026-11-18T05:48:10.000Z', project:'p1'}, project), 'linked');
  assert.equal(recordingFor({created:'2026-11-18T05:48:10.000Z', project:'p2'}, project), null);
  // Kept by an older version with no project named: offered to a screen recording made after it, within a day.
  assert.equal(recordingFor({created:'2026-11-18T05:48:10.000Z'}, project), 'likely');
  assert.equal(recordingFor({created:'2026-11-16T05:48:10.000Z'}, project), null);
  assert.equal(recordingFor({created:'2026-11-18T07:00:00.000Z'}, project), null);
  // Once the project has its video, or for an upload or a website, nothing is offered.
  for (const other of [{...project, video:'u/p1/v.webm'}, {...project, source:'upload'}, {...project, trashed:true}])
    assert.equal(recordingFor({created:'2026-11-18T05:48:10.000Z', project:'p1'}, other), null);
  assert.equal(recordingFor(null, project), null);
});

test('one upload per project at a time across tabs, and an offline upload waits for the network',async()=>{
  const held = new Set();
  const locks = {
    async request(name, options, run){ if (held.has(name)) return run(null); held.add(name); try { return await run({name}); } finally { held.delete(name); } },
    async query(){ return {held:[...held].map(name => ({name}))}; },
  };
  const listeners = {};
  const window = {addEventListener:(type, fn) => { listeners[type] = fn; }, removeEventListener:type => { delete listeners[type]; }};
  const navigator = {locks, onLine:true};
  const {withUploadLock, uploadRunning, backOnline} = load('../upload-lock',{navigator,window,DOMException});
  let inside;
  const first = withUploadLock('p1', async () => { inside = await uploadRunning('p1'); return 'saved'; });
  await assert.rejects(withUploadLock('p1', async () => 'second'), /already uploading in another tab/);
  assert.equal(await first, 'saved');
  assert.equal(inside, true);
  assert.equal(await uploadRunning('p1'), false);
  navigator.onLine = false;
  let resolved = false;
  const waiting = backOnline().then(() => { resolved = true; });
  await new Promise(done => setTimeout(done, 5));
  assert.equal(resolved, false);
  listeners.online();
  await waiting;
  assert.equal(resolved, true);
  const controller = new AbortController();
  const paused = backOnline(controller.signal);
  controller.abort();
  await assert.rejects(paused, /Upload paused/);
});
