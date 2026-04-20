---
---

# Seedance 2.0

Seedance 2.0 is a multi-modal video generation model that supports text, image, video, and audio references as input.

**Why choose aivideoapi.ai?** Same Seedance 2.0 model, but service quality varies greatly across API providers:

| Feature | aivideoapi.ai | Other API Providers |
|---------|-------------|-----------------|
| Generation Speed | Avg. 5-8 min | 30-50 min |
| Concurrency | High concurrency | Very limited |
| Success Rate | 99% | Unstable |
| 1080p | Supported | Not supported |

## Model

| Model Name | Duration | Resolution | Aspect Ratios |
|------------|----------|------------|---------------|
| `doubao-seedance-2.0` | 4-15s | 480p, 720p, 1080p | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive |

## Pricing

Formula-based billing with different rates depending on whether video references are used.

- **Without video**: `output_duration × per_second`
- **With video**: `(input_video_duration + output_duration) × per_second`

| Resolution | Without Video Reference | With Video Reference |
|------------|------------------------|---------------------|
| 480p | 20 credits/s ($0.10/s) | 12 credits/s ($0.06/s) |
| 720p | 42 credits/s ($0.21/s) | 25 credits/s ($0.125/s) |
| 1080p | 102 credits/s ($0.51/s) | 62 credits/s ($0.31/s) |

> When using video references, input video duration is automatically detected. The total billable duration = input video duration + output video duration.

**Examples:**
- 1080p, 5s, text-only: 102 × 5 = **510 credits** ($2.55)
- 1080p, 10s output, 5s input video: 62 × (5 + 10) = **930 credits** ($4.65)
- 720p, 5s, text-only: 42 × 5 = **210 credits** ($1.05)
- 720p, 10s output, 5s input video: 25 × (5 + 10) = **375 credits** ($1.875)
- 480p, 5s, text-only: 20 × 5 = **100 credits** ($0.50)
- 480p, 15s output, 5s input video: 12 × (5 + 15) = **240 credits** ($1.20)

## Create Task

