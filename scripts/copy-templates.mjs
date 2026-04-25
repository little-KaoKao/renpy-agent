// Post-build step: mirror non-.ts assets from src/ → dist/ so runtime can read them.
// - src/templates/**/*         → dist/templates/**/*   (Coder reads .rpy templates and gui/ binaries)
// - src/schema/galgame-workspace.ts → dist/schema/galgame-workspace.ts  (Planner embeds it)

import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function mirrorDir(srcDir, dstDir, filter = () => true) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir);
  let copied = 0;
  for (const name of entries) {
    const srcPath = resolve(srcDir, name);
    const dstPath = resolve(dstDir, name);
    const st = await stat(srcPath);
    if (st.isDirectory()) {
      copied += await mirrorDir(srcPath, dstPath, filter);
      continue;
    }
    if (!filter(name)) continue;
    await copyFile(srcPath, dstPath);
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
console.log(`post-build: ${templatesCopied} template file(s), ${schemaCopied} schema file(s) mirrored to dist/`);
