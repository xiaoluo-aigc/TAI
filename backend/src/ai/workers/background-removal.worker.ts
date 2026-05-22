import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

type WorkerRequest = {
  imageBase64?: string;
  mimeType?: string;
};

function resolveLocalModelPublicPath(): string {
  const candidateDirs = [
    path.resolve(__dirname, '../../../node_modules/@imgly/background-removal-node/dist'),
    path.resolve(process.cwd(), 'node_modules/@imgly/background-removal-node/dist'),
  ];

  for (const dir of candidateDirs) {
    const resourcesPath = path.join(dir, 'resources.json');
    if (fs.existsSync(resourcesPath)) {
      const fileUrl = pathToFileURL(dir).href;
      return fileUrl.endsWith('/') ? fileUrl : `${fileUrl}/`;
    }
  }

  throw new Error(
    'Local background removal resources not found. Missing @imgly/background-removal-node/dist/resources.json'
  );
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw || '{}') as WorkerRequest;
    if (!payload.imageBase64 || typeof payload.imageBase64 !== 'string') {
      throw new Error('imageBase64 is required');
    }

    const mimeType = payload.mimeType || 'image/png';
    const blob = new Blob([Buffer.from(payload.imageBase64, 'base64')], { type: mimeType });
    const mod = await import('@imgly/background-removal-node');
    const result = await mod.removeBackground(blob, {
      publicPath: resolveLocalModelPublicPath(),
      output: {
        format: 'image/png',
        quality: 0.8,
      },
    });

    const resultBuffer = Buffer.from(await result.arrayBuffer());
    process.stdout.write(
      JSON.stringify({
        ok: true,
        imageData: `data:image/png;base64,${resultBuffer.toString('base64')}`,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

void main();
