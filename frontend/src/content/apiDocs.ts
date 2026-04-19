type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface ApiExample {
  title: string;
  body: JsonValue;
}

export interface ApiEndpoint {
  id: string;
  category: 'tasks' | 'assets';
  title: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  summary: string;
  auth: string;
  notes: string[];
  requestFields?: ApiField[];
  requestExample?: ApiExample;
  responseFields?: ApiField[];
  responseExample?: ApiExample;
  errorNotes?: string[];
}

export interface ApiDocSection {
  id: string;
  title: string;
  description: string;
}

export const docSections: ApiDocSection[] = [
  {
    id: 'overview',
    title: '对接概览',
    description: '先完成鉴权，再按“素材入库 -> 创建任务 -> 轮询结果 -> 拉取视频”这个顺序接入。',
  },
  {
    id: 'tasks',
    title: '任务接口',
    description: '使用 `/api/v3/contents/generations/tasks` 系列接口创建、查询和删除任务。',
  },
  {
    id: 'assets',
    title: '素材接口',
    description: '素材接口提供标准包裹结构，支持入库、查询、列表以及公共素材库。',
  },
  {
    id: 'integration',
    title: '对接约定',
    description: '这一部分列出和真实代码行为绑定的兼容细节，方便你在业务系统里做状态机和异常处理。',
  },
  {
    id: 'markdown',
    title: 'Markdown 导出',
    description: '页面可以复制或下载 Markdown，也支持 `?format=markdown` 直接查看纯文档模式。',
  },
];

const BASE_URL = '__BASE_URL__';

function withBaseUrl(value: JsonValue, baseUrl: string): JsonValue {
  if (typeof value === 'string') {
    return value.replaceAll(BASE_URL, baseUrl);
  }
  if (Array.isArray(value)) {
    return value.map((item) => withBaseUrl(item, baseUrl));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, withBaseUrl(nested, baseUrl)]),
    );
  }
  return value;
}

export function stringifyExample(body: JsonValue, baseUrl: string): string {
  return JSON.stringify(withBaseUrl(body, baseUrl), null, 2);
}

export const integrationRules: string[] = [
  '所有接口统一使用 `Authorization: Bearer <API_KEY>`。缺少或错误的 Bearer 头会直接返回 401。',
  '任务和素材都按租户归属隔离。你无法查询其他用户创建的 task，也无法引用其他 key 下的素材。',
  '创建任务时可以在 `content[].image_url.url`、`content[].video_url.url`、`content[].audio_url.url` 或 `image_urls` / `video_urls` / `audio_urls` 数组里传 `asset://<ASSET_ID>`。',
  '查询任务存在 3 秒最小轮询间隔限制。同一个 task ID 查询过快会收到 429。',
  '成功任务的 `content.video_url` 统一返回稳定可用的长效访问地址 `/v/{taskId}.mp4`。',
  '访问 `/v/{taskId}.mp4` 时，视频链接提供 HTTP 302 重定向下载，过期后访问将返回 410。',
  '删除任务时，`queued/pending` 会被取消并变为 `cancelled`；`succeeded/failed/expired` 会直接删除本地记录并返回 204；`running` 不支持删除。',
  '创建素材时仅接受公网 `http(s)` URL，素材类型只支持 `Image`、`Video`、`Audio`。',
  '`GetAsset` / `ListAssets` 返回的素材状态为 `Processing`、`Active`、`Failed`。素材完全就绪后会变为 `Active` 状态。',
  '推荐把业务系统里的轮询、回调和异常重试都围绕系统派发的 task id 与 asset id 实现。',
];