```
POST https://api.aivideoapi.ai/v1/videos/generations
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Must be `doubao-seedance-2.0` |
| `input` | object | Yes | Generation parameters, see below |
| `callback_url` | string | No | URL to receive task completion/failure notifications |

### Input Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Text description (Chinese/English, recommended under 500 chars) |
| `generation_type` | string | No | Generation mode: `omni_reference` (default) or `first_and_last_frames`. See [Generation Type](#generation-type) |
| `image_urls` | string[] \| object[] | No | Reference image URLs (up to 9 for omni_reference, 1-2 for first_and_last_frames). See [Image URLs Format](#image-urls-format) |
| `video_urls` | string[] | No | Reference video URLs (up to 3, total duration max 15s). Ignored in `first_and_last_frames` mode |
| `audio_urls` | string[] | No | Reference audio URLs (up to 3, total duration max 15s). Ignored in `first_and_last_frames` mode |
| `duration` | integer | No | Video duration in seconds: 4-15 (default: 5). See [Duration](#duration) |
| `aspect_ratio` | string | No | Aspect ratio. See [Aspect Ratio](#aspect-ratio) (default: adaptive) |
| `resolution` | string | No | `480p`, `720p`, or `1080p` (default: 720p) |
| `generate_audio` | boolean | No | Generate synchronized audio (default: true) |
| `watermark` | boolean | No | Add watermark (default: false) |
| `seed` | integer | No | Random seed controlling generation randomness. Range: [-1, 4294967295] (default: -1, uses a random value). See [Seed](#seed) |
| `return_last_frame` | boolean | No | Whether to return the last frame image of the video (default: false). See [Last Frame](#last-frame) |
| `web_search` | boolean | No | Enable web search for real-time information (default: false) |

### Generation Type

| Value | Description |
|-------|-------------|
| `omni_reference` | **(Default)** Omni mode. Supports images, videos, and audio as reference inputs. |
| `first_and_last_frames` | First and last frame mode. Provide 1-2 images: the first image is used as the first frame, the second (optional) as the last frame. `video_urls` and `audio_urls` are ignored. Pricing uses the "Without Video Reference" rate. |

### Image URLs Format

`image_urls` supports both string array and object array format:

**String array:**
```json
"image_urls": [
  "https://example.com/photo1.jpg",
  "https://example.com/photo2.jpg"
]
```

**Object array:**
```json
"image_urls": [
  { "url": "https://example.com/photo1.jpg" },
  { "url": "https://example.com/photo2.jpg" }
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Image URL |

> **About real person images:** All images are automatically processed through our content moderation system. If an image contains celebrities, public figures, or other sensitive content, the task will fail and credits will be automatically refunded. Each image takes an additional 2-3 seconds to process.

### Supported Input Combinations

- Text only
- Text (optional) + Image(s)
- Text (optional) + Video(s)
- Text (optional) + Image(s) + Audio
- Text (optional) + Image(s) + Video(s)
- Text (optional) + Video(s) + Audio
- Text (optional) + Image(s) + Video(s) + Audio

> Audio cannot be used alone. It must be combined with at least one image or video.

### Example: Text-to-Video

```bash
curl -X POST https://api.aivideoapi.ai/v1/videos/generations \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2.0",
    "callback_url": "https://your-server.com/webhook",
    "input": {
      "prompt": "A drone shot flying over mountains at sunset, cinematic lighting",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "480p",
      "generate_audio": true
    }
  }'
```

### Example: Image + Video + Audio References

```bash
curl -X POST https://api.aivideoapi.ai/v1/videos/generations \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2.0",
    "callback_url": "https://your-server.com/webhook",
    "input": {
      "prompt": "Use the person image as the main character, follow the camera movement in the videos, with audio as background music",
      "image_urls": [
        { "url": "https://example.com/person.jpg" },
        { "url": "https://example.com/background.jpg" }
      ],
      "video_urls": ["https://example.com/reference1.mp4", "https://example.com/reference2.mp4"],
      "audio_urls": ["https://example.com/bgm.mp3", "https://example.com/sfx.wav"],
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "480p"
    }
  }'
```

### Example: First and Last Frames

Use `generation_type: "first_and_last_frames"` to control the start and end of the video. Provide 1 image (first frame only) or 2 images (first and last frame).

```bash
curl -X POST https://api.aivideoapi.ai/v1/videos/generations \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2.0",
    "callback_url": "https://your-server.com/webhook",
    "input": {
      "prompt": "A person walks from the park to the city center",
      "generation_type": "first_and_last_frames",
      "image_urls": [
        { "url": "https://example.com/start-frame.jpg" },
        { "url": "https://example.com/end-frame.jpg" }
      ],
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "480p"
    }
  }'
```

> In `first_and_last_frames` mode, `video_urls` and `audio_urls` are ignored. Pricing uses the "Without Video Reference" rate.

### Example: Web Search Enabled

When `web_search` is enabled, the model can look up real-time information to enhance video generation.

```bash
curl -X POST https://api.aivideoapi.ai/v1/videos/generations \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2.0",
    "callback_url": "https://your-server.com/webhook",
    "input": {
      "prompt": "Generate a short news clip about the latest SpaceX rocket launch",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "480p",
      "web_search": true
    }
  }'
```

### Response

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "cbf6b69d-4f03-4817-8ed7-94c0292184a8"
  }
}
```


## Query Task

```bash
curl https://api.aivideoapi.ai/v1/tasks/{taskId} \
  -H "Authorization: Bearer sk-your-api-key"
