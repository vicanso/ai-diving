# ai-diving

把 Docker 镜像分析 + LLM 优化建议串成自动化流水线：每次镜像 push，自动产出"哪里劣化了、Dockerfile 该怎么改"的中文报告。

> 💡 **想直接试试？** 打开 [ai-diving.npmtrend.com](https://ai-diving.npmtrend.com/) 提交一个公开镜像，几分钟后查询结果（共享配额、共享 token，仅用于演示）。

## 特性

- 🔌 **零侵入接入** —— 在 Docker Hub 仓库的 Webhooks 里贴一个 URL 就开工，不用改 CI、不用装 SDK。
- 🤖 **AI 增量分析** —— 每次只关心"比上次劣化在哪"，不重复唠叨已经稳定的部分。
- 📬 **多渠道通知** —— 企业微信机器人 / Resend 邮件，二选一或都开；可在 webhook URL 里覆盖全局默认。
- 🦀 **不依赖 docker daemon** —— [diving-rs](https://github.com/vicanso/diving-rs) 直接拉 registry 的 manifest / layer，纯 CI 环境也能跑。
- 🔄 **结论一致自动短路** —— LLM 自报"与上次分析结论一致"时不再重复推送，多次重建相同镜像不会刷屏。
- 🎛️ **OpenAI / Anthropic 双协议** —— 可对接小米、OpenRouter、Ollama、自托管 vLLM 等任何兼容方。
- 💰 **自带计费账本** —— 基于 token_prices / token_accounts 的积分体系，可按 user 配额多租户使用。
- 🖥️ **配套前端** —— 公开提交页 + 管理后台，提交、查询、查看 markdown 报告一条龙。

## 缘起

最早是在了解到 [wagoodman/dive](https://github.com/wagoodman/dive) 之后，开始用它来逐层挖自己镜像的各种优化点 —— 哪些层多塞了一份编译产物、哪些层引入了 `.git`、哪些 `RUN` 没清干净缓存。整个分层视图很直观，但有两个地方不够顺手：

1. `dive` 依赖本地 docker daemon 才能解析镜像，跑在 CI / webhook 流水线里不方便；
2. 每次镜像更新都要人手再看一遍报告、判断"这次比上次胖了多少 / 是不是真劣化"，频次一高就懒得跟。

为了解决第一点，把 dive 的核心分析能力用 Rust 重写成了 [vicanso/diving-rs](https://github.com/vicanso/diving-rs)：直接拉 registry 的 manifest 和 layer，不再依赖 docker client，并以 HTTP 服务暴露分析能力，方便通过 webhook 的形式触发镜像分析。

为了解决第二点，刚好赶上小米开放百万亿 token 的免费额度，于是把"人盯报告"换成了"AI 盯报告"：每次新镜像分析完，让 LLM 拿这次的诊断数据 + 上一次的成功结论做对比，按"异常驱动 + 防劣化"的规则输出该不该改、改哪。

## 报告长什么样

LLM 系统提示词强制要求"无异常 → 一行健康通过；有异常 → 只说真问题 + 改哪几行"。典型产出（示例数据）：

> ### 🚨 核心异常与劣化痛点
> - 镜像体积从 `v1.2.0` 的 87.3 MB 增至 `v1.3.0` 的 142.1 MB（**+54.8 MB**），劣化集中在 Layer 7：
>   - `target/release/build/` 编译中间产物 41.2 MB 未清理
>   - `.git/` 目录 8.6 MB 被 `COPY .` 一并塞入
> - 新版本 `USER` 指令缺失，回退到默认 root 运行（旧版本明确 `USER nonroot:nonroot`）
>
> ### 🛠️ 必须执行的修复代码
> ```dockerfile
> # 在 Layer 7 的 cargo build 之后立即清理中间产物
> RUN cargo build --release \
>     && cp target/release/myapp /app/myapp \
>     && rm -rf target/
>
> # 增加 .dockerignore，避免 .git 被 COPY .
> # ↳ 在仓库根目录新建 .dockerignore：
> # .git
> # target
> # node_modules
>
> # 恢复非 root 运行
> USER nonroot:nonroot
> ```

镜像稳定后，下一次构建结果一致，LLM 直接回复 `与上次分析结论一致`，本次就**不再发通知**。

## 工作流程

```
Docker Hub webhook
       │
       ▼
ai-diving (本仓库)
       │  POST /api/docker/analyze     ← 鉴权 + 入队
       ▼
docker_analyses 表 (status = WAITING)
       │
       ▼
后台 cron (每分钟一次) 抢占 WAITING 任务
       │  GET {diving.url}/api/analyze
       ▼
diving-rs 返回的 markdown 诊断报告
       │  + 同 repo:tag 上一次成功的 llm_result
       ▼
LLM (Anthropic / OpenAI 协议，可配)
       │  按 "异常驱动 + 防劣化" 系统提示词
       ▼
优化建议 markdown
       │
       ├─ 写回 docker_analyses.result
       └─ notify: WeCom 机器人 / Resend 邮件
```

### 几个设计要点

- **入队即 dedupe**：相同 `(user_id, repo_name, tag)` 已有 WAITING / PROCESSING 记录时，重复 webhook 不会创建新任务，直接复用。
- **多实例可并跑**：cron worker 抢占任务用 `UPDATE … WHERE status = WAITING RETURNING …` 原子语句，多个 ai-diving 实例同时部署也不会重复跑同一镜像。
- **结论一致自动短路**：LLM 提示词约定，本次诊断和上次结论一致就回 `与上次分析结论一致`，后端识别后复用上次 `llm_result` 且不发通知。要强制推送可在 URL 加 `notify_force=true`。
- **计费容错**：找不到模型对应的 `token_prices` 配置时只 log 不扣费、不阻断分析（避免新加模型时分析任务全 fail）。

## docker hub webhook

在 Docker Hub 仓库 → Webhooks 里直接填以下 URL 即可（邮箱填真实可收件地址）：

- `token`：API 鉴权 token（在 `token_keys` 表里），决定扣谁的积分账户
- `notify_type`：`email` / `wecom`
- `notify_data`：邮箱地址 / 企业微信机器人 key
- `notify_force`：`true` 时即便分析结论与上次一致也仍然推送

```
https://ai-diving.npmtrend.com/api/docker/analyze?token=bae95b6d-ed59-4516-b43d-ad39e493957f&notify_type=email&notify_data=你的邮箱&notify_force=true
```

也可以直接在 [Web 控制台](https://ai-diving.npmtrend.com/) 提交镜像并按 `repo_name` 查询历史分析。

## curl test

模拟 Docker Hub 的 webhook payload：

```bash
curl -v -XPOST -d '{
  "push_data": {
    "tag": "latest"
  },
  "repository": {
    "repo_name": "vicanso/static"
  }
}' -H 'Content-Type: application/json' 'https://ai-diving.npmtrend.com/api/docker/analyze?token=bae95b6d-ed59-4516-b43d-ad39e493957f&notify_type=email&notify_data=你的邮箱&notify_force=true'
```

## 自托管部署

### 1. 启动 Postgres

```bash
docker pull postgres:18-alpine

docker run -d --restart=always \
  -v /opt/ai-diving/postgres:/var/lib/postgresql \
  -e POSTGRES_PASSWORD=A123456 \
  -p 5432:5432 \
  --name=ai-diving-postgres \
  postgres:18-alpine

docker exec -it ai-diving-postgres sh

psql -c "CREATE DATABASE aidiving;" -U postgres
psql -c "CREATE USER vicanso WITH PASSWORD 'A123456';" -U postgres
psql -c "GRANT ALL PRIVILEGES ON DATABASE aidiving to vicanso;" -U postgres
psql -c "GRANT ALL ON DATABASE aidiving TO vicanso;" -U postgres
psql -c "ALTER DATABASE aidiving OWNER TO vicanso;" -U postgres
```

### 2. 应用 schema

```bash
cd sql/pg
PGPASSWORD=A123456 psql -h 127.0.0.1 -U vicanso -d aidiving -f init.sql
```

> `init.sql` 用 `\i` 包含其它 SQL，路径相对当前工作目录解析，所以一定要先 `cd sql/pg` 再运行。

### 3. 启动 Redis 与 diving-rs

```bash
# Redis
docker run -d --restart=always -p 6379:6379 --name=ai-diving-redis redis:7-alpine

# diving-rs（参考其 README 配置 docker hub 凭据，避免匿名拉取限流）
docker run -d --restart=always -p 7002:7002 --name=diving-rs vicanso/diving-rs
```

### 4. 启动 ai-diving

```bash
docker run -d --restart=always \
  -p 5010:5000 \
  -e RUST_ENV=production \
  -e AIDIVING__REDIS__URI=redis://172.18.230.75:6379 \
  -e AIDIVING__DATABASE__URI=postgres://vicanso:***@172.18.230.75:5432/aidiving \
  -e AIDIVING__SESSION__SECRET=*** \
  -e AIDIVING__DIVING__URL=http://172.18.230.75:7002 \
  --name=ai-diving \
  vicanso/ai-diving
```

### 5. 初始化最小可用数据

至少需要 1 个 user、1 个 token_key、1 个 token_account、1 个 token_llm，可选 1 个 token_price 才能扣费：

```sql
-- 用 admin 后台注册一个用户后，记下 user_id（也可以从 users 表里查）
-- 假设 user_id = 1

-- 给 user_id=1 一个 API token（webhook URL 里 ?token= 用）
INSERT INTO token_keys (user_id, token, name)
VALUES (1, gen_random_uuid()::text, 'webhook-default');

-- 创建积分账户并充值（注册时 on_register 钩子会送 1_000_000，也可手动）
INSERT INTO token_accounts (user_id, balance, total_recharged)
VALUES (1, 1000000, 1000000);

-- 配置默认 LLM（必须 name='default'，源码里硬编码）
INSERT INTO token_llms (name, provider, model, api_key, url)
VALUES (
  'default',
  'openai',                                       -- 或 'anthropic'
  'qwen-max',                                     -- 你打算用的模型名
  'sk-xxxxxxxxxxxxxxxxxx',                        -- LLM API key
  'https://dashscope.aliyuncs.com/compatible-mode/v1'
);

-- 配置该模型的扣费价格（可选，找不到时只记 log 不扣费、不阻断）
-- 单位：每 unit_size (默认 1000) 个 token 扣的积分数
INSERT INTO token_prices (service, model, input_price, output_price, unit_size)
VALUES ('llm', 'qwen-max', 5, 20, 1000);  -- 输入 5 积分/1K，输出 20 积分/1K
```

### 配置项参考

通过环境变量覆盖（双下划线为段分隔符，如 `AIDIVING__SESSION__SECRET`）；也可改 `configs/{dev,production}.toml` 后重新编译。

| Section | Key | 必填 | 说明 |
| --- | --- | :-: | --- |
| `[basic]` | `listen` | ✅ | 监听地址，如 `0.0.0.0:5000` |
| `[basic]` | `timeout` | | 单请求超时（默认 60s）；超大镜像建议拉到 300s |
| `[basic]` | `processing_limit` | | 并发上限（默认 1000） |
| `[basic]` | `secret` | ✅ | 应用 secret |
| `[basic]` | `prefix` | | API 路径前缀，如 `/api` |
| `[session]` | `ttl` | ✅ | session 有效期（60s ~ 30d） |
| `[session]` | `secret` | ✅ | cookie 签名 secret，**至少 64 字符** |
| `[session]` | `cookie` | ✅ | cookie 名 |
| `[database]` | `uri` | ✅ | Postgres 连接串 |
| `[redis]` | `uri` | ✅ | Redis 连接串 |
| `[diving]` | `url` | ✅ | diving-rs 服务 URL |
| `[diving]` | `notify_wecom` | | 全局默认 WeCom 机器人 key |
| `[diving]` | `notify_email` | | 全局默认收件邮箱 |
| `[diving]` | `email_from` | | Resend 发件人地址 |
| `[diving]` | `resend_api_key` | | Resend API key |
| `[opendal]` | `url` | ✅ | 文件存储后端，默认 `file://~/Downloads`，也可配 S3/OSS |

## 已知限制

- **Docker Hub 匿名拉取限流**：每 IP 每 6 小时 100 次 manifest，触顶后 registry 会回 401 `UNAUTHORIZED` —— 这是 docker hub 的"伪认证错误"，并不是真的需要登录。频繁触发时给 diving-rs 容器挂 `~/.docker/config.json` 加一个 free 账号登录态（每 6h 200 次），或换走加速器。
- **超大镜像**：>10 GB 的 layer 解析慢，默认 60s 请求超时可能不够，可把 `[basic].timeout` 调到 300s+；同时 `diving_result` 太大会撞 LLM context 限制，建议挑容易劣化的镜像接入即可。
- **LLM 上下文**：`diving_result` + 上次 `llm_result` 一起塞给 LLM，目标是 32K~128K context；选模型时注意。
- **当前查询接口无鉴权**：`GET /docker/analyses?repo_name=...` 是公开的，任何人能查任何 repo 的最近 20 条历史记录。当前阶段刻意如此（demo 共享 token），如果生产部署需要按用户隔离，需要把 token 鉴权加回去 —— 路径在 `src/docker.rs::list`。

## 相关项目

- [vicanso/diving-rs](https://github.com/vicanso/diving-rs) —— 本项目依赖的 Rust 镜像分析后端，从 dive 重写而来
- [wagoodman/dive](https://github.com/wagoodman/dive) —— 灵感来源，分层 TUI 看镜像内部

## License

Apache-2.0
