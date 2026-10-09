import { writeFile } from 'node:fs/promises';
import { test } from '/Users/diegohaz/Developer/ariakit/node_modules/.pnpm/@playwright+test@1.63.0/node_modules/@playwright/test/index.mjs';
for (let i = 0; i < 80; i++) {
  test(`capture ${i}`, async ({}, testInfo) => {
    const bytes = Buffer.alloc(1024 * 1024, i);
    if (process.env.ATTACHMENT_MODE === 'path') {
      const path = testInfo.outputPath('image.png');
      await writeFile(path, bytes);
      await testInfo.attach('visonaut-image-0', { path, contentType: 'image/png' });
    } else {
      await testInfo.attach('visonaut-image-0', { body: bytes, contentType: 'image/png' });
    }
  });
}
