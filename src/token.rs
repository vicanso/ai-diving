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

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tibba_error::Error;
use tibba_model_token::TokenService;
use tibba_session::AdminSession;
use tibba_util::JsonResult;
use tracing::info;

#[derive(Debug, Deserialize)]
pub struct AdjustBalancePayload {
    pub user_id: i64,
    /// 调整金额：正数 → 充值（source=ADMIN），负数 → 扣减（service=admin_adjust）。
    pub amount: i64,
    /// 备注，落到对应流水行的 remark；空或空白会被替换为 "admin adjust"。
    #[serde(default)]
    pub remark: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdjustBalanceResp {
    pub new_balance: i64,
}

/// 管理员调整某用户的 token 账户余额。底层透传到
/// [`TokenService::adjust`]，保留 token_recharges / token_usages 流水：
/// - `amount > 0` → recharge，`source = ADMIN`、`created_by = admin_user_id`
/// - `amount < 0` → consume，`service = admin_adjust`、`biz_id = admin:<id>`
/// - `amount == 0` → 400
pub async fn adjust_balance(
    State(pool): State<&'static PgPool>,
    admin: AdminSession,
    Json(payload): Json<AdjustBalancePayload>,
) -> JsonResult<AdjustBalanceResp> {
    let admin_user_id = admin.get_user_id();
    let result = TokenService::adjust(
        pool,
        payload.user_id,
        payload.amount,
        admin_user_id,
        payload.remark.clone(),
    )
    .await
    .map_err(Error::from)?;

    info!(
        category = "token_adjust",
        admin_user_id,
        target_user_id = payload.user_id,
        amount = payload.amount,
        new_balance = result.new_balance,
        remark = payload.remark.as_deref().unwrap_or(""),
        "admin balance adjust"
    );

    Ok(Json(AdjustBalanceResp {
        new_balance: result.new_balance,
    }))
}
