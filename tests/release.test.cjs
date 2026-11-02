const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('release artifact contains only public runtime assets',()=>{
  assert.deepEqual(fs.readdirSync('dist').sort(),['.nojekyll','app.js','apple-touch-icon.png','cardio.js','icon-192.png','icon-512.png','index.html','manifest.webmanifest','release.json','styles.css','sw.js']);
  const html=fs.readFileSync('dist/index.html','utf8');assert.doesNotMatch(html,/sync.js|googleapis|accounts.google|api.openai/);
  const release=JSON.parse(fs.readFileSync('dist/release.json'));assert.equal(release.version,JSON.parse(fs.readFileSync('package.json')).version);assert.equal(release.storageSchema,1);
});
test('release preserves the installed app identity and primary storage key',()=>{
  const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest'));assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./index.html');assert.equal(manifest.scope,'./');
  assert.match(fs.readFileSync('app.js','utf8'),/const STORAGE_KEY = 'liftlog.personal.v1'/);
});
