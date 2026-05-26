// Copyright 2026 Tree xie.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::config::{DivingConfig, must_get_diving_config};
use crate::sql::get_db_pool;
use ctor::ctor;
use pulldown_cmark::{Options, Parser, html as cmark_html};
use resend_rs::Resend;
use resend_rs::types::CreateEmailBaseOptions;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::sync::Arc;
use tibba_error::Error;
use tibba_hook::{BoxFuture, Task, register_task};
use tibba_llm::{Backend, LlmCall, Usage as LlmUsage};
use tibba_model_token::{
    LLM_PROVIDER_ANTHROPIC, SERVICE_LLM, TokenLlmModel, TokenPriceModel, TokenService,
    TokenUsageInsertParams,
};
use tibba_scheduler::{Job, register_job_task};
use tracing::{error, info, warn};

type Result<T> = std::result::Result<T, Error>;

/// web_page_analyses.status 枚举值（与 docker_analyses 保持一致以便复用前端展示）
pub const STATUS_WAITING: i16 = 0;
pub const STATUS_PROCESSING: i16 = 1;
pub const STATUS_COMPLETED: i16 = 2;
pub const STATUS_FAILED: i16 = 3;

#[derive(Debug, FromRow)]
pub struct WebPageAnalysisRecord {
    pub id: i64,
    pub user_id: i64,
    pub url: String,
    /// 推送方式：wecom / email / 空字符串
    pub notify_type: String,
    /// 推送目标：WeCom robot key 或收件邮箱地址
    pub notify_data: String,
    /// 强制推送：即便结论与上次一致也发送通知
    pub notify_force: bool,
    /// diving 抓取门控：true=load 事件后即返回；false=等到 networkIdle
    pub wait_until_load: bool,
    /// diving 抓取前等待的 CSS 选择器，空字符串表示不等待
    pub wait_for_element: String,
}

/// 列表查询返回的精简记录。
#[derive(Debug, FromRow, Serialize)]
pub struct WebPageAnalysisRow {
    pub id: i64,
    pub url: String,
    pub status: i16,
    pub result: Option<String>,
    pub created: chrono::NaiveDateTime,
    pub modified: chrono::NaiveDateTime,
}

/// 分析结果，同时保存 diving 原始诊断数据与 LLM 深度分析内容。
#[derive(Debug, Serialize)]
pub struct WebPageAnalysisResult {
    /// diving html 服务返回的原始 markdown 诊断数据
    pub diving_result: String,
    /// LLM 基于诊断数据生成的 markdown 分析报告
    pub llm_result: String,
    /// LLM 调用耗时（毫秒）
    pub elapsed_ms: u128,
    /// 是否与上次分析结论一致
    pub is_same_as_last: bool,
}

pub struct WebPageAnalysisModel;

impl WebPageAnalysisModel {
    /// 查询相同 user_id + url 且处于等待或处理中的记录 id，不存在返回 None。
    pub async fn find_pending_id(pool: &PgPool, user_id: i64, url: &str) -> Result<Option<i64>> {
        let row: Option<(i64,)> = sqlx::query_as(
            r#"SELECT id FROM web_page_analyses
               WHERE user_id = $1 AND url = $2 AND status = ANY($3)
               LIMIT 1"#,
        )
        .bind(user_id)
        .bind(url)
        .bind(&[STATUS_WAITING, STATUS_PROCESSING][..])
        .fetch_optional(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(row.map(|r| r.0))
    }

    /// 插入一条初始状态为等待处理的分析记录，返回新记录 id。
    #[allow(clippy::too_many_arguments)]
    pub async fn insert(
        pool: &PgPool,
        user_id: i64,
        url: &str,
        notify_type: &str,
        notify_data: &str,
        notify_force: bool,
        wait_until_load: bool,
        wait_for_element: &str,
    ) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            r#"INSERT INTO web_page_analyses
                 (user_id, url, notify_type, notify_data, notify_force, wait_until_load, wait_for_element)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
        )
        .bind(user_id)
        .bind(url)
        .bind(notify_type)
        .bind(notify_data)
        .bind(notify_force)
        .bind(wait_until_load)
        .bind(wait_for_element)
        .fetch_one(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(row.0)
    }

