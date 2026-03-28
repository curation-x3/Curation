# 数据架构设计

## 核心原则

**DB 是隔离层**。用户只和本地 DB 交互；API 调用只用于填补 DB 空缺，不是用户操作的直接触发器。

---

## 账号订阅规则

- `subscribed_at` 在账号首次变为 `subscribed` 时记录，此后不再更新
- 文章可见性不受 `subscribed_at` 限制，所有已存入 DB 的文章均可见

---

## 后端定时任务（每12小时）

1. 遍历所有 `subscription_type = subscribed` 的账号
2. 调 `get_post_history` 拉当天发布的文章列表
3. **只存元数据**（title、url、publish_time、cover、digest）——不拉文章内容
4. 用户前端每5分钟轮询 DB，自动看到新条目

---

## 订阅公众号（`POST /accounts/subscribe`）

1. 调 `get_basic_info(name)` 拿到 biz（名称无法直接查 DB，必须过 API）
2. 用 biz 查 DB：首次追踪（不在 DB 或不是 subscribed）→ `is_new = True`
3. `save_account(..., subscribed)`，设置 `subscribed_at = today`
4. `is_new` → 后台拉当天文章元数据（`asyncio.create_task`，不阻塞响应）
5. 已订阅 → 直接返回，不重复拉

---

## 添加文章（`POST /articles/add`）

1. URL 查 DB，已有 → `{new: false}`，直接返回
2. `get_article_detail(url, mode="1")` → 拿文章内容 + biz + nick_name + mp_head_img
3. `biz` 为空 → 400 错误
4. 用 biz 查 DB 账号：
   - **不在 DB（首次追踪）** → 调 `get_basic_info(nick_name)` 拿完整账号信息存 DB
   - **已在 DB** → 刷新 avatar/name
5. 账号类型：已是 `subscribed` 保持不变；否则按用户是否勾选「订阅」决定 `subscribed` / `temporary`
6. 首次追踪 + 用户勾了订阅 → 后台拉当天文章元数据
7. 保存文章到 DB（含内容，因为 `get_article_detail` 刚刚已经调过了）

---

## 文章内容懒加载（`GET /articles/{id}/content`）

1. 有 analysis run → 读 `final_output.md`
2. 有缓存（`markdown_path` 文件存在）→ 直接读文件返回
3. 无缓存 → 调 `get_article_detail(url)` 拉取，写入 `article.md`，更新 DB `markdown_path`，返回内容

`/articles/{id}/raw` 同理。

---

## 关键字段

| 表 | 字段 | 说明 |
|----|------|------|
| `accounts` | `subscription_type` | `'subscribed'` \| `'temporary'` |
| `accounts` | `subscribed_at` | 格式 `YYYY-MM-DD`，首次订阅时写入，不覆盖 |
| `articles` | `markdown_path` | 可为 NULL（元数据条目，内容未缓存） |
| `articles` | `publish_time` | 字符串，前10字符为 `YYYY-MM-DD` |

---

## 文章可见性过滤

所有账号（`subscribed` 和 `temporary`）的文章均全部可见，无订阅日期过滤限制。

---

## AI 总结

### 核心设计
AI 总结同样以 DB 为中间层，**懒加载**——用户打开文章时才触发，不预生成。

### 触发时机
用户打开任意一篇文章时，前端自动调 `POST /articles/{id}/request-analysis`：
- DB 已有完成的 analysis run → 直接展示，不重复触发
- 无已完成 run → 加入 `analysis_queue`（或增加请求计数），等待 Agent 处理

### 前端表现
- **原文 tab**：正常展示，不受影响
- **深度总结 tab**：
  - 任务 pending / running → 显示「正在生成中」
  - 任务完成 → 弹窗通知用户（无论当前在哪篇文章），自动刷新总结内容
  - 无任务 / 失败 → 显示不可用状态

### 队列与优先级
- 每篇文章在 `analysis_queue` 中最多一条记录
- 每次有新用户打开同一篇文章（且任务未完成），`request_count +1`
- 调度时按 `request_count DESC` 排序，需求热度高的优先处理

### 管理员面板执行策略
| 配置项 | 说明 |
|--------|------|
| 自动拉起开关 | 全局控制是否自动启动 Agent 处理队列；关闭时任务只入队不执行 |
| 最大并发数 | 同时运行的 Agent 上限 |

管理员面板可查看完整任务队列（文章标题、请求次数、状态），并手动触发或调整配置。

### 关键表
| 表 | 字段 | 说明 |
|----|------|------|
| `analysis_queue` | `article_id` | UNIQUE，每篇文章一条 |
| `analysis_queue` | `request_count` | 被请求次数，决定优先级 |
| `analysis_queue` | `status` | `pending` \| `running` \| `done` \| `failed` |
| `analysis_queue` | `run_id` | 关联 `analysis_runs.id`，启动后写入 |
| `settings` | `auto_launch` | `"true"` \| `"false"` |
| `settings` | `max_concurrency` | 默认 `"2"` |

---

## 用户与认证

认证相关的表（`app_users`、`invite_codes`、`app_config`）不属于内容数据模型，独立维护。
详见 [`auth-system.md`](./auth-system.md)。
