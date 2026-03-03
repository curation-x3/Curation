export interface Article {
  title: string;
  url: string;
  summary: string;
  score: number;
  reason: string;
  source: string;
  published: string;
}

export interface AppSettings {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  userInterests: string;
}

export type View = "feed" | "sources" | "settings";