export const endpoints: ApiEndpoint[] = [
  {
    id: 'create-task',
    category: 'tasks',
    title: '创建视频生成任务',
    method: 'POST',
    path: '/api/v3/contents/generations/tasks',
    summary: '创建视频任务，返回新建的 task id。',
    auth: 'Bearer API Key',
    notes: [
      '这是推荐的任务创建入口。',
      '`seedance-2.0-fast` 系列请求 `1080p` 会在入站校验阶段被拒绝，返回 400。',
      '若请求体里引用了 `asset://<ASSET_ID>`，系统会自动解析并使用对应素材完成任务。',
      '响应中的 `id` 格式类似 `cgt-20260420123045-ab12c`。',
    ],
    requestFields: [
      { name: 'model', type: 'string', required: true, description: '模型 ID。' },
      { name: 'content', type: 'array<object>', required: true, description: '多模态输入。可混合 text、image_url、video_url、audio_url。' },
      { name: 'resolution / quality', type: 'string', description: '输出分辨率，例如 `720p`、`1080p`。Fast 模型不支持 `1080p`。' },
      { name: 'duration', type: 'number', description: '视频时长，秒。' },
      { name: 'return_last_frame', type: 'boolean', description: '为 `true` 时，结果查询会返回尾帧。' },
      { name: 'image_urls / video_urls / audio_urls', type: 'array<string>', description: '兼容数组式素材输入，同样支持 `asset://<ASSET_ID>`。' },
    ],
    requestExample: {
      title: '请求示例',
      body: {
        model: 'doubao-seedance-2-0-pro-250528',
        content: [
          {
            type: 'text',
            text: '一只柴犬在海边追逐浪花，电影感，慢动作。',
          },
          {
            type: 'image_url',
            role: 'first_frame',
            image_url: {
              url: 'asset://asset-20260420153045-ab12c',
            },
          },
        ],
        resolution: '720p',
        duration: 5,
        return_last_frame: true,
      },
    },
    responseFields: [
      { name: 'id', type: 'string', description: '任务全局唯一的 id。' },
      { name: 'status', type: 'string', description: '初始通常为 `queued`。终态可能为 `succeeded`、`failed`、`cancelled`、`expired`。' },
      { name: 'created_at', type: 'number', description: 'Unix 秒时间戳。' },
      { name: 'usage.rate_cny_per_million', type: 'number', description: '统一换算后的费率，便于你按 token 预估成本。' },
    ],
    responseExample: {
      title: '响应示例',
      body: {
        id: 'cgt-20260420153045-ab12c',
        model: 'doubao-seedance-2-0-pro-250528',
        status: 'queued',
        created_at: 1776679845,
        updated_at: 1776679845,
        usage: {
          rate_cny_per_million: 32,
        },
      },
    },
    errorNotes: [
      '401: 缺少或非法 Bearer Token。',
      '403: 账户停用、余额不足、Key 配额耗尽等。',
      '429: 用户级或 Key 级并发已满。',
      '400: 请求参数非法，例如 fast 模型请求 `1080p`。',
    ],
  },
  {
    id: 'get-task',
    category: 'tasks',
    title: '查询任务状态',
    method: 'GET',
    path: '/api/v3/contents/generations/tasks/:id',
    summary: '轮询任务状态，成功后返回可访问的视频地址。',
    auth: 'Bearer API Key',
    notes: [
      '每个 task id 至少间隔 3 秒再轮询一次。',
      '成功态时，`content.video_url` 会统一处理为稳定的可下载地址 `/v/{taskId}.mp4`。',
      '若查询到的是他人任务，会返回 404，而不是 403。',
      '请使用接口响应的 task id 进行轮询。',
    ],
    responseFields: [
      { name: 'id', type: 'string', description: '任务的 task id。' },
      { name: 'status', type: 'string', description: '`queued`、`running`、`succeeded`、`failed`、`cancelled`、`expired`。' },
      { name: 'error', type: 'object | null', description: '失败时返回错误码和信息。' },
      { name: 'content.video_url', type: 'string', description: '成功时为 `${BASE_URL}/v/{taskId}.mp4`。' },
      { name: 'content.last_frame_url', type: 'string', description: '创建任务时要求返回尾帧才会出现。' },
      { name: 'usage.completion_tokens', type: 'number', description: '统一口径的 token 用量。' },
      { name: 'usage.rate_cny_per_million', type: 'number', description: '统一费率字段。' },
    ],
    responseExample: {
      title: '成功响应示例',
      body: {
        id: 'cgt-20260420153045-ab12c',
        model: 'doubao-seedance-2-0-pro-250528',
        status: 'succeeded',
        created_at: 1776679845,
        updated_at: 1776679868,
        content: {
          video_url: `${BASE_URL}/v/cgt-20260420153045-ab12c.mp4`,
          last_frame_url: 'https://example-cdn.local/frames/cgt-20260420153045-ab12c.png',
        },
        duration: 5,
        resolution: '720p',
        ratio: '16:9',
        usage: {
          completion_tokens: 156000,
          total_tokens: 156000,
          rate_cny_per_million: 32,
        },
      },
    },
    errorNotes: [
      '404: task 不存在，或者不属于当前用户。',
      '429: 同一个 task 查询太频繁，未满足 3 秒间隔。',
    ],
  },
  {
    id: 'delete-task',
    category: 'tasks',
    title: '取消或删除任务',
    method: 'DELETE',
    path: '/api/v3/contents/generations/tasks/:id',
    summary: '对排队任务执行取消；对终态任务执行删除记录。',
    auth: 'Bearer API Key',
    notes: [
      '`pending/queued` 删除后会变为 `cancelled`，返回 204。',
      '`succeeded`、`failed`、`expired` 删除后会直接移除本地记录，返回 204。',
      '`running` 不支持删除；已 `cancelled` 的任务再次删除会返回 409。',
    ],
    responseFields: [
      { name: 'HTTP Status', type: '204 No Content', description: '成功时无响应体。' },
    ],
    responseExample: {
      title: '成功响应',
      body: {},
    },
    errorNotes: [
      '404: task 不存在。',
      '403: task 不属于当前账号。',
      '409: 任务已经是 cancelled。',
    ],
  },
  {
    id: 'video-redirect',
    category: 'tasks',
    title: '获取最终视频文件',
    method: 'GET',
    path: '/v/:taskId.mp4',
    summary: '公开视频访问入口，不需要携带 Authorization，返回 302 或 410。',
    auth: '无需鉴权',
    notes: [
      '这是成功任务查询结果里 `content.video_url` 的真实访问地址。',
      '请求后将自动重定向(302)到实际可下载的视频文件地址。',
      '如果任务不存在或尚未成功，返回 404；如果视频文件已经过期，返回 410。',
    ],
    responseFields: [
      { name: '302 Location', type: 'string', description: '重定向到实际可下载的 mp4 地址。' },
      { name: '410', type: 'json', description: '视频已过期时返回 `{ error: "video_expired", task_id, expired_at }`。' },
    ],
    responseExample: {
      title: '过期响应示例',
      body: {
        error: 'video_expired',
        message: 'Video link expired. Task URLs are valid for a limited time after task completion.',
        task_id: 'cgt-20260420153045-ab12c',
        expired_at: '2026-04-21T07:31:08.000Z',
      },
    },
  },
  {
    id: 'create-asset',
    category: 'assets',
    title: '创建素材',
    method: 'POST',
    path: '/api/v1/open/CreateAsset',
    summary: '把公网素材拉入对应 key 的素材库，进行准备供后续任务使用。',
    auth: 'Bearer API Key',
    notes: [
      '请求体和响应体会使用标准的 `ResponseMetadata + Result` 封包格式。',
      '`URL` 必须是公网 `http(s)` 地址。',
      '当前素材隔离维度是 key，同一个用户不同 key 之间不会共享素材列表。',
    ],
    requestFields: [
      { name: 'URL', type: 'string', required: true, description: '公网素材地址。' },
      { name: 'Name', type: 'string', description: '素材名称，最长 64 个字符。' },
      { name: 'AssetType', type: 'string', required: true, description: '`Image`、`Video`、`Audio` 三选一。' },
    ],
    requestExample: {
      title: '请求示例',
      body: {
        URL: 'https://static.example.com/materials/cover.png',
        Name: 'campaign-cover',
        AssetType: 'Image',
      },
    },
    responseFields: [
      { name: 'ResponseMetadata.RequestId', type: 'string', description: '请求追踪 ID。' },
      { name: 'Result.Id', type: 'string', description: '生成的素材 ID，格式类似 `asset-20260420153122-ab12c`。' },
    ],
    responseExample: {
      title: '响应示例',
      body: {
        ResponseMetadata: {
          RequestId: '202604201531225A8718F8162E58C54A8A',
          Action: 'CreateAsset',
          Version: '2024-01-01',
          Service: 'ark',
          Region: 'cn-beijing',
        },
        Result: {
          Id: 'asset-20260420153122-ab12c',
        },
      },
    },
    errorNotes: [
      '400: URL 非公网地址、JSON 非法、AssetType 非法。',
      '500: 系统处理流程异常。',
    ],
  },
  {
    id: 'get-asset',
    category: 'assets',
    title: '查询单个素材',
    method: 'POST',
    path: '/api/v1/open/GetAsset',
    summary: '按素材 ID 查询当前 key 下的素材详情。',
    auth: 'Bearer API Key',
    notes: [
      '只会返回当前 key 所拥有的素材。',
      '当素材还在处理时，`Result.URL` 可能为空字符串。',
      '素材下载和安全流程通过后即会显示为 `Active` 状态。',
    ],
    requestFields: [
      { name: 'Id', type: 'string', required: true, description: '素材 ID。' },
    ],
    requestExample: {
      title: '请求示例',
      body: {
        Id: 'asset-20260420153122-ab12c',
      },
    },
    responseFields: [
      { name: 'Result.Id', type: 'string', description: '素材 ID。' },
      { name: 'Result.URL', type: 'string', description: '素材可访问 URL。处理中时可能为空。' },
      { name: 'Result.AssetType', type: 'string', description: '`Image`、`Video`、`Audio`。' },
      { name: 'Result.Status', type: 'string', description: '`Processing`、`Active`、`Failed`。' },
      { name: 'Result.Error', type: 'object', description: '失败时附带处理失败原因。' },
      { name: 'Result.CreateTime / UpdateTime', type: 'string', description: 'ISO-8601 时间。' },
    ],
    responseExample: {
      title: '响应示例',
      body: {
        ResponseMetadata: {
          RequestId: '202604201532019B017F7B93908CBB3D9C',
          Action: 'GetAsset',
          Version: '2024-01-01',
          Service: 'ark',
          Region: 'cn-beijing',
        },
        Result: {
          Id: 'asset-20260420153122-ab12c',
          Name: 'campaign-cover',
          URL: 'https://storage.example.com/materials/asset-20260420153122-ab12c.png',
          AssetType: 'Image',
          GroupId: '',
          Status: 'Active',
          CreateTime: '2026-04-20T15:31:22Z',
          UpdateTime: '2026-04-20T15:31:41Z',
          ProjectName: '',
        },
      },
    },
    errorNotes: [
      '404: 当前 key 下不存在该素材时返回 `AssetNotFound`。',
    ],
  },
  {
    id: 'list-assets',
    category: 'assets',
    title: '分页查询素材列表',
    method: 'POST',
    path: '/api/v1/open/ListAssets',
    summary: '按名称、状态、分页和排序条件拉取当前 key 的素材库。',
    auth: 'Bearer API Key',
    notes: [
      '`PageSize` 实际会被限制在 1 到 100 之间。',
      '`Filter.Statuses` 支持 `Processing`、`Active`、`Failed`。',
      '`SortBy` 支持 `CreateTime`、`UpdateTime`、`GroupId`。',
    ],
    requestFields: [
      { name: 'Filter.GroupType', type: 'string', description: '预留字段，可不传。' },
      { name: 'Filter.Statuses', type: 'array<string>', description: '按素材状态过滤。' },
      { name: 'Filter.Name', type: 'string', description: '按名称模糊搜索。' },
      { name: 'PageNumber', type: 'number', description: '页码，从 1 开始。' },
      { name: 'PageSize', type: 'number', description: '每页条数，最大 100。' },
      { name: 'SortBy', type: 'string', description: '`CreateTime`、`UpdateTime`、`GroupId`。' },
      { name: 'SortOrder', type: 'string', description: '`Asc` 或 `Desc`。' },
    ],
    requestExample: {
      title: '请求示例',
      body: {
        Filter: {
          Statuses: ['Active'],
          Name: 'campaign',
        },
        PageNumber: 1,
        PageSize: 20,
        SortBy: 'UpdateTime',
        SortOrder: 'Desc',
      },
    },
    responseFields: [
      { name: 'Result.Items', type: 'array<object>', description: '素材详情列表，元素结构与 `GetAsset.Result` 基本一致。' },
      { name: 'Result.TotalCount', type: 'number', description: '总条数。' },
      { name: 'Result.PageNumber', type: 'number', description: '当前页码。' },
      { name: 'Result.PageSize', type: 'number', description: '实际页大小。' },
    ],
    responseExample: {
      title: '响应示例',
      body: {
        ResponseMetadata: {
          RequestId: '2026042015331180E2CC8330F53C7FB6FB',
          Action: 'ListAssets',
          Version: '2024-01-01',
          Service: 'ark',
          Region: 'cn-beijing',
        },
        Result: {
          Items: [
            {
              Id: 'asset-20260420153122-ab12c',
              Name: 'campaign-cover',
              URL: 'https://storage.example.com/materials/asset-20260420153122-ab12c.png',
              AssetType: 'Image',
              GroupId: '',
              Status: 'Active',
              CreateTime: '2026-04-20T15:31:22Z',
              UpdateTime: '2026-04-20T15:31:41Z',
              ProjectName: '',
            },
          ],
          TotalCount: 1,
          PageNumber: 1,
          PageSize: 20,
        },
      },
    },
  },
  {
    id: 'list-media-asset-group',
    category: 'assets',
    title: '查询公共素材/虚拟人像库',
    method: 'POST',
    path: '/api/v1/open/ListMediaAssetGroup',
    summary: '查询系统提供的公共预置材料目录，如内置虚拟人像等。',
    auth: 'Bearer API Key',
    notes: [
      '这个接口直接返回系统级别的公共目录。',
      '由于它是公共内容不是租户私有数据，所以不受不同 key 级素材隔离限制。',
      '建议把这个接口作为“查询系统公共资源库”，而把 `CreateAsset` / `GetAsset` 多用于“管理自身素材”。',
    ],
    requestExample: {
      title: '请求示例',
      body: {
        PageNumber: 1,
        PageSize: 20,
      },
    },
    responseFields: [
      { name: 'Response Body', type: 'object', description: '返回对应的公共资源目录节点数据。' },
    ],
    responseExample: {
      title: '说明',
      body: {
        note: '该接口返回平台的预定义目录，真实字段会因公共资源的增减而变化。建议使用直接拉取的一份返回值做 schema 结构开发使用。',
      },
    },
  },
];

