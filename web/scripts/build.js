import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// noVNC 1.6.0's published CommonJS browser.js contains a top-level await.
// esbuild consequently treats it as ESM and leaves its exports variable unbound.
// Keep the optional codec probe asynchronous inside the CommonJS module. Its
// capability flag remains false until the probe succeeds.
const browserCompatibility = {
  name: 'novnc-commonjs-codec-probe',
  setup(build) {
    build.onLoad({ filter: /@novnc[\/]novnc[\/]lib[\/]util[\/]browser\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const probe = 'exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();';
      if (!source.includes(probe)) throw new Error('noVNC codec probe changed; review the browser compatibility transform.');
      return { contents: source.replace(probe, '_checkWebCodecsH264DecodeSupport().then(function(supported) { exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = supported; }).catch(function() { exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false; });'), loader: 'js' };
    });
  },
};
await build({ stdin: { contents: "import RFB from '@novnc/novnc/lib/rfb.js'; export default RFB;", resolveDir: process.cwd(), sourcefile: 'novnc-entry.js' }, plugins: [browserCompatibility], bundle: true, format: 'esm', platform: 'browser', outfile: 'public/rfb.js', minify: true, legalComments: 'eof' });
console.log('Built noVNC browser client.');