    /// 查询最近 20 条分析记录，按 created 倒序。
    /// `url` 为 `Some` 时按 url 精确过滤，为 `None` 时返回全局最近 20 条。
    pub async fn list_recent(pool: &PgPool, url: Option<&str>) -> Result<Vec<WebPageAnalysisRow>> {
        let rows = if let Some(url) = url {
            sqlx::query_as::<_, WebPageAnalysisRow>(
                r#"SELECT id, url, status, result, created, modified
                   FROM web_page_analyses
                   WHERE url = $1
                   ORDER BY created DESC
                   LIMIT 20"#,
            )
            .bind(url)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, WebPageAnalysisRow>(
                r#"SELECT id, url, status, result, created, modified
                   FROM web_page_analyses
                   ORDER BY created DESC
                   LIMIT 20"#,
            )
            .fetch_all(pool)
            .await
        }
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(rows)
    }

    /// 返回最近有分析记录的 10 个不同 URL，按各自最新一次 created 倒序。
    pub async fn list_recent_urls(pool: &PgPool) -> Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT url
               FROM web_page_analyses
               GROUP BY url
               ORDER BY MAX(created) DESC
               LIMIT 10"#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    /// 查询 24 小时内处于 STATUS_WAITING 的记录 id 列表。
    pub async fn list_waiting_ids(pool: &PgPool) -> Result<Vec<i64>> {
        let rows: Vec<(i64,)> = sqlx::query_as(
            r#"SELECT id FROM web_page_analyses
               WHERE status = $1
                 AND created >= NOW() - INTERVAL '24 hours'
               ORDER BY id"#,
        )
        .bind(STATUS_WAITING)
        .fetch_all(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    /// 尝试将单条记录从 STATUS_WAITING 原子性地标记为 STATUS_PROCESSING。
    pub async fn try_mark_processing(
        pool: &PgPool,
        id: i64,
    ) -> Result<Option<WebPageAnalysisRecord>> {
        let record = sqlx::query_as::<_, WebPageAnalysisRecord>(
            r#"UPDATE web_page_analyses
               SET status = $1, modified = NOW()
               WHERE id = $2 AND status = $3
               RETURNING id, user_id, url, notify_type, notify_data, notify_force,
                         wait_until_load, wait_for_element"#,
        )
        .bind(STATUS_PROCESSING)
        .bind(id)
        .bind(STATUS_WAITING)
        .fetch_optional(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(record)
    }

    /// 将指定记录标记为 STATUS_COMPLETED，并写入分析结果（JSON）。
    pub async fn mark_completed(pool: &PgPool, id: i64, result: &str) -> Result<()> {
        sqlx::query(
            r#"UPDATE web_page_analyses
               SET status = $1, result = $2, modified = NOW()
               WHERE id = $3"#,
        )
        .bind(STATUS_COMPLETED)
        .bind(result)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(())
    }

    /// 查询同一 url 最近一次成功分析的 llm_result，排除当前记录 id。
    pub async fn find_last_llm_result(
        pool: &PgPool,
        url: &str,
        exclude_id: i64,
    ) -> Result<Option<String>> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            r#"SELECT result FROM web_page_analyses
               WHERE url = $1 AND status = $2 AND id != $3
               ORDER BY id DESC
               LIMIT 1"#,
        )
        .bind(url)
        .bind(STATUS_COMPLETED)
        .bind(exclude_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;

        let llm_result = row
            .and_then(|r| r.0)
            .and_then(|json_str| serde_json::from_str::<serde_json::Value>(&json_str).ok())
            .and_then(|v| {
                v.get("llm_result")
                    .and_then(|s| s.as_str())
                    .map(String::from)
            });
        Ok(llm_result)
    }

    /// 将指定记录标记为 STATUS_FAILED，并写入错误信息。
    pub async fn mark_failed(pool: &PgPool, id: i64, reason: &str) -> Result<()> {
        sqlx::query(
            r#"UPDATE web_page_analyses
               SET status = $1, result = $2, modified = NOW()
               WHERE id = $3"#,
        )
        .bind(STATUS_FAILED)
        .bind(reason)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
        Ok(())
    }
}

async fn run_web_page_analysis() -> Result<usize> {
    let pool = get_db_pool();
    let ids = WebPageAnalysisModel::list_waiting_ids(pool).await?;

    if ids.is_empty() {
        return Ok(0);
    }

    let mut completed = 0usize;
    for id in ids {
        let Some(record) = WebPageAnalysisModel::try_mark_processing(pool, id).await? else {
            continue;
        };

        match analyze_page(&record).await {
            Ok(result) => {
                let json = serde_json::to_string(&result).unwrap_or_else(|_| String::from("{}"));
                if let Err(e) = WebPageAnalysisModel::mark_completed(pool, id, &json).await {
                    error!(id, error = %e, "mark web page analysis completed failed");
                } else {
                    completed += 1;
                    if !result.is_same_as_last || record.notify_force {
                        notify_result(&record, &result).await;
                    }
                }
            }
            Err(e) => {
                error!(id, error = %e, "web page analysis failed");
                let _ = WebPageAnalysisModel::mark_failed(pool, id, &e.to_string()).await;
            }
        }
    }

    Ok(completed)
}

/// 与 diving 服务约定的错误响应。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DivingHttpError {
    message: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    status: u16,
}

const ANALYSIS_SYSTEM_PROMPT: &str = r#"
你现在是一位极其务实、精通 Web 性能优化、前端架构与浏览器渲染管线的资深性能工程师。

我将为你提供同一 URL 的【新版本/候选】，以及（如有）【旧版本/基线】的深度浏览器分析数据：Core Web Vitals、Performance metrics、资源清单 / 浪费率、阻塞渲染资源、图片审计、Console 报错、HTTP 错误、DOM mutations 等。请严格遵循"异常驱动"与"防劣化"原则进行对比诊断。

【⚠️ 绝对执行的分析铁律 (CRITICAL RULES)】
1. 极度静默：表现良好的指标（如 LCP < 2.5s、CLS < 0.1、TBT < 200ms、无 4xx/5xx、无 Console 报错、图片无浪费）绝对禁止提及。不写任何"未发现问题"、"表现优秀"的废话。
2. 性能劣化追踪（Regression Detection）：若有上一次的分析记录，必须严格对比新老 Core Web Vitals 与 Performance metrics。任一关键指标劣化 >20% 必须点出，并精准穿透至引发劣化的具体资源、脚本或长任务来源。
3. Performance metrics 绝对水位判定（无需基线即可触发，弥补 rule 2 在首次分析时的盲区；同时绝对水位若超阈值，即便 rule 2 显示"未劣化"也必须报告）：
   - **JS heap**：`used` > 60MB **或** `used / total > 80%` 必须点出。前者 = 堆膨胀（疑似泄漏或大对象缓存）；后者 = 接近 GC 阈值，下一次 minor GC 会出现可观察卡顿。
   - **DOM nodes**：> 3000 必须点出量级并穿透到大列表 / 表格 / 未虚拟化组件；> 5000 几乎确诊缺少虚拟滚动。
   - **Event listeners**：> 500 必须点出；> 1000 几乎确诊监听器泄漏（addEventListener 未配对 removeEventListener、组件 unmount 后仍持有引用、第三方库重复绑定等），必须建议核查 unmount / cleanup 路径。
   - **CPU 分项**：`script > 400ms` **或** `layout + style > 150ms`（强制 reflow / layout thrashing 信号） **或** `total task > 1000ms` 必须点出，并根据 `initiators` / `render_blocking_resources` 指出 dominator。
   - 注意：以上阈值之下的指标（如 heap 14MB、nodes 2000、script 100ms）一律静默不报，避免噪音。
4. 浪费资源审计（绝对节省优先于比例 —— 单项预计节省 < 10KB 的浪费一律不报，因为这与 HTTP 头开销 / TCP slow-start 同量级，不构成可执行优化；典型反例：1.4KB JSON 未启用 gzip 可省 692 字节，绝对不要写入报告）：
   - `resource_summary` 中未启用 gzip/brotli **且** 单文件原始大小 ≥ 10KB 的资源必须列出 URL + 原始大小 + 估算节省字节。
   - `image_sizing` 中浪费像素比 > 50% **且** 文件 ≥ 30KB 的图片必须列出 URL + 浪费比 + 文件大小；小 icon / sprite 一律忽略。
   - `coverage`（若有）中单文件 unused ≥ 30KB 的资源必须列出，按 unused 字节降序取 Top 5。
   - 阻塞渲染的同步 `<script>` / 无 `media` 限定的同步 `<link rel=stylesheet>` 必须列出文件名与字节数（阻塞渲染是行为问题，不是体积问题，无最小阈值）。
5. HTTP 健康检查：`http_errors` 中的 4xx / 5xx / 网络失败（DNS/TLS/connection_refused）必须列出。重定向链 > 2 必须点出。
6. Console / JS 错误：JS 报错、未捕获的 Promise 拒绝必须列出（按严重度限制 Top 3）。
7. DOM 抖动检测（Render Thrash）：`dom_mutations` 总数 > 1000 必须点出，并分别说明新增 / 删除 / 属性变更三类的量级；若属性变更占比 > 60%，警示可能引发强制 reflow / layout thrashing；若 load 事件之后仍存在持续高频变更，说明初始 hydration 之外仍有抖动来源（轮询、动画过度、未节流的 setState 等），必须指出量级，并尽量根据 `initiators` / `console_messages` 推测来源脚本。
8. 不要建议无法落地的改动：如"使用 HTTP/3"、"切到 CDN"这类抽象建议不写；只写"删除某行 script"、"加 defer"、"压缩 hero.png 至 WebP <60KB"这类可直接动手的修复。

请严格按以下精简格式输出报告（如果未发现劣化且无任何需要修复的真实异常，请直接回复："🟢 页面无劣化，健康通过"）：

### 🚨 核心异常与劣化痛点
- [精确指出 Core Web Vitals 劣化数值、阻塞资源的文件名/大小、浪费率超阈值的资源 URL，或 HTTP / Console 错误。一句废话不要有]

### 🛠️ 必须执行的修复建议
- [给出具体的优化代码片段或配置改动：async/defer 化某 script、压缩/转 WebP 某图片、移除某未使用的 CSS、修复某 4xx URL、调整某 meta 标签等]

---"#;

/// 调用 diving html 服务获取页面诊断数据。成功时返回 markdown 字符串。
async fn fetch_diving_result(record: &WebPageAnalysisRecord) -> Result<String> {
    let config = must_get_diving_config();
    let html_url = config
        .html_url
        .as_deref()
        .ok_or_else(|| Error::new("html_url not configured").with_category("web_page"))?;
    let url = format!("{}/summary", html_url.trim_end_matches('/'));

    let wait_until_load_str = if record.wait_until_load {
        "true"
    } else {
        "false"
    };
    let mut params: Vec<(&str, &str)> = vec![
        ("url", record.url.as_str()),
        ("format", "markdown"),
        ("data_format", "markdown"),
        ("all_metrics", "true"),
        ("coverage", "true"),
        ("wait_until_load", wait_until_load_str),
    ];
    if !record.wait_for_element.is_empty() {
        params.push(("wait_for_element", record.wait_for_element.as_str()));
    }

    let resp = reqwest::Client::new()
        .get(&url)
        .query(&params)
        .send()
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;

    let status = resp.status().as_u16();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;

    if status >= 400 {
        let err = serde_json::from_slice::<DivingHttpError>(&bytes).unwrap_or(DivingHttpError {
            message: String::from_utf8_lossy(&bytes).into_owned(),
            code: String::new(),
            status,
        });
        let report_status = if err.status == 0 { status } else { err.status };
        let message = if err.code.is_empty() {
            format!("diving({report_status}): {}", err.message)
        } else {
            format!("diving({}/{}): {}", report_status, err.code, err.message)
        };
        return Err(Error::new(message).with_category("web_page"));
    }

    String::from_utf8(bytes.to_vec())
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))
}

