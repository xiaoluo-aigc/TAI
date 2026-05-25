import { ConfigService } from '@nestjs/config';

const GEMINI_API_KEY_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'VITE_GOOGLE_GEMINI_API_KEY',
] as const;

export function getGeminiApiKey(config: ConfigService): string | null {
  for (const keyName of GEMINI_API_KEY_NAMES) {
    const value = config.get<string>(keyName)?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function getGeminiApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const keyName of GEMINI_API_KEY_NAMES) {
    const value = env[keyName]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}
