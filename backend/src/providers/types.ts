// Unified provider interface for upstream video generation services

export interface CreateTaskResult {
  taskId: string;
  rawResponse: any;       // Full upstream response (translated to V3 format)
  statusCode: number;
  credits?: number;       // Evolink: credits_reserved from create response (authoritative billing value)
}

export interface QueryTaskResult {
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  rawResponse: any;          // Upstream response translated to V3 format
  statusCode: number;
  completionTokens?: number; // Meitu: completion_tokens from usage
  duration?: number;         // Evolink: output video duration (seconds, only in pending response)
  quality?: string;          // Evolink: output quality — unreachable, query never exposes it
}

export interface UpstreamProvider {
  name: 'meitu' | 'evolink';
  createTask(body: any): Promise<CreateTaskResult>;
  queryTask(taskId: string): Promise<QueryTaskResult>;
}
