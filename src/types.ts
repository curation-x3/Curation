export interface Account {
  id: number;
  biz: string;
  name: string;
  avatar_url?: string;
  description?: string;
}

export interface Article {
  id: number;
  title: string;
  url: string;
  publish_time: string;
  digest?: string;
  cover_url?: string;
  author?: string;
  account?: string;
  markdown?: string;
  html_path?: string;
  markdown_path?: string;
  account_id?: number;
  serving_run_id?: number | null;
  content_source?: "analysis" | "raw" | "empty";
}

export interface AnalysisRun {
  id: number;
  article_id: number;
  agent_commit_hash: string;
  agent_commit_message: string;
  backend: string;
  workspace_path: string;
  deconstruct_status: string;
  deconstruct_elapsed_s: number | null;
  evaluate_status: string;
  evaluate_elapsed_s: number | null;
  synthesize_status: string;
  synthesize_elapsed_s: number | null;
  write_status: string;
  write_elapsed_s: number | null;
  overall_status: string;
  error_msg: string | null;
  created_at: string;
}

export interface BackendInfo {
  canonical_id: string;
  description: string;
}

export interface AgentManifest {
  stages: string[];
  backends: Record<string, BackendInfo>;
  default_backend?: string;
}

export interface AgentVersion {
  hash: string;
  short_hash: string;
  message: string;
  date: string;
  manifest?: AgentManifest;
}

export type StageStatus = "pending" | "running" | "done" | "failed";

export type Stage = string;
