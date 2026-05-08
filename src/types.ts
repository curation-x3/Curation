export interface Account {
  id: number;
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
  last_monitored_at?: string;
  article_count?: number;
  subscription_type?: "subscribed" | "temporary";
  avg_daily_freq?: number;
  estimated_daily_cost?: number;
  total_cost?: number;
  sync_count?: number;
}

export interface Article {
  short_id: string;
  title: string;
  url: string;
  publish_time: string;
  digest?: string;
  cover_url?: string;
  author?: string;
  account?: string;
  markdown?: string;
  rawMarkdown?: string;
  html_path?: string;
  markdown_path?: string;
  biz?: string | null;
  serving_run_id?: number | null;
  content_source?: "analysis" | "raw" | "empty" | "not_loaded" | "enqueued" | "error";
  cards?: { card_id: string; title: string; content: string; unpushed?: string | any[] }[];
  article_meta?: { title: string; url: string; publish_time: string; author: string; account?: string; biz?: string | null; article_id?: string };
  rawHtml?: string;
  contentFormat?: "html" | "markdown";
  word_count?: number;
  queue_status?: "pending" | "running" | "done" | "failed" | null;
  hashid?: string;
  idx?: string;
  ip_wording?: string;
  is_original?: boolean;
  send_to_fans_num?: number;
  user_name?: string;
  alias?: string;
  signature?: string;
  create_time?: string;
}

/** @deprecated Use Run instead */
export interface AnalysisRun {
  run_id: number;
  task_id: number;
  backend: string;
  workspace_id: number | null;
  status: string;
  error_msg: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: object | null;
  updated_at: string;
}

export interface ProgressEvent {
  type: string;      // stage_start, stage_done, stage_failed, done, failed
  stage?: string;
  elapsed_s?: number;
  error?: string;
  run_id?: number;
}

export interface BackendInfo {
  description: string;
}

export interface AgentBackends {
  backends: Record<string, BackendInfo>;
  default: string;
}

export type StageStatus = "pending" | "running" | "done" | "failed";

export type Stage = string;