```

Status transitions: `pending` -> `processing` -> `completed` or `failed`.

### Processing

```json
{
  "id": "e717a5ee-2ed4-47f4-8cc3-53394f1abb35",
  "status": "processing",
  "model": "doubao-seedance-2.0",
  "created_at": 1774706165,
  "progress": null
}
```

### Completed

```json
{
  "id": "7d89c51e-9430-410e-909e-df347131ebaa",
  "status": "completed",
  "model": "doubao-seedance-2.0",
  "created_at": 1774790227,
  "completed_at": 1774796529,
  "output": {
    "urls": [
      "https://file.aivideoapi.ai/videos/2026/04/07/abc.mp4"
    ],
    "last_frame_url": "https://file.aivideoapi.ai/images/2026/04/07/abc-last-frame.png",
    "metadata": {
      "seed": 41485,
      "ratio": "16:9",
      "duration": 5,
      "resolution": "480p",
      "generate_audio": true,
      "framespersecond": 24
    }
  }
}
```

> `last_frame_url` is only present when `return_last_frame: true` was set in the request. See [Last Frame](#last-frame).
> Video URLs expire in 24 hours. Download promptly after generation completes.

### Failed

```json
{
  "id": "57c8772c-f834-46f3-9b7d-81f92e104050",
  "status": "failed",
  "model": "doubao-seedance-2.0",
  "created_at": 1774793758,
  "error": {
    "code": "upstream_error",
    "message": "The request failed because the input text may contain sensitive information. Request id: 0217747937596950e290995bd2535df6af5f05331d9ca5663eeee"
  }
}
```

When a task fails, pre-charged credits are automatically refunded.

## Callback

Pass `callback_url` when creating the task. The system will automatically send a POST request to your URL when the task completes or fails.

### On Task Completed

```json
{
  "id": "7d89c51e-9430-410e-909e-df347131ebaa",
  "status": "completed",
  "model": "doubao-seedance-2.0",
  "created_at": 1774790227,
  "completed_at": 1774796529,
  "output": {
    "urls": [
      "https://file.aivideoapi.ai/videos/2026/04/07/abc.mp4"
    ],
    "last_frame_url": "https://file.aivideoapi.ai/images/2026/04/07/abc-last-frame.png",
    "metadata": {
      "seed": 41485,
      "ratio": "16:9",
      "duration": 5,
      "resolution": "480p",
      "generate_audio": true,
      "framespersecond": 24
    }
  }
}
```

### On Task Failed

```json
{
  "id": "57c8772c-f834-46f3-9b7d-81f92e104050",
  "status": "failed",
  "model": "doubao-seedance-2.0",
  "created_at": 1774793758,
  "error": {
    "code": "upstream_error",
    "message": "The request failed because the input text may contain sensitive information. Request id: 0217747937596950e290995bd2535df6af5f05331d9ca5663eeee"
  }
}
```

When a task fails, pre-charged credits are automatically refunded.

## Parameters

### Duration

Integer, unit: seconds. Default: **5**.

- Range: 4-15
- Duration affects billing — see [Pricing](#pricing)

### Aspect Ratio

Default: **adaptive**.

Supported values: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive`

When set to `adaptive`, the model auto-selects the best ratio based on the input:

- **Text-to-video**: intelligently chosen based on the prompt
- **Image-to-video (first frame / first+last frame)**: matched to the uploaded image's aspect ratio
- **Multi-modal reference**: if the intent is first-frame / edit / extend, matched to that image or video; otherwise matched to the first media file (priority: video > image)

The actual ratio used is returned in the task response `metadata.ratio` field.

### Seed

Integer. Default: **-1**.

- Range: integer in [-1, 4294967295]
- The actual seed used is returned in the task response `metadata.seed` field

> **Note**
> - For the same request, when the model receives different seed values — e.g., not specifying a seed, setting seed to `-1` (which uses a random value), or manually changing the seed — it will produce different results.
> - For the same request, when the model receives the same seed value, it will produce similar results, but they are not guaranteed to be identical.

### Last Frame

Boolean. Default: **false**.

- `true`: Return the last frame image of the generated video. When set to `true`, the last frame image is available via the query task endpoint in the `output.last_frame_url` field. The image has the same width and height as the generated video, and contains no watermark.
- `false`: Do not return the last frame image.

