'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {buildSync} = require('esbuild');

function load(entry) {
  const bundled = buildSync({entryPoints:[path.join(__dirname,'../web/features/'+entry+'.ts')],bundle:true,write:false,platform:'browser',format:'cjs'}).outputFiles[0].text;
  const module = {exports:{}};
  vm.runInNewContext(bundled, {module,exports:module.exports});
  return module.exports;
}
const {folderList, folderName, folderRoute, folderFromRoute, inFolder, FOLDER_NAME_LIMIT} = load('folders');
const {remapPaths, filesToCopy, projectPrefix} = load('duplicate');

test('folders list the names in use outside Trash, sorted, with counts', () => {
  const projects = [
    {id:'1', folder:'Client B'}, {id:'2', folder:'client a'}, {id:'3', folder:'Client B'},
    {id:'4', folder:''}, {id:'5'}, {id:'6', folder:'Old', trashed:true}, {id:'7', folder:'Folder 10'}, {id:'8', folder:'Folder 9'},
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(folderList(projects))), [
    {name:'client a', count:1}, {name:'Client B', count:2}, {name:'Folder 9', count:1}, {name:'Folder 10', count:1},
  ]);
  assert.deepEqual(inFolder(projects, 'Client B').map((p) => p.id), ['1', '3']);
  assert.deepEqual(inFolder(projects, 'Old'), [], 'trashed projects are not in a folder view');
});

test('folder names are tidied, limited, and survive the route even with a slash', () => {
  assert.equal(folderName('  Client   work '), 'Client work');
  assert.equal(folderName(''), '');
  assert.equal(folderName(undefined), '');
  assert.throws(() => folderName('x'.repeat(FOLDER_NAME_LIMIT + 1)), /up to 60 characters/);
  const route = folderRoute('Q4 / launch & more');
  assert.equal(route.split('/').length, 2, 'the name is one route segment');
  assert.equal(folderFromRoute(route.split('/')), 'Q4 / launch & more');
  assert.equal(folderFromRoute(['projects']), '');
  assert.equal(folderFromRoute(['folder', '%E0%A4%A']), '', 'a broken route is no folder, not a crash');
});

test('a duplicated project points every stored path at its own folder', () => {
  const from = projectPrefix('owner', 'old'), to = projectPrefix('owner', 'new');
  const doc = {
    id:'old', name:'Demo', thumbnail:'owner/old/poster.webp', video:'owner/old/job1/narrated.mp4', url:'https://example.com/old/page',
    data:{
      files:{'owner/old/src.webm':{size:1}, 'owner/old/job1/narrated.mp4':{size:2}},
      output:{file:'owner/old/job1/narrated.mp4', duration:12},
      captions:'owner/old/job1/narrated.srt',
      buildBrief:{markdown:'owner/old/job1/build-brief.md', status:'ok'},
      walkthroughDraft:{stops:[{at:0, frame:'owner/old/job2/evidence/viewports/1.jpg', text:'Mentions owner/old/ in words.'}]},
      sourceSha256:'abc', other:'owner/older/file.mp4',
    },
  };
  const copy = remapPaths(doc, from, to);
  assert.equal(copy.thumbnail, 'owner/new/poster.webp');
  assert.equal(copy.video, 'owner/new/job1/narrated.mp4');
  assert.deepEqual(Object.keys(copy.data.files), ['owner/new/src.webm', 'owner/new/job1/narrated.mp4']);
  assert.equal(copy.data.output.file, 'owner/new/job1/narrated.mp4');
  assert.equal(copy.data.output.duration, 12);
  assert.equal(copy.data.captions, 'owner/new/job1/narrated.srt');
  assert.equal(copy.data.buildBrief.markdown, 'owner/new/job1/build-brief.md');
  assert.equal(copy.data.walkthroughDraft.stops[0].frame, 'owner/new/job2/evidence/viewports/1.jpg');
  assert.equal(copy.data.walkthroughDraft.stops[0].text, 'Mentions owner/old/ in words.', 'only strings that start with the folder change');
  assert.equal(copy.data.other, 'owner/older/file.mp4', 'a similar prefix is not the folder');
  assert.equal(copy.url, 'https://example.com/old/page');
  assert.equal(doc.data.output.file, 'owner/old/job1/narrated.mp4', 'the original is not changed');
});

test('only files inside the project folder are copied, each once', () => {
  const from = projectPrefix('owner', 'p1');
  assert.deepEqual(
    [...filesToCopy({'owner/p1/a.mp4':{}, 'owner/p2/b.mp4':{}, 'owner/p1/../p2/c.mp4':{}, 'owner/p1/poster.webp':{}}, 'owner/p1/poster.webp', from)],
    ['owner/p1/a.mp4', 'owner/p1/poster.webp'],
  );
  assert.deepEqual([...filesToCopy(undefined, undefined, from)], []);
});