export interface AggregationQueueEntry {
  id: number;
  user_id: number;
  username: string | null;
  email: string | null;
  date: string;
  status: "prereq" | "pending" | "running" | "done" | "failed" | "skipped";
  run_id: number | null;
  request_count: number;
  wait_until: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

export interface AggregationRunEntry {
  id: number;
  user_id: number;
  date: string;
  backend: string;
  status: string;
  elapsed_s: number | null;
  error_msg: string | null;
  created_at: string;
}

export interface AggregationStrategy {
  auto_launch: boolean;
  max_concurrency: number;
  default_backend: string;
}

export interface ArticleMeta {
  title: string;
  account: string;
  biz: string | null;
  author: string | null;
  publish_time: string | null;
  url: string;
  cover_url?: string | null;
  digest?: string | null;
}

/**
 * Routing taxonomy (post-2026-05-02):
 *   - "ai_curation"                       — agent wrote a fresh card; replaces original
 *   - "original_content_with_pre_card"    — original article push with an auxiliary card
 *   - "original_content_with_post_card"   — original article push with an auxiliary card
 *   - null                                — pre-routing or in-flight item
 *
 * Earlier names ("original_push" / "reading_guide" / "post_read") are
 * fully migrated by `2026-05-02_rename_to_original_content_with.sql`; UI
 * does not need to handle them.
 */
export type Routing =
  | "ai_curation"
  | "original_content_with_pre_card"
  | "original_content_with_post_card"
  | null;

/** Routings whose UX is "show original article + our agent-written card alongside". */
export const ORIGINAL_ALONGSIDE_ROUTINGS: ReadonlyArray<Exclude<Routing, null>> =
  ["original_content_with_pre_card", "original_content_with_post_card"];

/** Inbox / header display title:
 *   - ai_curation → card title (agent-written, replaces original)
 *   - original_content_with_* → article title (reader is reading the original;
 *     card title is auxiliary and shown only inside the card body)
 *   - null / unknown routing → fall back to card title if any, else article title
 */
export function displayTitleFor(item: {
  title: string;
  routing: Routing;
  article_meta: ArticleMeta;
}): string {
  if (
    item.routing === "original_content_with_pre_card" ||
    item.routing === "original_content_with_post_card"
  ) {
    return item.article_meta.title || item.title;
  }
  return item.title || item.article_meta.title;
}

/** Inline taxonomy reference on each inbox row — denormalized from topic + domain. */
export interface TopicRef {
  id: string;
  label: string;
  domain_id: string;
  domain_label: string;
  domain_latin_label: string | null;
}

export interface InboxItem {
  card_id: string | null;
  article_id: string;
  title: string;
  description: string | null;
  /** Canonical entity names extracted by the agent (companies, products,
   *  papers, lab teams, …) that reconstruct the core event/cognition.
   *  Empty array for legacy / queued items. */
  entities: string[];
  /** Supporting wiki-style entities that recover card body context without
   *  changing the core event/cognition. */
  context_entities?: string[];
  /** Inline map taxonomy (denormalized from topic + domain). Nullable until tagging pipeline lands. */
  topic?: TopicRef | null;
  /** User-visible reading burden: card markdown, plus article markdown for original-content push cards. */
  word_count?: number;
  /** Estimated reading minutes from word_count. Used to size atlas settlements. */
  reading_minutes?: number;
  routing: Routing;
  /**
   * Per-card template name (article_cards.template column):
   *   - ai_curation: one of {event/paper/security_cve/security_event/concept/
   *     tool/company/data_report/interview/analysis}
   *   - original_content_with_pre_card: "pre_card" (forced by routing)
   *   - original_content_with_post_card: "post_card" (forced by routing)
   *   - null for legacy / pre-routing rows
   */
  template: string | null;
  /**
   * Agent's 3-5 sentence rationale for picking this template (manifest.json
   * cards[i].template_reason). Surfaced in admin RunDetailDrawer for prompt
   * tuning + decision audit. Not shown in user-facing card UI.
   */
  template_reason: string | null;
  card_date: string | null;
  read_at: string | null;
  queue_status: "pending" | "running" | null;
  article_meta: ArticleMeta;
  /** Original article HTML for routing ∈ {discard, original_content_with_pre_card, original_content_with_post_card}. */
  additional_content?: string | null;
  /** 'initial' = standard card; 'aggregated'/'residual'/'passthrough' = dedup product. 'deduped' is legacy alias for 'aggregated'. */
  kind?: "initial" | "aggregated" | "passthrough" | "residual" | "deduped";
  source_card_ids?: string[] | null;
  source_article_ids?: string[];
}

export interface DiscardedItem {
  article_id: string;
  title: string;
  routing_reason: string;
  additional_content: string | null;
  card_date: string | null;
  article_meta: ArticleMeta;
}

export interface QueueEntry {
  id: number;
  article_id: string;
  article_title: string;
  article_publish_time: string | null;
  article_account: string | null;
  serving_run_id: number | null;
  status: "pending" | "running" | "done" | "failed" | "locked";
  run_id: number | null;
  routing: string | null;
  routing_reason: string | null;
  fail_reason: string | null;
  is_locked: boolean;
  retry_count: number;
  last_error_type: string | null;
  run_count: number;
  queued_at: string;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Run {
  run_id: number;
  task_id: number;
  backend: string;
  workspace_id: number | null;
  status: string;
  routing: string | null;
  routing_reason: string | null;
  error_msg: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: object | null;
  updated_at: string;
}

/** @deprecated Use Run instead */
export type RunEntry = Run;

export interface RunStreamLine {
  type: string;
  stage?: string;
  elapsed_s?: number;
  error?: string;
  run_id?: number;
  [key: string]: unknown;
}

export interface RunFile {
  name: string;
  size: number;
  is_dir: boolean;
}

export interface FavoriteItem {
  item_type: "card" | "article";
  item_id: string;
  created_at: string;
  title: string | null;
  description: string | null;
  word_count?: number | null;
  reading_minutes?: number | null;
  routing: Routing;
  article_id: string | null;
  article_title: string | null;
  article_account: string | null;
  article_meta: ArticleMeta | null;
}

export interface DedupQueueRow {
  id: number;
  user_id: number;
  card_date: string;
  cluster_signature: string;
  /** pending: previewed, awaiting admin dispatch.
   *  queued:  admin/auto requested dispatch, scheduler will pick up.
   *  running: scheduler spawned a Run for the linked Task.
   *  done/failed: terminal. */
  status: 'pending' | 'queued' | 'running' | 'done' | 'failed';
  task_id: number | null;
  retry_count: number;
  error_msg: string | null;
  last_decision?: {
    run_id: number;
    status: string;
    verdict: "unified" | "mixed" | "independent" | string | null;
    rationale: string | null;
    outputs_count: number;
    aggregated_count: number;
    passthrough_count: number;
    residual_count: number;
    error_msg: string | null;
    completed_at: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface DedupQueueSummary {
  user_id: number;
  date: string;
  n_scanned: number;
  n_clusters: number;
  n_same_article_clusters: number;
  n_singletons: number;
  n_forced_singletons: number;
  n_forced_non_ai_singletons?: number;
  n_missing_embedding_singletons?: number;
  cluster_card_counts: number[];
}

export interface DedupQueueGroup {
  key: string;
  user_id: number;
  card_date: string;
  rows: DedupQueueRow[];
  status: DedupQueueRow['status'];
  created_at: string | null;
  updated_at: string | null;
}

export interface DedupTaskRow {
  task_id: number | null;
  queue_id?: number;
  signature: string;
  status: 'pending' | 'queued' | 'running' | 'done' | 'failed';
  created_at: string | null;
  updated_at: string | null;
  card_dates: string[];
  served_count: number;
  latest_run: {
    run_id: number;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    decision: {
      verdict: "unified" | "mixed" | "independent" | string | null;
      rationale: string | null;
      outputs_count: number;
      aggregated_count: number;
      passthrough_count: number;
      residual_count: number;
      error_msg: string | null;
    } | null;
  } | null;
}

export interface DedupTaskRun {
  run_id: number;
  backend: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_msg: string | null;
}

export interface CardSource {
  card_id: string;
  title: string;
  description: string | null;
  content: string | null;
  word_count?: number | null;
  reading_minutes?: number | null;
  source_article_ids: string[];
  article: {
    short_id: string;
    title: string | null;
    account: string | null;
    publish_time: string | null;
    url: string;
  } | null;
}
