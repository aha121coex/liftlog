const fs = require('node:fs');
const vm = require('node:vm');
const KEY = 'liftlog.personal.v1';
function boot(raw, failWrite = () => false, writerGranted = true) {
  const data = new Map(raw === undefined ? [] : [[KEY, raw]]);
  const elements = Object.fromEntries(['view', 'sheet-root', 'toast', 'backup-file'].map(id => [id, {
    innerHTML: '', textContent: '', classList: {add(){}, remove(){}, toggle(){}}, click(){}
  }]));
  const events = {};
  const downloads = [];
  const context = vm.createContext({
    console: {error(){}, warn(){}, info(){}},
    document: {getElementById: id => elements[id] || null, querySelectorAll: () => [],
      addEventListener: (type, fn) => {events[type] = fn;}, hidden: false},
    window: {addEventListener(){}, scrollTo(){}}, navigator: {onLine: false, locks:{request(name,options,callback){callback(writerGranted?{name}:null);return Promise.resolve();}}}, location: {protocol: 'file:'},
    localStorage: {getItem: key => data.get(key) ?? null,
      setItem(key, value) {if (failWrite(key, value)) throw Error('QuotaExceededError'); data.set(key, value);},
      removeItem: key => data.delete(key)},
    File,
    setTimeout(){}, clearTimeout(){}, setInterval(){}, confirm: () => true,
    FileReader: class { readAsText(file) {this.result = file.text; this.onload();} }
  });
  for (const path of ['cardio.js','app.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context, {filename: path});
  context.capture = (...args) => downloads.push(args);
  vm.runInContext('downloadBlob = capture;', context);
  return {context, data, elements, events, downloads, run: code => vm.runInContext(code, context),
    async ready() {await vm.runInContext('recoverSecondaryIfNeeded()', context);},
    restore: value => {context.backupFile = {text: JSON.stringify(value)};vm.runInContext('importBackup(backupFile)', context);}
  };
}
module.exports = {boot, KEY};
