# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Backend (Rust, edition 2024):
- `make dev` — run via `bacon run` (hot reload). The binary is `ai-diving`; default listen is `127.0.0.1:5000`.
- `make lint` — `cargo clippy --all-targets --all -- --deny=warnings`. Note: `clippy::unwrap_used` is **denied** in `Cargo.toml`; do not introduce `.unwrap()` outside `unwrap_or_else(|| panic!(...))` patterns already used for once-cell init.
- `make fmt` — `cargo fmt`.
- `make release` — release build with LTO + single codegen unit + stripped debuginfo.
- Run a single test: `cargo test <name> -- --nocapture` (no test harness conventions enforced — there are currently no tests in `src/`).

Admin SPA (`admin/`, React 19 + Vite + Tailwind v4 + shadcn):
- `cd admin && npm install && npm run dev` — Vite dev server.
- `cd admin && npm run build` — TypeScript project build then `vite build` into `admin/dist/`. The Rust binary embeds `admin/dist/` at compile time via `rust-embed`, so **the SPA must be built before `cargo build`** if you want the bundled UI to reflect frontend changes. `make admin` does the install+build.
- `cd admin && npm run lint` — eslint.
- `cd admin && npm run format` — prettier.

Environment selection:
- `tibba_util::get_env()` chooses the second TOML in `configs/` (`dev.toml` / `production.toml` / `test.toml`) layered on `default.toml`. Override values via env vars prefixed `TIBBA_WEB__` (double underscore = section separator).
- `RUST_LOG=<level>` controls tracing level. `AI-DIVING_THREADS=<n>` overrides the tokio worker count (defaults to `num_cpus::get()`).

Local infrastructure (Postgres + Redis required at startup):
- Postgres bootstrap commands are in `README.md` (database `aidiving`, user `vicanso`). After the DB is up, apply schema with `psql -f sql/pg/init.sql` (it `\i`-includes every `create_*.sql`). Redis defaults to `redis://127.0.0.1:6379` (see `configs/dev.toml`).

## Architecture

This is a single-binary Rust web service that serves a JSON API and the embedded admin SPA from one process. Most of the framework (routing primitives, session, models, scheduler, LLM client, error type, config loader, object-storage, perf metrics, middleware) is supplied by the **`tibba-*` crate family** pulled from crates.io — `tibba-router-{common,file,model,user}`, `tibba-model{,-builtin,-token}`, `tibba-session`, `tibba-scheduler`, `tibba-hook`, `tibba-llm`, `tibba-cache` (Redis), `tibba-sql`, `tibba-opendal`, `tibba-state`, `tibba-config`, `tibba-error`, `tibba-middleware`, `tibba-util`, `tibba-performance`. When something looks like it should exist but isn't in `src/`, it almost certainly lives in one of these external crates — search docs.rs or the user's local registry rather than re-implementing.

### Startup lifecycle (the `tibba-hook` task system)

Each module in `src/` registers a `Task` via `#[ctor(unsafe)] fn init()` that calls `register_task("<name>", Arc::new(...))`. `main.rs` → `run()` then calls `run_before_tasks().await` which executes every registered task's `before()` in priority order. `run_after_tasks()` runs `after()` on shutdown. Tasks frequently use `before()` to (a) initialize a `OnceCell` global (`get_db_pool`, `get_redis_cache`, `get_opendal_storage`, `get_app_state`, all the `*_CONFIG` cells) and (b) `register_job_task("<name>", Job::new_*)` with `tibba-scheduler` so periodic work runs without further wiring.

Implication: adding a new background loop = define a `Task::before` that registers a `Job`, then `register_task` in a `#[ctor]` init. `run_scheduler_jobs()` (called from `main::run`) starts everything that was registered.

Tasks currently registered: `config` (loads TOML → `BasicConfig`/`SessionConfig`/`DivingConfig`), `redis`, `dal` (opendal storage), `sql` (Postgres pool), `state` (per-minute process perf logging), `docker_analysis` (cron `0 * * * * *`), `stop_app` (graceful drain in production).

### Router composition

`router::new_router()` is the single source of truth for HTTP shape:
1. `register_models()` registers every domain model (`UserModel`, `FileModel`, all `Token*Model`, `HttpDetectorModel`, `DetectorGroupModel`, `WebPageDetectorModel`, etc.) with `tibba_router_model::register_model`. The `/models` route then exposes generic CRUD over registered models.
2. Mounts sub-routers: `/users` (`tibba-router-user` — handles register/login, has `on_register` hook that gifts `1_000_000` tokens via `TokenService::recharge`), `/files` (`tibba-router-file`), `/models` (`tibba-router-model`), `/docker` (the only handler defined in this repo, `docker::analyze`), and merges `tibba-router-common` (health, etc.).
3. The whole API tree is optionally nested under `basic.prefix` (e.g. `/api`).
4. `fallback` serves the embedded SPA via `admin_web::serve_web`, with `web_prefix` matching Vite's `base` for sub-path deploys. Files under `assets/` (Vite-hashed) get `Cache-Control: public, max-age=31536000, immutable`; everything else is `no-cache`; unknown paths fall back to `index.html` for client-side routing.

