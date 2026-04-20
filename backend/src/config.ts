import { config as loadEnv } from 'dotenv';
loadEnv();

// -- Environment Variable Validation --
const requiredEnvVars = ['JWT_SECRET'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Environment variable ${envVar} is not set.`);
    process.exit(1);
  }
}

export const config = {
  JWT_SECRET: process.env.JWT_SECRET!,
  UPSTREAM_URL: process.env.UPSTREAM_URL || 'http://127.0.0.1',
  MEITU_API_KEY: process.env.MEITU_API_KEY || '',
  PENDING_TIMEOUT_MS: (parseInt(process.env.PENDING_TIMEOUT_MINUTES || '60')) * 60 * 1000,
  PRICE_WITH_VIDEO: parseFloat(process.env.PRICE_WITH_VIDEO || '28'),
  PRICE_WITHOUT_VIDEO: parseFloat(process.env.PRICE_WITHOUT_VIDEO || '46'),
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || 'admin123',
  // Base URL used to rewrite outward video URLs to self-hosted /v/{task_id}.mp4.
  // Empty string disables rewriting (upstream URL passes through as before).
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  // Ark/Meitu signed video URLs expire 24h after upstream_finished_at.
  // We subtract a small safety margin so a freshly-issued 302 Location never
  // hands back a URL that's about to expire mid-download.
  ARK_VIDEO_URL_TTL_MS: 24 * 60 * 60 * 1000 - 5 * 60 * 1000,

  // -- S3-compatible offload (Tigris / MinIO / AWS S3) --
  // Empty S3_BUCKET disables the offload feature entirely; /v falls back to
  // pure upstream 302 as before.
  S3_BUCKET: process.env.S3_BUCKET || '',
  S3_REGION: process.env.AWS_REGION || 'auto',
  S3_ENDPOINT: process.env.AWS_ENDPOINT_URL_S3 || '',
  S3_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  S3_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  // Validity of each /v-issued presigned URL, in seconds. Requested 24h.
  S3_PRESIGN_TTL_SECONDS: parseInt(process.env.S3_PRESIGN_TTL_SECONDS || String(24 * 60 * 60)),
  // Custom CDN/vanity domain whose CNAME points to {bucket}.t3.tigrisbucket.io
  // (Tigris vhost alias). When set, presigned GET URLs are signed for this
  // host and have NO /{bucket}/ prefix in the path. Empty = use the standard
  // endpoint and bucket-prefixed paths.
  S3_PUBLIC_ENDPOINT: (process.env.S3_PUBLIC_ENDPOINT || '').replace(/\/+$/, ''),
  // Retry a failed upload up to this many times before giving up in cron.
  S3_UPLOAD_MAX_ATTEMPTS: parseInt(process.env.S3_UPLOAD_MAX_ATTEMPTS || '5'),
  MODEL_MAPPING: process.env.MODEL_MAPPING 
    ? JSON.parse(process.env.MODEL_MAPPING) 
    : {
        'doubao-seedance-2.0-fast': 'ep-20260307130821-xw5wf',
        'doubao-seedance-2.0-fast-260128': 'ep-20260307130821-xw5wf',
        'doubao-seedance-2-0': 'ep-20260307130721-bx7tv',
        'doubao-seedance-2-0-260128': 'ep-20260307130721-bx7tv',
      } as Record<string, string>,

  // -- Auto provider routing --
  // When user/key provider='auto', requests start on Meitu and fall back to
  // Evolink when Meitu rejects on content moderation. Match is substring,
  // case-sensitive, against the upstream `error.code`. See docs/ark/get.md and
  // production samples (e.g. InputImageSensitiveContentDetected.PolicyViolation,
  // OutputVideoSensitiveContentDetected) — they all share this substring.
  AUTO_FALLBACK_ERROR_CODE_PATTERN: process.env.AUTO_FALLBACK_ERROR_CODE_PATTERN || 'SensitiveContentDetected',

  // -- Evolink Provider --
  EVOLINK_API_KEY: process.env.EVOLINK_API_KEY || '',
  EVOLINK_URL: process.env.EVOLINK_URL || 'https://api.evolink.ai',
  USD_TO_CNY_RATE: parseFloat(process.env.USD_TO_CNY_RATE || '7.25'),
  // Evolink credit exchange rate: $100 = 6800 Credits → 68 Credits per USD
  EVOLINK_CREDITS_PER_USD: parseFloat(process.env.EVOLINK_CREDITS_PER_USD || '68'),
  // Evolink model base mapping: user model name → Evolink model base name
  // The actual mode (text/image/reference) is inferred dynamically from request body
  EVOLINK_MODEL_BASE: process.env.EVOLINK_MODEL_BASE
    ? JSON.parse(process.env.EVOLINK_MODEL_BASE)
    : {
        'doubao-seedance-2.0-fast': 'seedance-2.0-fast',
        'doubao-seedance-2.0-fast-260128': 'seedance-2.0-fast',
        'doubao-seedance-2-0': 'seedance-2.0',
        'doubao-seedance-2-0-260128': 'seedance-2.0',
      } as Record<string, string>,

  // -- Aivideoapi.ai Provider --
  AIVIDEO_API_KEY: process.env.AIVIDEO_API_KEY || '',
  AIVIDEO_URL: process.env.AIVIDEO_URL || 'https://api.aivideoapi.ai',
  // User-facing alias → aivideoapi.ai model name. Aivideoapi only exposes the
  // standard doubao-seedance-2.0 line (no "fast" variant as of docs/aivideo).
  AIVIDEO_MODEL_MAPPING: process.env.AIVIDEO_MODEL_MAPPING
    ? JSON.parse(process.env.AIVIDEO_MODEL_MAPPING)
    : {
        'doubao-seedance-2-0': 'doubao-seedance-2.0',
        'doubao-seedance-2-0-260128': 'doubao-seedance-2.0',
        'doubao-seedance-2.0': 'doubao-seedance-2.0',
      } as Record<string, string>,
  // Aivideoapi per-second USD rates. hasVideo switches between the two tiers.
  // Source: docs/aivideo/aivideo.md pricing table.
  AIVIDEO_PRICE_PER_SECOND_USD: {
    'false:480p': 0.10,
    'false:720p': 0.21,
    'false:1080p': 0.51,
    'true:480p': 0.06,
    'true:720p': 0.125,
    'true:1080p': 0.31,
  } as Record<string, number>,

  // -- Ark (Volcengine) Provider --
  ARK_API_KEY: process.env.ARK_API_KEY || '',
  ARK_URL: process.env.ARK_URL || 'https://ark.cn-beijing.volces.com',
  // Ark accepts model IDs directly; map from user-facing alias → upstream model/endpoint ID
  ARK_MODEL_MAPPING: process.env.ARK_MODEL_MAPPING
    ? JSON.parse(process.env.ARK_MODEL_MAPPING)
    : {
        'doubao-seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2.0-fast-260128': 'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0': 'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-260128': 'doubao-seedance-2-0-260128',
      } as Record<string, string>,
  // Ark pricing: CNY per 1,000,000 tokens — see docs/ark/pricing.md
  // Keyed by "<model>:<hasVideo>" where model is normalized to 2.0 vs 2.0-fast.
  ARK_PRICE_PER_MILLION: {
    '2.0:false:480p': 46,
    '2.0:false:720p': 46,
    '2.0:false:1080p': 51,
    '2.0:true:480p': 28,
    '2.0:true:720p': 28,
    '2.0:true:1080p': 31,
    '2.0-fast:false:480p': 37,
    '2.0-fast:false:720p': 37,
    '2.0-fast:true:480p': 22,
    '2.0-fast:true:720p': 22,
  } as Record<string, number>,
};
