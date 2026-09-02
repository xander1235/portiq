export interface RequestResponse {
  status: number;
  statusText: string;
  duration: number;
  time?: number;
  headers: Record<string, string>;
  body: string;
  json: any;
  error: string | null;
  size: number;
  cancelled?: boolean;
  timedOut?: boolean;
  httpVersion?: string;
}

export interface RequestConfig {
  protocol?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  [key: string]: any;
}
