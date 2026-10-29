import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const path=new URL('../deployment/remote-origin.json',import.meta.url);
if(existsSync(path)){
  const configuration=JSON.parse(readFileSync(path,'utf8'));
  if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(configuration.upstream)||configuration.publicOrigin!=='https://c0ns1d2.pages.dev')throw new Error('Invalid remote entry configuration');
  const source=readFileSync(new URL('../deployment/pages-worker.mjs',import.meta.url),'utf8');
  writeFileSync(new URL('../dist/_worker.js',import.meta.url),source.replace('"__ARCHIVE_REMOTE_CONFIGURATION__"',JSON.stringify(configuration)));
  console.log('Public website now routes all requests through the permission-aware archive.');
}
