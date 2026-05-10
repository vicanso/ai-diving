# ai-diving

把 Docker 镜像分析 + LLM 优化建议串成自动化流水线：每次镜像 push，自动产出"哪里劣化了、Dockerfile 该怎么改"的中文报告。

## 缘起

最早是在了解到 [wagoodman/dive](https://github.com/wagoodman/dive) 之后，开始用它来逐层挖自己镜像的各种优化点 —— 哪些层多塞了一份编译产物、哪些层引入了 `.git`、哪些 `RUN` 没清干净缓存。整个分层视图很直观，但有两个地方不够顺手：

1. `dive` 依赖本地 docker daemon 才能解析镜像，跑在 CI / webhook 流水线里不方便；
2. 每次镜像更新都要人手再看一遍报告、判断"这次比上次胖了多少 / 是不是真劣化"，频次一高就懒得跟。

为了解决第一点，把 dive 的核心分析能力用 Rust 重写成了 [vicanso/diving-rs](https://github.com/vicanso/diving-rs)：直接拉 registry 的 manifest 和 layer，不再依赖 docker client，并把结果以 markdown 形式落库，方便接到 webhook 后端里。

为了解决第二点，刚好赶上小米开放百万亿 token 的免费额度，于是把"人盯报告"换成了"AI 盯报告"：每次新镜像分析完，让 LLM 拿这次的诊断数据 + 上一次的成功结论做对比，按"异常驱动 + 防劣化"的规则输出该不该改、改哪。

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

只有当本次结论与上一次"基本一致"时，LLM 会回复 `与上次分析结论一致`，后端识别后短路复用旧结论且不重复推送（避免每次构建都打扰）；强制推送可在 webhook URL 上加 `notify_force=true`。

## docker hub webhook

在 Docker Hub 仓库 → Webhooks 里直接填以下 URL 即可（邮箱填真实可收件地址）：

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

## dev

启动本服务（依赖外部 diving-rs、Postgres、Redis）：

```bash
docker run -d --restart=always \
  -p 5010:5000 \
  -e RUST_ENV=production \
  -e AIDIVING__REDIS__URI=redis://172.18.230.75:6379 \
  -e AIDIVING__DATABASE__URI=postgres://vicanso:***@172.18.230.75:5432/aidiving \
  -e AIDIVING__SESSION__SECRET=*** \
  --name=ai-diving \
  vicanso/ai-diving
```

启动并初始化 Postgres：

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

建库后用 `psql -f sql/pg/init.sql` 应用 schema（注意 `\i` 是相对当前目录解析，先 `cd sql/pg`）。
