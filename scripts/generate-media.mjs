import {fileURLToPath} from 'node:url';
import {generateStarterMedia} from '../src/fal.mjs';
const directory=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2]||'submit';
if(!['submit','status'].includes(mode))throw new Error('Usage: node scripts/generate-media.mjs [submit|status]');
const jobs=await generateStarterMedia(directory,{submit:mode==='submit'});
console.log(JSON.stringify(jobs));
