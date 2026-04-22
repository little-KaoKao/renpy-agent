// Post-build step: mirror non-.ts assets from src/ → dist/ so runtime can read them.
// - src/templates/*.rpy → dist/templates/*.rpy  (Coder reads these)
// - src/schema/galgame-workspace.ts → dist/schema/galgame-workspace.ts  (Planner embeds it)

import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function mirrorDir(srcDir, dstDir, filter = () => true) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir);
  let copied = 0;
  for (const name of entries) {
    if (!filter(name)) continue;
    await copyFile(resolve(srcDir, name), resolve(dstDir, name));
    copied++;
  }
  return copied;
}

const templatesCopied = await mirrorDir(
  resolve(repoRoot, 'src/templates'),
  resolve(repoRoot, 'dist/templates'),
);
const schemaCopied = await mirrorDir(
  resolve(repoRoot, 'src/schema'),
  resolve(repoRoot, 'dist/schema'),
  (name) => name.endsWith('.ts'),
);
console.log(`post-build: ${templatesCopied} template(s), ${schemaCopied} schema file(s) mirrored to dist/`);
