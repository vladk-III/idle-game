// Copies the game's static files into www/, which the Android app bundles
// and the Pages workflow publishes as the browser version.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'css', 'js', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ ready');