/// 根据 LLM 返回的 token 用量计费并写入 token_usages、扣减账户余额。
async fn consume_tokens(
    pool: &PgPool,
    record: &WebPageAnalysisRecord,
    model: &str,
    usage: &LlmUsage,
    elapsed_ms: u128,
) -> Result<()> {
    let Some(price) = TokenPriceModel::default()
        .get_by_service_model(pool, SERVICE_LLM, model)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?
    else {
        warn!(
            id = record.id,
            model, "no token price configured, skip consume"
        );
        return Ok(());
    };

    let input_tokens = usage.input_tokens as i32;
    let output_tokens = usage.output_tokens as i32;
    let amount = TokenPriceModel::calculate_cost(&price, input_tokens, output_tokens);

    let duration_ms = elapsed_ms.min(i32::MAX as u128) as i32;
    let result = TokenService::consume(
        pool,
        TokenUsageInsertParams {
            user_id: record.user_id,
            service: SERVICE_LLM.to_string(),
            amount,
            model: Some(model.to_string()),
            input_tokens: Some(input_tokens),
            output_tokens: Some(output_tokens),
            api_path: None,
            duration_ms: Some(duration_ms),
            biz_id: Some(record.id.to_string()),
            remark: Some(format!("web_page_analysis:{}", record.url)),
        },
    )
    .await
    .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;

    info!(
        id = record.id,
        model,
        amount,
        new_balance = result.new_balance,
        usage_id = result.usage_id,
        "tokens consumed"
    );
    Ok(())
}

