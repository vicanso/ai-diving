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

use crate::model::docker_analysis::{DockerAnalysisModel, DockerAnalysisRow};
use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tibba_error::Error;
use tibba_model_token::{TokenAccountModel, TokenKeyModel};
use tibba_util::JsonResult;

#[derive(Debug, Deserialize)]
pub struct DockerTokenQuery {
    pub token: String,
    /// 推送方式：wecom / email
    pub notify_type: Option<String>,
    /// 推送目标：WeCom robot key 或收件邮箱地址
    pub notify_data: Option<String>,
    /// 强制推送：即便分析结论与上一次一致也发送通知
    #[serde(default)]
    pub notify_force: bool,
}

#[derive(Debug, Deserialize)]
pub struct DockerPushData {
    pub tag: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerRepository {
    pub repo_name: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerWebhookPayload {
    pub push_data: DockerPushData,
    pub repository: DockerRepository,
}

#[derive(Debug, Serialize)]
pub struct AnalyzeResp {
    pub id: i64,
}

pub async fn analyze(
    State(pool): State<&'static PgPool>,
    Query(q): Query<DockerTokenQuery>,
    Json(payload): Json<DockerWebhookPayload>,
) -> JsonResult<AnalyzeResp> {
    // 验证 token，获取对应 user_id
    let user_id = TokenKeyModel::default()
        .get_user_id_by_token(pool, &q.token)
        .await
        .map_err(Error::from)?
        .ok_or_else(|| Error::new("Invalid token").with_status(401))?;

    // 检查余额是否充足
    let account = TokenAccountModel::default()
        .get_by_user_id(pool, user_id)
        .await
        .map_err(Error::from)?
        .ok_or_else(|| Error::new("Insufficient balance").with_status(402))?;

    if account.balance <= 0 {
        return Err(Error::new("Insufficient balance").with_status(402));
    }

    let repo_name = &payload.repository.repo_name;
    let tag = &payload.push_data.tag;

    // 若已存在相同 repo_name + tag 且等待处理或处理中的记录，直接返回该记录 id
    if let Some(id) = DockerAnalysisModel::find_pending_id(pool, user_id, repo_name, tag).await? {
        return Ok(Json(AnalyzeResp { id }));
    }

    let notify_type = q.notify_type.as_deref().unwrap_or_default();
    let notify_data = q.notify_data.as_deref().unwrap_or_default();

    // 创建新的分析记录，初始状态为等待处理
    let id = DockerAnalysisModel::insert(
        pool,
        user_id,
        repo_name,
        tag,
        notify_type,
        notify_data,
        q.notify_force,
    )
    .await?;

    Ok(Json(AnalyzeResp { id }))
}

#[derive(Debug, Deserialize)]
pub struct DockerListQuery {
    /// 可选：不传或传空字符串时返回全局最近 20 条。
    pub repo_name: Option<String>,
}

/// 查询最近 20 条分析记录，按 created 倒序。`repo_name` 可选。
pub async fn list(
    State(pool): State<&'static PgPool>,
    Query(q): Query<DockerListQuery>,
) -> JsonResult<Vec<DockerAnalysisRow>> {
    let repo_name = q
        .repo_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let rows = DockerAnalysisModel::list_recent(pool, repo_name).await?;
    Ok(Json(rows))
}

/// 返回最近有分析记录的 10 个不同仓库名，给前端的下拉建议用。
pub async fn list_repo_names(State(pool): State<&'static PgPool>) -> JsonResult<Vec<String>> {
    let names = DockerAnalysisModel::list_recent_repo_names(pool).await?;
    Ok(Json(names))
}
