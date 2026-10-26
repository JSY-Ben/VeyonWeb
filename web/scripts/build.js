import { build } from 'esbuild';
await build({ stdin: { contents: "import RFB from '@novnc/novnc/lib/rfb.js'; export default RFB;", resolveDir: process.cwd(), sourcefile: 'novnc-entry.js' }, bundle: true, format: 'esm', platform: 'browser', outfile: 'public/rfb.js', minify: true, legalComments: 'eof' });
console.log('Built noVNC browser client.');
