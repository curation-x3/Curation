export interface Account {
  id: number;
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
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
  article_meta?: { title: string; url: string; publish_time: string; author: string; article_id?: string };
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
