import {existsSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPublicEntry} from './public-entry.mjs';
const path=new URL('../deployment/remote-origin.json',import.meta.url);
if(existsSync(path)){
  const configuration=JSON.parse(readFileSync(path,'utf8'));
  if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(configuration.upstream)||configuration.publicOrigin!=='https://c0ns1d2.pages.dev')throw new Error('Invalid remote entry configuration');
  const source=readFileSync(new URL('../deployment/pages-worker.mjs',import.meta.url),'utf8');
  const dist=new URL('../dist/',import.meta.url);
  writeFileSync(new URL('archive-entry.html',dist),createPublicEntry(fileURLToPath(new URL('../',import.meta.url))));
  copyFileSync(new URL('../admin/collaboration.html',import.meta.url),new URL('archive-shared.html',dist));
  const publicScripts={'app.js':'collaboration.js','app.css':'collaboration.css','bridge-client.js':'collaboration-frontend.js','bridge.css':'collaboration-frontend.css'};
  for(const [name,file]of Object.entries(publicScripts))copyFileSync(new URL('../admin/'+file,import.meta.url),new URL(name,dist));
  configuration.staticAssets=[...readdirSync(new URL('_astro/',dist)).filter(name=>/^[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|svg|png)$/.test(name)).map(name=>'/_astro/'+name),...Object.keys(publicScripts).map(name=>'/'+name),'/intro/intro.mp4','/intro/k1.png'];
  writeFileSync(new URL('../dist/_worker.js',import.meta.url),source.replace('"__ARCHIVE_REMOTE_CONFIGURATION__"',JSON.stringify(configuration)));
  console.log('Public entry prepared: fixed assets served by Pages; archive pages and private media retain backend permission checks.');
}
