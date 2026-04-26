// Post-build step: mirror non-.ts assets from src/ → dist/ so runtime can read them.
// - src/templates/**/*         → dist/templates/**/*   (Coder reads .rpy templates and gui/ binaries)
// - src/schema/galgame-workspace.ts → dist/schema/galgame-workspace.ts  (Planner embeds it)
//
// Incremental: each file is only recopied when src is newer OR size differs
// from the existing dst (mtime + size comparison). First build still full-copies
// because dst/ doesn't exist; subsequent builds skip unchanged files.

import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function dstStat(path) {
  try {
    return await stat(path);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function mirrorDir(srcDir, dstDir, filter = () => true) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir);
  const stats = { copied: 0, skipped: 0 };
  for (const name of entries) {
    const srcPath = resolve(srcDir, name);
    const dstPath = resolve(dstDir, name);
    const st = await stat(srcPath);
    if (st.isDirectory()) {
      const sub = await mirrorDir(srcPath, dstPath, filter);
      stats.copied += sub.copied;
      stats.skipped += sub.skipped;
      continue;
    }
    if (!filter(name)) continue;
    const dstSt = await dstStat(dstPath);
    // Copy when dst is missing, size mismatches, or src is newer than dst.
    // mtimeMs granularity is typically ms on both Linux and Windows; round to
    // avoid FS drift on FAT/exFAT where mtime has 2s resolution.
    const srcNewer = dstSt !== null && Math.floor(st.mtimeMs) > Math.floor(dstSt.mtimeMs);
    const sizeDiffers = dstSt !== null && st.size !== dstSt.size;
    if (dstSt !== null && !srcNewer && !sizeDiffers) {
      stats.skipped++;
      continue;
    }
    await copyFile(srcPath, dstPath);
    stats.copied++;
  }
  return stats;
}

const templatesStats = await mirrorDir(
  resolve(repoRoot, 'src/templates'),
  resolve(repoRoot, 'dist/templates'),
);
const schemaStats = await mirrorDir(
  resolve(repoRoot, 'src/schema'),
  resolve(repoRoot, 'dist/schema'),
  (name) => name.endsWith('.ts'),
);
console.log(
  `post-build: templates ${templatesStats.copied} copied / ${templatesStats.skipped} skipped, ` +
    `schema ${schemaStats.copied} copied / ${schemaStats.skipped} skipped (dist/)`,
);
