// Unified provider interface for upstream video generation services.
// Every provider returns responses already normalized to Ark format.

import type { ArkTaskResponse } from '../utils/arkFormat.util.js';

export interface CreateTaskResult {
  upstreamTaskId: string;      // Provider-issued id — persisted for subsequent queries
  arkResponse: ArkTaskResponse; // Ark-shape body returned to the client (id is still the upstream one here; the route layer rewrites it to our cgt-* id)
  statusCode: number;
  credits?: number;             // Evolink: credits_reserved from create response (authoritative billing value)
  upstreamRaw?: unknown;        // Raw upstream response body (pre-normalization) — persisted for audit
}

export interface QueryTaskResult {
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  arkResponse: ArkTaskResponse;
  statusCode: number;
  completionTokens?: number;
  duration?: number;            // seconds of output video (when upstream exposes it)
  quality?: string;
  upstreamRaw?: unknown;        // Raw upstream response body (pre-normalization) — persisted for audit
}

export interface CancelTaskResult {
  statusCode: number;
  // Some providers (Ark) return no body on success; some return a status payload.
  // When the upstream call itself failed (network/HTTP 4xx), body holds the error.
  body?: any;
}

export interface UpstreamProvider {
  name: 'meitu' | 'evolink' | 'ark' | 'aivideo';
  createTask(body: any, userModel: string): Promise<CreateTaskResult>;
  // requestBody: original create-time request, threaded through so providers
  // (e.g. Evolink) can synthesize Ark-shape echo fields the upstream omits.
  queryTask(upstreamTaskId: string, userModel?: string, requestBody?: any): Promise<QueryTaskResult>;
  cancelTask(upstreamTaskId: string): Promise<CancelTaskResult>;
}