/// 调用 diving html 获取诊断数据，再交给 LLM 做对比分析。
async fn analyze_page(record: &WebPageAnalysisRecord) -> Result<WebPageAnalysisResult> {
    let diving_result = fetch_diving_result(record).await?;

    info!(id = record.id, "diving web page success");

    let pool = get_db_pool();
    let prev_llm = WebPageAnalysisModel::find_last_llm_result(pool, &record.url, record.id)
        .await
        .unwrap_or(None);

    let user_message = if let Some(ref prev) = prev_llm {
        format!(
            "# 本次页面诊断数据\n\n\
             {diving_result}\n\n\
             ---\n\n\
             # 上一次分析结论（供对比）\n\n\
             {prev}\n\n\
             请将本次诊断数据与上一次结论进行对比。若两次结论基本一致，直接输出：\
             **与上次分析结论一致，无需调整。**"
        )
    } else {
        format!("本次页面诊断数据：\n\n{diving_result}")
    };

    let llm_config = TokenLlmModel::default()
        .get_by_name(pool, "default")
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?
        .ok_or_else(|| {
            Error::new("no enabled token_llms record found (expect name='default')")
                .with_category("web_page")
        })?;

    let backend = if llm_config.provider == LLM_PROVIDER_ANTHROPIC {
        Backend::Anthropic
    } else {
        Backend::OpenAi
    };

    let llm_start = std::time::Instant::now();
    let resp = LlmCall::new(&llm_config.api_key, &llm_config.model, &user_message)
        .with_base_url(&llm_config.url)
        .with_backend(backend)
        .with_system_message(ANALYSIS_SYSTEM_PROMPT)
        .chat()
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
    let elapsed_ms = llm_start.elapsed().as_millis();

    info!(
        id = record.id,
        model = resp.model,
        input_tokens = resp.usage.as_ref().map(|u| u.input_tokens).unwrap_or(0),
        output_tokens = resp.usage.as_ref().map(|u| u.output_tokens).unwrap_or(0),
        elapsed_ms,
        "web page llm analysis done",
    );

    if let Some(usage) = resp.usage.as_ref()
        && let Err(e) = consume_tokens(pool, record, &resp.model, usage, elapsed_ms).await
    {
        error!(id = record.id, error = %e, "consume tokens failed");
    }
    if resp.content.is_empty() {
        warn!(id = record.id, "llm returned empty content");
    }

    let is_same = resp.content.contains("与上次分析结论一致");
    let (llm_result, is_same_as_last) = match (is_same, prev_llm) {
        (true, Some(prev)) => (prev, true),
        _ => (resp.content, false),
    };

    info!(id = record.id, is_same_as_last, "llm analysis success");

    Ok(WebPageAnalysisResult {
        diving_result,
        llm_result,
        elapsed_ms,
        is_same_as_last,
    })
}