This parameter enables generating multiple consecutive videos: use the last frame of the previous video as the first frame of the next video task to quickly produce a sequence of connected clips.

## Input Requirements

### Images
- Formats: JPEG, PNG, WebP, BMP, TIFF, GIF
- Aspect ratio (w/h): 0.4 ~ 2.5
- Dimensions: 300 ~ 6000 px per side
- Max size: 30 MB per image

### Videos
- Formats: MP4, MOV
- Resolution: 480p, 720p
- Duration: 2-15s per video, up to 3 reference videos, total duration max 15s
- Aspect ratio (w/h): 0.4 ~ 2.5
- Dimensions: 300 ~ 6000 px per side
- Pixel count (w × h): 409,600 ~ 927,408 (e.g., 640×640=409,600 meets minimum; 834×1112=927,408 meets maximum)
- Max size: 50 MB per video
- FPS: 24 ~ 60

### Audio
- Formats: WAV, MP3
- Duration: 2-15s per audio, total max 15s
- Max size: 15 MB per audio

## Resolution Reference

### 480p

| Aspect Ratio | Pixels |
|-------------|--------|
| 16:9 | 864 x 496 |
| 4:3 | 752 x 560 |
| 1:1 | 640 x 640 |
| 3:4 | 560 x 752 |
| 9:16 | 496 x 864 |
| 21:9 | 992 x 432 |

### 720p

| Aspect Ratio | Pixels |
|-------------|--------|
| 16:9 | 1280 x 720 |
| 4:3 | 1112 x 834 |
| 1:1 | 960 x 960 |
| 3:4 | 834 x 1112 |
| 9:16 | 720 x 1280 |
| 21:9 | 1470 x 630 |

### 1080p

| Aspect Ratio | Pixels |
|-------------|--------|
| 16:9 | 1920 x 1080 |
| 4:3 | 1664 x 1248 |
| 1:1 | 1440 x 1440 |
| 3:4 | 1248 x 1664 |
| 9:16 | 1080 x 1920 |
| 21:9 | 2205 x 945 |


---

## Error Codes

When a request fails, the API returns a JSON error response:

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "Your credit balance is too low. Please top up.",
    "type": "billing_error"
  }
}
```

### Error Reference

| HTTP Status | Code | Type | Description |
|-------------|------|------|-------------|
| 400 | `invalid_request` | invalid_request_error | Missing or invalid parameters |
| 401 | `invalid_api_key` | authentication_error | API key is invalid, disabled, or deleted |
| 402 | `insufficient_credits` | billing_error | Credit balance too low, please top up |
| 403 | `ip_not_allowed` | permission_error | Request IP not in the key's allowlist |
| 404 | `model_not_found` | invalid_request_error | Model does not exist or is inactive |
| 404 | `task_not_found` | invalid_request_error | Task ID does not exist |
| 429 | `rate_limit_exceeded` | rate_limit_error | Too many requests, please slow down |
| 429 | `spend_limit_exceeded` | billing_error | Key spend limit reached (hourly/daily/total) |
| 500 | `internal_error` | api_error | Unexpected server error |
| 503 | `upstream_error` | upstream_error | Upstream AI provider returned an error |

### Common Scenarios

### invalid_request (400)

Returned when required fields are missing or invalid.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "'model' is required.",
    "type": "invalid_request_error"
  }
}
```

### insufficient_credits (402)

Your balance is too low. Check your balance with `GET /v1/credits` and top up in **Dashboard > Billing**.

### invalid_api_key (401)

Possible causes:
- The key does not start with `sk-`
- The key has been disabled or deleted
- The user account has been banned

### upstream_error (503)

The upstream AI provider returned an error. This may happen when:
- The input contains sensitive or prohibited content
- The provider is temporarily unavailable
- The request parameters are not supported by the provider

Credits are automatically refunded when a task fails due to upstream errors.
