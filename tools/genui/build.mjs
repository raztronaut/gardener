import {build} from 'esbuild';
await build({entryPoints:['tools/genui/runtime.js'],outfile:'public/genui/a2ui-runtime.js',bundle:true,format:'esm',platform:'browser',target:'chrome120',minify:true,legalComments:'linked'});
console.log('Built official A2UI runtime');
