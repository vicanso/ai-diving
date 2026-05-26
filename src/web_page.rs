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

use crate::model::web_page_analysis::{WebPageAnalysisModel, WebPageAnalysisRow};
use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tibba_error::Error;
use tibba_model_token::{TokenAccountModel, TokenKeyModel};
use tibba_util::JsonResult;

#[derive(Debug, Deserialize)]
pub struct WebPageTokenQuery {
    pub token: String,
    /// 推送方式：wecom / email
    pub notify_type: Option<String>,
    /// 推送目标：WeCom robot key 或收件邮箱地址
    pub notify_data: Option<String>,
    /// 强制推送：即便分析结论与上一次一致也发送通知
    #[serde(default)]
    pub notify_force: bool,
}

fn default_wait_until_load() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct WebPagePayload {
    pub url: String,
    /// diving 抓取门控：true=load 事件后即返回（默认）；false=等到 networkIdle
    #[serde(default = "default_wait_until_load")]
    pub wait_until_load: bool,
    /// 可选：diving 抓取前等待出现的 CSS 选择器
    #[serde(default)]
    pub wait_for_element: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AnalyzeResp {
    pub id: i64,
}

/// 提交一次网页性能分析任务。
pub async fn analyze(
    State(pool): State<&'static PgPool>,
    Query(q): Query<WebPageTokenQuery>,
    Json(payload): Json<WebPagePayload>,
) -> JsonResult<AnalyzeResp> {
    let user_id = TokenKeyModel::default()
        .get_user_id_by_token(pool, &q.token)
        .await
        .map_err(Error::from)?
        .ok_or_else(|| Error::new("Invalid token").with_status(401))?;

    let account = TokenAccountModel::default()
        .get_by_user_id(pool, user_id)
        .await
        .map_err(Error::from)?
        .ok_or_else(|| Error::new("Insufficient balance").with_status(402))?;

    if account.balance <= 0 {
        return Err(Error::new("Insufficient balance").with_status(402));
    }

    let url = payload.url.trim();
    if url.is_empty() {
        return Err(Error::new("url is required").with_status(400));
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(Error::new("url must start with http:// or https://").with_status(400));
    }
    if url.len() > 2000 {
        return Err(Error::new("url too long (max 2000 chars)").with_status(400));
    }

    // 若已存在相同 url 且等待处理或处理中的记录，直接返回该记录 id
    if let Some(id) = WebPageAnalysisModel::find_pending_id(pool, user_id, url).await? {
        return Ok(Json(AnalyzeResp { id }));
    }

    let notify_type = q.notify_type.as_deref().unwrap_or_default();
    let notify_data = q.notify_data.as_deref().unwrap_or_default();
    let wait_for_element = payload
        .wait_for_element
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if wait_for_element.len() > 500 {
        return Err(Error::new("wait_for_element too long (max 500 chars)").with_status(400));
    }

    let id = WebPageAnalysisModel::insert(
        pool,
        user_id,
        url,
        notify_type,
        notify_data,
        q.notify_force,
        payload.wait_until_load,
        wait_for_element,
    )
    .await?;

    Ok(Json(AnalyzeResp { id }))
}

#[derive(Debug, Deserialize)]
pub struct WebPageListQuery {
    /// 可选：不传或传空字符串时返回全局最近 20 条。
    pub url: Option<String>,
}

/// 查询最近 20 条分析记录，按 created 倒序。`url` 可选。
pub async fn list(
    State(pool): State<&'static PgPool>,
    Query(q): Query<WebPageListQuery>,
) -> JsonResult<Vec<WebPageAnalysisRow>> {
    let url = q.url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let rows = WebPageAnalysisModel::list_recent(pool, url).await?;
    Ok(Json(rows))
}

/// 返回最近有分析记录的 10 个不同 URL，供前端下拉建议用。
pub async fn list_urls(State(pool): State<&'static PgPool>) -> JsonResult<Vec<String>> {
    let urls = WebPageAnalysisModel::list_recent_urls(pool).await?;
    Ok(Json(urls))
}
