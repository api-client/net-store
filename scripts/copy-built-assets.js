import fs from 'fs/promises';
import path from 'path';

async function copy() {
  const src = path.join('src', 'views');
  const dest = path.join('build', 'src', 'views');
  await fs.cp(src, dest, {
    force: true,
    recursive: true,
  });
  await fs.cp('cli.cmd', path.join('build', 'cli.cmd'), {
    force: true,
  });
}

copy();
