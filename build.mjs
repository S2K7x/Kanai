import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import JavaScriptObfuscator from 'javascript-obfuscator';

const sources = ['script.js', 'poker.js'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

for (const file of sources) {
  const source = await readFile(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, {
    target: 'browser',
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayThreshold: 0.65,
    stringArrayEncoding: ['base64'],
    rotateStringArray: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    disableConsoleOutput: true,
    sourceMap: false
  });
  await writeFile(`dist/${file}`, result.getObfuscatedCode());
}

const html = await readFile('index.html', 'utf8');
await writeFile('dist/index.html', html
  .replace('src="dist/script.js"', 'src="script.js"')
  .replace('src="dist/poker.js"', 'src="poker.js"'));
await cp('style.css', 'dist/style.css');
await cp('assets', 'dist/assets', { recursive: true });
await cp('leaderboard.html', 'dist/leaderboard.html');
await cp('manifest.webmanifest', 'dist/manifest.webmanifest');
// Stamp the service worker with a build id so each deploy gets its own cache.
const buildId = Date.now().toString(36);
await writeFile('dist/sw.js', (await readFile('sw.js', 'utf8')).replace('__BUILD_ID__', buildId));
console.log('Obfuscated Kanai site written to dist/.');