function renderFieldLines(fields: ApiField[]): string[] {
  return fields.map((field) => {
    const required = field.required ? '必填' : '可选';
    return `- \`${field.name}\` \`${field.type}\` ${required}: ${field.description}`;
  });
}

function renderEndpointMarkdown(endpoint: ApiEndpoint, baseUrl: string): string[] {
  const lines: string[] = [];
  lines.push(`### ${endpoint.title}`);
  lines.push('');
  lines.push(`- 方法: \`${endpoint.method}\``);
  lines.push(`- 路径: \`${endpoint.path}\``);
  lines.push(`- 完整示例: \`${baseUrl}${endpoint.path.replace(':id', '{id}').replace(':taskId', '{taskId}')}\``);
  lines.push(`- 鉴权: ${endpoint.auth}`);
  lines.push(`- 说明: ${endpoint.summary}`);
  lines.push('');

  if (endpoint.notes.length > 0) {
    lines.push('注意事项:');
    lines.push(...endpoint.notes.map((note) => `- ${note}`));
    lines.push('');
  }

  if (endpoint.requestFields && endpoint.requestFields.length > 0) {
    lines.push('请求字段:');
    lines.push(...renderFieldLines(endpoint.requestFields));
    lines.push('');
  }

  if (endpoint.requestExample) {
    lines.push(`请求示例: ${endpoint.requestExample.title}`);
    lines.push('```json');
    lines.push(stringifyExample(endpoint.requestExample.body, baseUrl));
    lines.push('```');
    lines.push('');
  }

  if (endpoint.responseFields && endpoint.responseFields.length > 0) {
    lines.push('响应字段:');
    lines.push(...renderFieldLines(endpoint.responseFields));
    lines.push('');
  }

  if (endpoint.responseExample) {
    lines.push(`响应示例: ${endpoint.responseExample.title}`);
    lines.push('```json');
    lines.push(stringifyExample(endpoint.responseExample.body, baseUrl));
    lines.push('```');
    lines.push('');
  }

  if (endpoint.errorNotes && endpoint.errorNotes.length > 0) {
    lines.push('常见错误:');
    lines.push(...endpoint.errorNotes.map((note) => `- ${note}`));
    lines.push('');
  }

  return lines;
}

