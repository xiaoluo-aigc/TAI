import { Logger } from '@nestjs/common';
import { buildOpenObserveIngestEndpoint } from './openobserve-url';

type OpenObserveIngestOptions = {
  baseUrl?: string | null;
  username?: string | null;
  password?: string | null;
  org?: string | null;
  stream: string;
  payload: Record<string, unknown>;
  logger?: Pick<Logger, 'warn'>;
  fetchImpl?: typeof fetch;
};

export const sendOpenObserveJsonIngest = async (
  options: OpenObserveIngestOptions,
): Promise<void> => {
  const baseUrl = options.baseUrl?.trim();
  const username = options.username?.trim();
  const password = options.password?.trim();
  const org = options.org?.trim() || 'default';

  if (!baseUrl || !username || !password) {
    return;
  }

  const endpoint = buildOpenObserveIngestEndpoint(baseUrl, org, options.stream);
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([options.payload]),
    });

    if (!response.ok) {
      options.logger?.warn(
        `OpenObserve ingest failed: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    options.logger?.warn(
      `OpenObserve ingest skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
