import {spawnSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
for(const folder of ['src','public','scripts'])for(const file of readdirSync(folder).filter(f=>f.endsWith('.mjs'))){const run=spawnSync(process.execPath,['--check',folder+'/'+file],{stdio:'inherit'});if(run.status)process.exit(run.status);}
const html=readFileSync('public/index.html','utf8');
for(const asset of ['/style.css','/app.mjs','/favicon.svg'])if(!html.includes(asset))throw new Error('Missing asset '+asset);
console.log('Syntax and primary assets checked.');