async fn send_wecom_notification(
    token: &str,
    record: &WebPageAnalysisRecord,
    result: &WebPageAnalysisResult,
) -> Result<()> {
    let content = format!(
        "**Web Page Analysis Completed**\n\
         - URL: `{}`\n\
         - Analysis ID: {}\n\
         - Elapsed: {}ms\n\n\
         {}",
        record.url, record.id, result.elapsed_ms, result.llm_result
    );
    let url = format!(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={}",
        token
    );
    let body = serde_json::json!({
        "msgtype": "markdown",
        "markdown": { "content": content }
    });
    reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
    Ok(())
}

fn markdown_to_html(md: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(md, options);
    let mut out = String::new();
    cmark_html::push_html(&mut out, parser);
    out
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

const EMAIL_HTML_STYLE: &str = r#"<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:760px;margin:0 auto;padding:16px;line-height:1.55;color:#24292f}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;font-size:13px}
code{background:rgba(175,184,193,0.2);padding:2px 4px;border-radius:3px;font-size:85%}
pre code{background:transparent;padding:0;font-size:100%}
h1,h2,h3{padding-bottom:4px;border-bottom:1px solid #eaecef;margin-top:1.4em}
hr{border:0;border-top:1px solid #eaecef;margin:1.5em 0}
table{border-collapse:collapse}
th,td{border:1px solid #d0d7de;padding:6px 13px}
.meta{color:#57606a;font-size:14px}
details summary{cursor:pointer;color:#0969da}
</style>"#;

async fn send_email_notification(
    config: &DivingConfig,
    to: &str,
    record: &WebPageAnalysisRecord,
    result: &WebPageAnalysisResult,
) -> Result<()> {
    let from_addr = config
        .email_from
        .as_deref()
        .ok_or_else(|| Error::new("email_from not configured").with_category("web_page"))?;
    let api_key = config
        .resend_api_key
        .as_deref()
        .ok_or_else(|| Error::new("resend_api_key not configured").with_category("web_page"))?;

    let subject = format!("Web Page Analysis: {}", record.url);

    let plain_body = format!(
        "URL: {}\nAnalysis ID: {}\nElapsed: {}ms\n\n{}\n\n---\nDiving Result:\n{}",
        record.url, record.id, result.elapsed_ms, result.llm_result, result.diving_result,
    );

    let escaped_url = escape_html(&record.url);
    let html_body = format!(
        r#"<!DOCTYPE html>
<html><head><meta charset="utf-8">{style}</head><body>
<p class="meta"><strong>URL:</strong> <a href="{url_attr}">{url_text}</a><br>
<strong>Analysis ID:</strong> {id}<br>
<strong>Elapsed:</strong> {elapsed}ms</p>
<hr>
{llm_html}
<hr>
<details><summary>Diving Result</summary>
{diving_html}
</details>
</body></html>"#,
        style = EMAIL_HTML_STYLE,
        url_attr = escaped_url,
        url_text = escaped_url,
        id = record.id,
        elapsed = result.elapsed_ms,
        llm_html = markdown_to_html(&result.llm_result),
        diving_html = markdown_to_html(&result.diving_result),
    );

    let email = CreateEmailBaseOptions::new(from_addr, [to], subject)
        .with_text(&plain_body)
        .with_html(&html_body);

    Resend::new(api_key)
        .emails
        .send(email)
        .await
        .map_err(|e| Error::new(e.to_string()).with_category("web_page"))?;
    Ok(())
}

async fn notify_result(record: &WebPageAnalysisRecord, result: &WebPageAnalysisResult) {
    let config = must_get_diving_config();

    if !record.notify_type.is_empty() && !record.notify_data.is_empty() {
        match record.notify_type.as_str() {
            "wecom" => {
                if let Err(e) = send_wecom_notification(&record.notify_data, record, result).await {
                    error!(id = record.id, error = %e, "send wecom notification failed");
                }
            }
            "email" => {
                if let Err(e) =
                    send_email_notification(config, &record.notify_data, record, result).await
                {
                    error!(id = record.id, error = %e, "send email notification failed");
                }
            }
            other => {
                warn!(
                    id = record.id,
                    notify_type = other,
                    "unknown notify_type, skipped"
                );
            }
        }
        return;
    }

    if let Some(token) = &config.notify_wecom
        && let Err(e) = send_wecom_notification(token, record, result).await
    {
        error!(id = record.id, error = %e, "send wecom notification failed");
    }
    if let Some(email) = &config.notify_email
        && let Err(e) = send_email_notification(config, email, record, result).await
    {
        error!(id = record.id, error = %e, "send email notification failed");
    }
}

struct WebPageAnalysisTask;

impl Task for WebPageAnalysisTask {
    fn before(&self) -> BoxFuture<'_, Result<bool>> {
        Box::pin(async move {
            // 每分钟执行一次（错峰：在每分钟第 30 秒，避免与 docker_analysis 同步触发）
            let job = Job::new_async("30 * * * * *", |_, _| {
                let category = "web_page_analysis";
                Box::pin(async move {
                    match run_web_page_analysis().await {
                        Err(e) => {
                            error!(category, error = %e, "run web page analysis failed");
                        }
                        Ok(completed) => {
                            info!(category, completed, "run web page analysis success");
                        }
                    }
                })
            })
            .map_err(Error::new)?;
            register_job_task("web_page_analysis", job);
            Ok(true)
        })
    }
}

#[ctor(unsafe)]
fn init() {
    register_task("web_page_analysis", Arc::new(WebPageAnalysisTask));
}
