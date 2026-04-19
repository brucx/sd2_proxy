> ## Documentation Index
> Fetch the complete documentation index at: https://docs.evolink.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Seedance 2.0 Image-to-Video

> - Input 1 image for first-frame video generation, input 2 images for first-last-frame video generation, the model determines automatically
- **Now supports AIGC realistic human materials**
- Asynchronous processing mode, use the returned task ID to [query status](/en/api-manual/task-management/get-task-detail)
- Generated video links are valid for 24 hours, please save them promptly



## OpenAPI

````yaml /en/api-manual/video-series/seedance2.0/seedance-2.0-image-to-video.json POST /v1/videos/generations
openapi: 3.1.0
info:
  title: Seedance 2.0 Image-to-Video API
  description: >-
    Seedance 2.0 image-to-video API, supports first-frame and first-last-frame
    image-to-video generation
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
      summary: Seedance 2.0 Image-to-Video
      description: >-
        - Input 1 image for first-frame video generation, input 2 images for
        first-last-frame video generation, the model determines automatically

        - **Now supports AIGC realistic human materials**

        - Asynchronous processing mode, use the returned task ID to [query
        status](/en/api-manual/task-management/get-task-detail)

        - Generated video links are valid for 24 hours, please save them
        promptly
      operationId: createSeedance20ImageToVideo
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
            examples:
              first_frame:
                summary: First-frame image-to-video
                value:
                  model: seedance-2.0-image-to-video
                  prompt: >-
                    The camera slowly zooms in, the scene gradually comes to
                    life
                  image_urls:
                    - https://example.com/first-frame.jpg
                  duration: 5
                  aspect_ratio: adaptive
              first_last_frame:
                summary: First-last-frame image-to-video
                value:
                  model: seedance-2.0-image-to-video
                  prompt: A smooth transition between two scenes
                  image_urls:
                    - https://example.com/first.jpg
                    - https://example.com/last.jpg
                  duration: 6
                  aspect_ratio: '16:9'
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
                    seedance-2.0-image-to-video
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
        - image_urls
      properties:
        model:
          type: string
          description: Video generation model name
          enum:
            - seedance-2.0-image-to-video
          default: seedance-2.0-image-to-video
          example: seedance-2.0-image-to-video
        prompt:
          type: string
          description: >-
            Text prompt describing the desired video. Supports both Chinese and
            English, recommended no more than 500 characters for Chinese or 1000
            words for English


            **Note:**

            - This model does not support `video_urls` or `audio_urls` input
          example: The camera slowly zooms in, the scene gradually comes to life
        image_urls:
          type: array
          description: >-
            Image URL array, **1–2 images**


            **Image count and behavior:**


            | Image Count | Behavior | Role |

            |:--------:|------|------|

            | 1 image | First-frame image-to-video | Automatically set as
            `first_frame` |

            | 2 images | First-last-frame image-to-video | 1st image →
            `first_frame`, 2nd image → `last_frame` |


            **Image requirements:**

            - Supported formats: `.jpeg`, `.png`, `.webp`

            - Aspect ratio (width/height): `0.4` ~ `2.5`

            - Width/height pixels: `300` ~ `6000` px

            - Max size per image: `30MB`

            - Total request body size must not exceed `64MB`

            - When providing first and last frames, both images can be
            identical. If aspect ratios differ, the first frame takes priority
            and the last frame will be automatically cropped to fit

            - Image URLs must be directly accessible by the server
          items:
            type: string
            format: uri
          minItems: 1
          maxItems: 2
          example:
            - https://example.com/first-frame.jpg
        duration:
          type: integer
          description: |-
            Video duration (seconds), defaults to `5` seconds

            **Details:**
            - Supports any integer value between `4`–`15` seconds
            - Duration directly affects billing
          default: 5
          minimum: 4
          maximum: 15
          example: 5
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

            - `adaptive`: Automatically selects the closest aspect ratio based
            on the first-frame image proportions


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
          example: adaptive
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
          example: seedance-2.0-image-to-video
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