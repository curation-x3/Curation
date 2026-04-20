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
  account_id?: number;
  serving_run_id?: number | null;
  content_source?: "analysis" | "raw" | "empty" | "not_loaded" | "enqueued" | "error";
  cards?: { card_id: string; title: string; content: string; unpushed?: string | any[] }[];
  article_meta?: { title: string; url: string; publish_time: string; author: string; account?: string; account_id?: number; article_id?: string };
  rawHtml?: string;
  contentFormat?: "html" | "markdown";
  word_count?: number;
  read_status?: number;
  dismissed?: number;
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

export interface AnalysisRun {
  id: number;
  article_id: string;
  backend: string;
  workspace_path: string;
  overall_status: string;
  elapsed_s: number | null;
  progress_log: string | null;   // JSON array of progress events
  error_msg: string | null;
  created_at: string;
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
  overall_status: string;
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
  account_id: number | null;
  author: string | null;
  publish_time: string | null;
  url: string;
}

export interface InboxItem {
  card_id: string;
  article_id: string;
  title: string;
  description: string | null;
  routing: "ai_curation" | "original_push";
  article_date: string | null;
  read_at: string | null;
  article_meta: ArticleMeta;
}

export interface DiscardedItem {
  article_id: string;
  title: string;
  routing_reason: string;
  article_date: string | null;
  article_meta: ArticleMeta;
}
