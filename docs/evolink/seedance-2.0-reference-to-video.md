> ## Documentation Index
> Fetch the complete documentation index at: https://docs.evolink.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Seedance 2.0 Reference-to-Video

> - Input reference images (0–9) + reference videos (0–3) + reference audio (0–3) + text prompt to generate video
- Supports various creative scenarios including new generation, video editing, and video extension
- **Now supports AIGC realistic human materials**
- Asynchronous processing mode, use the returned task ID to [query status](/en/api-manual/task-management/get-task-detail)
- Generated video links are valid for 24 hours, please save them promptly



## OpenAPI

````yaml /en/api-manual/video-series/seedance2.0/seedance-2.0-reference-to-video.json POST /v1/videos/generations
openapi: 3.1.0
info:
  title: Seedance 2.0 Reference-to-Video API
  description: >-
    Seedance 2.0 multimodal reference-to-video API, supports mixed generation
    from image, video, and audio reference materials
  license:
    name: MIT
  version: 1.0.0
servers:
  - url: https://api.evolink.ai
    description: Production
security:
  - bearerAuth: []
tags:
  - name: Video Generation
    description: AI video generation endpoints
paths:
  /v1/videos/generations:
    post:
      tags:
        - Video Generation
      summary: Seedance 2.0 Reference-to-Video
      description: >-
        - Input reference images (0–9) + reference videos (0–3) + reference
        audio (0–3) + text prompt to generate video

        - Supports various creative scenarios including new generation, video
        editing, and video extension

        - **Now supports AIGC realistic human materials**

        - Asynchronous processing mode, use the returned task ID to [query
        status](/en/api-manual/task-management/get-task-detail)

        - Generated video links are valid for 24 hours, please save them
        promptly
      operationId: createSeedance20ReferenceToVideo
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
            examples:
              multimodal:
                summary: Multimodal reference (image + video + audio)
                value:
                  model: seedance-2.0-reference-to-video
                  prompt: >-
                    Use the first-person perspective framing of video 1
                    throughout, use audio 1 as background music throughout.
                    First-person perspective fruit tea promotional video...
                  image_urls:
                    - https://example.com/ref1.jpg
                    - https://example.com/ref2.jpg
                  video_urls:
                    - https://example.com/reference.mp4
                  audio_urls:
                    - https://example.com/bgm.mp3
                  duration: 10
                  quality: 720p
                  aspect_ratio: '16:9'
                  generate_audio: true
              video_edit:
                summary: Edit video (replace elements)
                value:
                  model: seedance-2.0-reference-to-video
                  prompt: >-
                    Replace the perfume in the gift box in video 1 with the face
                    cream in image 1, keep the camera movement unchanged
                  image_urls:
                    - https://example.com/cream.jpg
                  video_urls:
                    - https://example.com/original.mp4
                  duration: 5
                  aspect_ratio: '16:9'
              video_extend:
                summary: Extend video (multi-segment concatenation)
                value:
                  model: seedance-2.0-reference-to-video
                  prompt: >-
                    The arched window in video 1 opens, entering the art gallery
                    interior, continuing with video 2, then the camera enters
                    the painting, continuing with video 3
                  video_urls:
                    - https://example.com/part1.mp4
                    - https://example.com/part2.mp4
                    - https://example.com/part3.mp4
                  duration: 8
                  aspect_ratio: '16:9'
                  generate_audio: true
      responses:
        '200':
          description: Video generation task created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoGenerationResponse'
        '400':
          description: Invalid request parameters
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: invalid_request
                  message: Invalid request parameters
                  type: invalid_request_error
        '401':
          description: Unauthenticated, token invalid or expired
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: unauthorized
                  message: Invalid or expired token
                  type: authentication_error
        '402':
          description: Insufficient quota, top-up required
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: insufficient_quota
                  message: Insufficient quota. Please top up your account.
                  type: insufficient_quota
        '403':
          description: Access denied
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: model_access_denied
                  message: >-
                    Token does not have access to model:
                    seedance-2.0-reference-to-video
                  type: invalid_request_error
        '429':
          description: Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: rate_limit_exceeded
                  message: Too many requests, please try again later
                  type: rate_limit_error
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: internal_error
                  message: Internal server error
                  type: api_error
