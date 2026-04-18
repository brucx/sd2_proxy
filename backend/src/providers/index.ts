// Provider factory — returns the appropriate upstream provider based on name

import type { UpstreamProvider } from './types.js';
import { meituProvider } from './meitu.provider.js';
import { evolinkProvider } from './evolink.provider.js';

export function getProvider(providerName: string): UpstreamProvider {
  switch (providerName) {
    case 'evolink':
      return evolinkProvider;
    case 'meitu':
    default:
      return meituProvider;
  }
}

export { meituProvider, evolinkProvider };
export type { UpstreamProvider, CreateTaskResult, QueryTaskResult } from './types.js';