Middleware stack (applied outermost-first in `main::run`): `HandleErrorLayer` → compression (br/gzip/zstd, skip <1KB and SSE/images/gRPC) → `tower::timeout(basic.timeout)` → `entry` → `stats` → `session` (uses Redis cache + signed cookie key derived from `session.secret`, min 64 chars) → `processing_limit` (concurrency cap from `basic.processing_limit`).

### The Docker analysis pipeline (the only domain logic in this repo)

Everything else is framework glue; `src/docker.rs` + `src/model/docker_analysis.rs` is what this service actually *does*:
1. **Ingress** (`POST /docker/analyze?token=...&notify_type=...&notify_data=...` with a Docker Hub-style webhook payload): authenticates via `TokenKeyModel::get_user_id_by_token`, checks `TokenAccountModel` balance, deduplicates against any pending/processing row for the same `(user_id, repo_name, tag)`, then inserts a `docker_analyses` row in `STATUS_WAITING` and returns its id.
2. **Worker** (cron `0 * * * * *`, registered by `DockerAnalysisTask::before`): `list_waiting_ids` → for each, `try_mark_processing` does an atomic `UPDATE … WHERE status = WAITING RETURNING …` so multiple instances can race safely. The contended row's claimant calls `analyze_image`.
3. **`analyze_image`**: GETs `{diving.url}/api/analyze?image=<repo>:<tag>&format=markdown&skipBase=true` (the external "diving" service produces the layer/security report); loads `TokenLlmModel` row named `"default"` for provider/model/api_key/url; `tibba_llm::LlmCall` dispatches to `Backend::Anthropic` if `provider == "anthropic"` else `Backend::OpenAi`; the system prompt (`ANALYSIS_SYSTEM_PROMPT`) is a Chinese DevSecOps "anomaly-only" rubric — keep it intact unless explicitly changing the analysis behavior. If a previous `STATUS_COMPLETED` record exists for the same repo+tag, its `llm_result` is included in the user message and the LLM may answer "与上次分析结论一致" — that string match short-circuits to `is_same_as_last = true` and reuses the prior result.
4. **Token billing**: `consume_tokens` looks up `TokenPriceModel` by `(SERVICE_LLM, model)`; missing price = log-and-skip (no charge), present price = `TokenService::consume` writes `token_usages` and decrements `token_accounts.balance`. Billing failures are logged but never abort the analysis.
5. **Notify** (only when `is_same_as_last == false`): per-record `notify_type` ∈ {`wecom`, `email`} takes precedence, falling back to global `diving.notify_wecom` / `diving.notify_email`. WeCom uses the markdown webhook; email uses `lettre` with SMTP creds from `DivingConfig`.

Statuses on `docker_analyses.status` (SMALLINT): `0=WAITING, 1=PROCESSING, 2=COMPLETED, 3=FAILED`. `result` is a JSON string of `DockerAnalysisResult` on success, or the error text on failure.

### Configuration shape

Three config sections are deserialized into typed structs and validated with `validator`:
- `[basic]` → `BasicConfig` (listen, timeout, processing_limit, secret, optional `prefix`/`web_prefix`, `commit_id` defaulted from the embedded `configs/commit_id.txt` written by the Dockerfile).
- `[session]` → `SessionConfig` (ttl 60s–30d, secret ≥64 chars, cookie name, max_renewal 1–52).
- `[diving]` → `DivingConfig` (URL of the external diving analyzer + optional WeCom/email notification defaults + SMTP).
- `[redis]`, `[database]`, `[opendal]` are consumed directly by the corresponding `tibba-*` crate's constructor (`new_redis_client`, `new_pg_pool`, `new_opendal_storage`) — see those crates for their schema.

### Things to know when editing

- Globals are `OnceCell`/`Lazy` everywhere; the read accessors (`must_get_*`, `get_*`) panic if called before the corresponding `Task::before` ran. Don't move config reads into `#[ctor]` init paths — they belong in `before()`.
- Database access in this repo is raw `sqlx::query*` against `&PgPool`; the registered `Model` types from `tibba-model*` are for the generic `/models` CRUD router, not for hand-written handlers.
- Errors are `tibba_error::Error`. Wrap external errors with `.with_category("...")` for log correlation; HTTP status comes from `.with_status(n)`.
- The `admin_web` SPA fallback runs for every unmatched path including 404s under the API prefix — make sure new API routes are mounted before considering "missing route" behavior.
