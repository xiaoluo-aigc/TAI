import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

type WorkerRequest = {
  imageBase64?: string;
  mimeType?: string;
};

function summarizeLoaderError(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as Error & { code?: string; cause?: unknown };
    const code = anyError.code ? ` code=${String(anyError.code)}` : '';
    const cause =
      anyError.cause instanceof Error
        ? ` cause=${anyError.cause.name}:${anyError.cause.message}`
        : '';
    return `${anyError.name}: ${anyError.message}${code}${cause}`;
  }
  return String(error);
}

function resolveRemovalModuleEntry(): string {
  const packageSpec = '@imgly/background-removal-node';
  const lookupPaths = [__dirname, process.cwd()];

  for (const basePath of lookupPaths) {
    try {
      return require.resolve(packageSpec, { paths: [basePath] });
    } catch {
      // ignore and continue
    }
  }

  return require.resolve(packageSpec);
}

function resolveLocalModelPublicPath(): string {
  const resolveFromInstalledPackage = (): string | null => {
    const packageSpec = '@imgly/background-removal-node/package.json';
    const lookupPaths = [__dirname, process.cwd()];

    for (const basePath of lookupPaths) {
      try {
        const packageJsonPath = require.resolve(packageSpec, { paths: [basePath] });
        const packageDir = path.dirname(packageJsonPath);
        const distDir = path.join(packageDir, 'dist');
        const resourcesPath = path.join(distDir, 'resources.json');
        if (fs.existsSync(resourcesPath)) {
          return distDir;
        }
      } catch {
        // ignore and continue fallback candidates
      }
    }

    return null;
  };

  const candidateDirs = [
    resolveFromInstalledPackage(),
    path.resolve(__dirname, '../../../node_modules/@imgly/background-removal-node/dist'),
    path.resolve(process.cwd(), 'node_modules/@imgly/background-removal-node/dist'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

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
    const entryPath = resolveRemovalModuleEntry();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entryPath);
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
    const message = summarizeLoaderError(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

void main();
