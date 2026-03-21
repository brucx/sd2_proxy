# API Proxy for Seedance 2.0 视频生成模型

这是一个基于 Node.js 和 React 构建的 API 中转站项目，专门用于转发 Seedance 2.0 & 2.0 fast API 请求。项目实现了多租户管理、子 Key 分配、限流控制、后付费计费逻辑以及一个可视化的 API 调试面板（Playground）。

## 功能特性 (Features)

*   **API 接口转发**: 代理 `/api/v1/doubao/create` 和 `/api/v1/doubao/get_result` 接口。
*   **多租户架构**: 支持 Admin（管理员）和 Tenant（租户）两种角色。管理员可以创建租户，租户可以管理自己的多个子 API Key。
*   **安全认证**: 租户在调用 API 时通过 `Authorization: Bearer <子 Key>` 进行鉴权，系统会在后端将其替换为统一的真实主 Key。
*   **内存级限流 (Rate Limiting)**: 每个子 Key 默认限制每分钟最多 60 次请求（60 RPM），防止滥用。
*   **后付费计费系统**:
    *   在租户调用 `/create` 接口时记录 `task_id`。
    *   当租户主动调用 `/get_result` 查询成功或失败状态时，系统会拦截响应并提取 `usage.completion_tokens` 以更新计费信息。
    *   内置后台定时任务（Cron Job），每 5 分钟自动轮询长时间未更新的 `pending` 任务，防止恶意用户不查询结果逃避计费。
*   **统计面板 (Dashboard)**:
    *   Admin 面板：查看全局的租户用量统计和管理所有用户。
    *   Tenant 面板：生成新的 API Key 并查看当前 Key 的使用详情和消耗 Tokens 数。
*   **API Playground**: 租户可以直接在界面上填入自己的子 Key 和 Prompt 来测试生成视频任务并轮询状态。

## 技术栈 (Tech Stack)

*   **后端**: Node.js, [Hono](https://hono.dev/) (快速轻量级 Web 框架), [Drizzle ORM](https://orm.drizzle.team/), `postgres.js`
*   **前端**: [React](https://react.dev/), [Vite](https://vitejs.dev/), [TailwindCSS](https://tailwindcss.com/)
*   **数据库**: PostgreSQL
*   **部署架构**: Monorepo 结构，后端采用 `@hono/node-server` 提供 API 接口的同时，使用 `serveStatic` 静态托管打包后的 React 前端页面（合并部署）。

## 本地运行指南 (Getting Started)

### 1. 环境依赖

*   [Node.js](https://nodejs.org/) (推荐 v20 以上)
*   [PostgreSQL](https://www.postgresql.org/) (本地或云端数据库均可)

### 2. 初始化项目

首先克隆本项目，然后在根目录执行以下命令安装依赖：

```bash
# 在前端和后端目录下安装所有依赖
npm install --prefix frontend && npm install --prefix backend
```

### 3. 环境变量配置

在 `backend/` 目录下创建一个 `.env` 文件，并填入以下配置：

```env
# 你的主账号真实 ARK API Key
ARK_API_KEY="your-real-ark-api-key"

# 上游接口服务器地址
UPSTREAM_URL="http://118.196.64.1"

# 数据库连接字符串
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/apiproxy"

# JWT 签发密钥
JWT_SECRET="your_jwt_secret_key"
```

### 4. 数据库迁移

使用 Drizzle-Kit 将建表语句推送到 PostgreSQL 数据库中：

```bash
npm run db:push
```

### 5. 编译与运行

在项目根目录下运行以下命令，该命令会先编译 React 前端，然后编译并启动 Node.js 后端：

```bash
npm run build
npm start
```

启动成功后，访问 `http://localhost:3000` 即可看到登录面板。

*   **默认管理员账号**:
    *   **用户名**: `admin`
    *   **密码**: `admin123`

## 项目目录结构

```text
├── package.json        # 根目录执行脚本
├── backend/            # Hono 后端代码
│   ├── src/
│   │   ├── index.ts    # 核心服务、API 路由、中转逻辑和 Cron Job
│   │   └── db/
│   │       ├── index.ts  # 数据库连接配置
│   │       └── schema.ts # Drizzle 数据表定义 (users, keys, usageLogs)
│   ├── package.json
│   └── drizzle.config.ts # Drizzle 配置
└── frontend/           # React 前端代码
    ├── src/
    │   ├── pages/
    │   │   ├── Login.tsx       # 登录页
    │   │   ├── Dashboard.tsx   # 统计面板
    │   │   └── Playground.tsx  # API 测试场
    │   ├── App.tsx             # 路由配置
    │   └── main.tsx            # React 入口
    ├── vite.config.ts          # Vite 打包配置
    └── package.json
```

## API 使用说明 (For Tenants)

租户在面板中获取到属于自己的 `sk-...` 格式的 API Key 后，可以像直接调用官方 API 一样使用本中转站（替换域名和鉴权头即可）：

**1. 创建任务 (`/api/v1/doubao/create`)**

```bash
curl -X POST http://<YOUR_DOMAIN>:3000/api/v1/doubao/create \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <你的子_API_KEY>" \
-d '{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "微距镜头对准叶片上翠绿的玻璃蛙。"
    }
  ],
  "generate_audio": true,
  "ratio": "16:9",
  "duration": 5
}'
```

**2. 查询结果 (`/api/v1/doubao/get_result`)**

```bash
curl -X POST http://<YOUR_DOMAIN>:3000/api/v1/doubao/get_result \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <你的子_API_KEY>" \
-d '{"id": "<创建任务返回的ID>"}'
```
