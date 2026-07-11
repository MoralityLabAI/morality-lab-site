import { cp, mkdir, rm } from 'node:fs/promises';

const rootAssets = ['index.html', 'sweepweave.html', 'assets', 'papers', 'storyworlds'];

await rm('dist', { recursive: true, force: true });
await mkdir('dist/storyworld', { recursive: true });

for (const asset of rootAssets) {
  await cp(asset, `dist/${asset}`, { recursive: true });
}

await cp('storyworld-app/dist', 'dist/storyworld', { recursive: true });
await cp('storyworld-editor/dist', 'dist/editor', { recursive: true });
