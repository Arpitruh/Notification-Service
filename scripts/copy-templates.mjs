// Copies non-code template assets (.hbs/.json) from src/templates to
// dist/templates. `tsc` only emits .ts output, so these files must be copied
// separately for production (`node dist/server.js`) to find them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src', 'templates');
const destDir = path.join(root, 'dist', 'templates');

if (!fs.existsSync(srcDir)) {
  console.warn(`No templates directory at ${srcDir}; nothing to copy.`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith('.hbs') || f.endsWith('.json'));

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`Copied ${files.length} template file(s) to dist/templates.`);
