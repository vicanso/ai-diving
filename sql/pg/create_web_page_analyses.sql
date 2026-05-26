CREATE TABLE web_page_analyses (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT        NOT NULL,
  url              VARCHAR(2000) NOT NULL,
  status           SMALLINT      NOT NULL DEFAULT 0,
  result           TEXT,
  notify_type      VARCHAR(20)   NOT NULL DEFAULT '',
  notify_data      VARCHAR(500)  NOT NULL DEFAULT '',
  notify_force     BOOLEAN       NOT NULL DEFAULT FALSE,
  wait_until_load  BOOLEAN       NOT NULL DEFAULT TRUE,
  wait_for_element VARCHAR(500)  NOT NULL DEFAULT '',
  created          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- url 可达 2KB，超过 btree 单条目上限，故不直接索引 url 字段。
-- 操作查询走 (user_id, status, created) 即可，url 过滤靠少量活跃行的 seq 过滤。
CREATE INDEX idx_web_page_analyses_user    ON web_page_analyses (user_id);
CREATE INDEX idx_web_page_analyses_status  ON web_page_analyses (status);
CREATE INDEX idx_web_page_analyses_created ON web_page_analyses (created);

COMMENT ON TABLE web_page_analyses IS '网页性能分析任务表';
COMMENT ON COLUMN web_page_analyses.id           IS '主键ID';
COMMENT ON COLUMN web_page_analyses.user_id      IS '发起分析的用户ID';
COMMENT ON COLUMN web_page_analyses.url          IS '待分析的页面 URL';
COMMENT ON COLUMN web_page_analyses.status       IS '任务状态：0=等待处理，1=处理中，2=已完成，3=失败';
COMMENT ON COLUMN web_page_analyses.result       IS '分析结果（JSON 字符串）';
COMMENT ON COLUMN web_page_analyses.notify_type  IS '推送方式：wecom / email / 空字符串表示无推送';
COMMENT ON COLUMN web_page_analyses.notify_data  IS '推送目标：WeCom robot key 或收件邮箱地址';
COMMENT ON COLUMN web_page_analyses.notify_force     IS '是否在结果与上次一致时仍发送通知';
COMMENT ON COLUMN web_page_analyses.wait_until_load  IS 'diving 抓取门控：true=load 事件后即返回；false=等到 networkIdle';
COMMENT ON COLUMN web_page_analyses.wait_for_element IS 'diving 抓取前等待的 CSS 选择器，留空表示不等待';
COMMENT ON COLUMN web_page_analyses.created          IS '创建时间';
COMMENT ON COLUMN web_page_analyses.modified         IS '更新时间';