export function generateApiDocsMarkdown(baseUrl: string): string {
  const lines: string[] = [];
  lines.push('# SD2 Proxy API 对接文档');
  lines.push('');
  lines.push('这份文档覆盖任务相关接口和素材相关接口，适合直接给开发同学或 Agent 读取。');
  lines.push('');
  lines.push('## 基础信息');
  lines.push('');
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push('- 鉴权方式: `Authorization: Bearer <API_KEY>`');
  lines.push('- 推荐接入顺序: `CreateAsset -> Create Task -> Get Task -> /v/{taskId}.mp4`');
  lines.push('- 推荐路由: 统一使用 `/api/v3/contents/generations/tasks` 系列接口。');
  lines.push('');
  lines.push('## 对接约定');
  lines.push('');
  lines.push(...integrationRules.map((rule) => `- ${rule}`));
  lines.push('');
  lines.push('## 任务接口');
  lines.push('');
  endpoints.filter((endpoint) => endpoint.category === 'tasks').forEach((endpoint) => {
    lines.push(...renderEndpointMarkdown(endpoint, baseUrl));
  });
  lines.push('## 素材接口');
  lines.push('');
  endpoints.filter((endpoint) => endpoint.category === 'assets').forEach((endpoint) => {
    lines.push(...renderEndpointMarkdown(endpoint, baseUrl));
  });
  lines.push('## 典型对接流程');
  lines.push('');
  lines.push('1. 调用 `POST /api/v1/open/CreateAsset` 导入你自己的图片、视频或音频。');
  lines.push('2. 轮询 `POST /api/v1/open/GetAsset` 或 `POST /api/v1/open/ListAssets`，等素材进入 `Active`。');
  lines.push('3. 创建任务时在请求体里使用 `asset://<ASSET_ID>` 引用素材。');
  lines.push('4. 轮询 `GET /api/v3/contents/generations/tasks/:id`，等待 `status = succeeded`。');
  lines.push('5. 用响应里的 `content.video_url` 或直接访问 `/v/{taskId}.mp4` 获取最终视频。');
  lines.push('');
  lines.push('## 备注');
  lines.push('');
  lines.push('- 该文档包含从外部可访问的标准 API 接口及约定。');
  lines.push('');
  return lines.join('\n');
}