components:
  schemas:
    VideoGenerationRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          description: Video generation model name
          enum:
            - seedance-2.0-reference-to-video
          default: seedance-2.0-reference-to-video
          example: seedance-2.0-reference-to-video
        prompt:
          type: string
          description: >-
            Text prompt describing the desired video. Supports both Chinese and
            English, recommended no more than 500 characters for Chinese


            **Details:**

            - You can use natural language to specify the purpose of each
            material, e.g., "use image 1 as the first frame", "use the camera
            movement from video 1 throughout", "use audio 1 as background music"

            - The model will automatically understand the correspondence between
            material numbers and their intended uses
          example: >-
            Use the first-person perspective framing of video 1 throughout, use
            audio 1 as background music throughout. First-person perspective
            fruit tea promotional video...
        image_urls:
          type: array
          description: >-
            Reference image URL array, **0–9 images**


            **Role description:**


            | Media Type | Role | Typical Usage |

            |---------|------|----------|

            | Image | `reference_image` | Style reference, product image,
            first/last frame (specified via prompt) |


            **Image requirements:**

            - Supported formats: `.jpeg`, `.png`, `.webp`

            - Aspect ratio (width/height): `0.4` ~ `2.5`

            - Width/height pixels: `300` ~ `6000` px

            - Max size per image: `30MB`

            - Total request body size must not exceed `64MB`, do not use Base64
            encoding

            - Image URLs must be directly accessible by the server


            **Note:** You cannot provide only `audio_urls`; at least 1 image
            (`image_urls`) or 1 video (`video_urls`) must be included
          items:
            type: string
            format: uri
          maxItems: 9
          example:
            - https://example.com/ref1.jpg
            - https://example.com/ref2.jpg
        video_urls:
          type: array
          description: >-
            Reference video URL array, **0–3 videos**


            **Role description:**


            | Media Type | Role | Typical Usage |

            |---------|------|----------|

            | Video | `reference_video` | Camera movement reference, motion
            reference, original video for editing/extension |


            **Video requirements:**

            - Supported formats: `.mp4`, `.mov`

            - Resolution: 480p, 720p

            - Duration per video: `2` ~ `15` seconds, max 3 videos, total
            duration of all videos ≤ `15` seconds

            - Aspect ratio (width/height): `0.4` ~ `2.5`

            - Width/height pixels: `300` ~ `6000` px

            - Frame pixels (width × height): `409,600` ~ `927,408` (e.g.,
            640×640 ~ 834×1112)

            - Max size per video: `50MB`

            - Frame rate: `24` ~ `60` FPS

            - Total request body size must not exceed `64MB`, do not use Base64
            encoding

            - Using video references will increase costs (input video duration
            is counted in billing)

            - Video URLs must be directly accessible by the server


            **Note:** You cannot provide only `audio_urls`; at least 1 image
            (`image_urls`) or 1 video (`video_urls`) must be included
          items:
            type: string
            format: uri
          maxItems: 3
          example:
            - https://example.com/reference.mp4
        audio_urls:
          type: array
          description: >-
            Reference audio URL array, **0–3 clips**


            **Role description:**


            | Media Type | Role | Typical Usage |

            |---------|------|----------|

            | Audio | `reference_audio` | Background music, sound effects,
            voice/dialogue reference |


            **Audio requirements:**

            - Supported formats: `.wav`, `.mp3`

            - Duration per clip: `2` ~ `15` seconds, max 3 clips, total duration
            of all audio ≤ `15` seconds

            - Max size per clip: `15MB`

            - Total request body size must not exceed `64MB`, do not use Base64
            encoding

            - Audio URLs must be directly accessible by the server


            **Note:** Audio cannot be provided alone; at least 1 reference video
            or image must be included
          items:
            type: string
            format: uri
          maxItems: 3
          example:
            - https://example.com/bgm.mp3
        duration:
          type: integer
          description: |-
            Output video duration (seconds), defaults to `5` seconds

            **Details:**
            - Supports any integer value between `4`–`15` seconds
            - Duration directly affects billing
          default: 5
          minimum: 4
          maximum: 15
          example: 10
        quality:
          type: string
          description: |-
            Video resolution, defaults to `720p`

            **Options:**
            - `480p`: Lower clarity, lower cost
            - `720p`: Standard clarity, this is the default
            - `1080p`: Ultra HD clarity
          enum:
            - 480p
            - 720p
            - 1080p
          default: 720p
          example: 720p
        aspect_ratio:
          type: string
          description: >-
            Video aspect ratio, defaults to `16:9`


            **Options:**

            - `16:9` (landscape), `9:16` (portrait), `1:1` (square), `4:3`,
            `3:4`, `21:9` (ultrawide)

            - `adaptive`: Determined based on prompt intent, priority: video >
            image > prompt


            **Pixel values per resolution:**


            | Aspect Ratio | 480p | 720p | 1080p |

            |:------:|:----:|:----:|:-----:|

            | 16:9 | 864×496 | 1280×720 | 1920×1080 |

            | 4:3 | 752×560 | 1112×834 | 1664×1248 |

            | 1:1 | 640×640 | 960×960 | 1440×1440 |

            | 3:4 | 560×752 | 834×1112 | 1248×1664 |

            | 9:16 | 496×864 | 720×1280 | 1080×1920 |

            | 21:9 | 992×432 | 1470×630 | 2206×946 |
          enum:
            - '16:9'
            - '9:16'
            - '1:1'
            - '4:3'
            - '3:4'
            - '21:9'
            - adaptive
          default: '16:9'
          example: '16:9'
        generate_audio:
          type: boolean
          description: |-
            Whether to generate synchronized audio, defaults to `true`

            **Options:**
            - `true`: Video includes synchronized audio at no additional charge
            - `false`: Output silent video
          default: true
          example: true
        callback_url:
          type: string
          description: >-
            HTTPS callback URL for task completion


            **Callback timing:**

            - Triggered when the task is completed, failed, or cancelled

            - Sent after billing confirmation is complete


            **Security restrictions:**

            - Only HTTPS protocol is supported

            - Callbacks to private IP addresses are prohibited (127.0.0.1,
            10.x.x.x, 172.16-31.x.x, 192.168.x.x, etc.)

            - URL length must not exceed `2048` characters


            **Callback mechanism:**

            - Timeout: `10` seconds

            - Up to `3` retries after failure (at `1`/`2`/`4` seconds after
            failure respectively)

            - Callback response body format is consistent with the task query
            endpoint response format

            - A 2xx status code is considered successful; other status codes
            trigger retries
          format: uri
          example: https://your-domain.com/webhooks/video-task-completed
    VideoGenerationResponse:
      type: object
      properties:
        created:
          type: integer
          description: Task creation timestamp
          example: 1761313744
        id:
          type: string
          description: Task ID
          example: task-unified-1774857405-abc123
        model:
          type: string
          description: Actual model name used
          example: seedance-2.0-reference-to-video
        object:
          type: string
          enum:
            - video.generation.task
          description: Specific type of the task
        progress:
          type: integer
          description: Task progress percentage (0-100)
          minimum: 0
          maximum: 100
          example: 0
        status:
          type: string
          description: Task status
          enum:
            - pending
            - processing
            - completed
            - failed
          example: pending
        task_info:
          $ref: '#/components/schemas/VideoTaskInfo'
          description: Video task details
        type:
          type: string
          enum:
            - text
            - image
            - audio
            - video
          description: Output type of the task
          example: video
        usage:
          $ref: '#/components/schemas/VideoUsage'
          description: Usage and billing information
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
              description: Error code identifier
            message:
              type: string
              description: Error description message
            type:
              type: string
              description: Error type
    VideoTaskInfo:
      type: object
      properties:
        can_cancel:
          type: boolean
          description: Whether the task can be cancelled
          example: true
        estimated_time:
          type: integer
          description: Estimated completion time (seconds)
          minimum: 0
          example: 165
        video_duration:
          type: integer
          description: Video duration (seconds)
          example: 8
    VideoUsage:
      type: object
      description: Usage and billing information
      properties:
        billing_rule:
          type: string
          description: Billing rule
          enum:
            - per_call
            - per_token
            - per_second
          example: per_second
        credits_reserved:
          type: number
          description: Estimated credits consumed
          minimum: 0
          example: 50
        user_group:
          type: string
          description: User group category
          example: default
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        ##All endpoints require Bearer Token authentication##


        **Get API Key:**


        Visit the [API Key Management Page](https://evolink.ai/dashboard/keys)
        to obtain your API Key


        **Add to request header:**

        ```

        Authorization: Bearer YOUR_API_KEY

        ```

````