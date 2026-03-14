declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}

declare module "*.png" {
  const value: string;
  export default value;
}

declare global {
  interface RequestResponse {
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
    httpVersion?: string;
  }

  interface RequestConfig {
    protocol?: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    [key: string]: any;
  }

  interface Window {
    __cm_show_replace?: boolean;
    api: {
      ping: () => Promise<string>;

      // HTTP
      sendRequest: (payload: RequestConfig) => Promise<RequestResponse>;
      sendHttpRequest: (payload: any) => Promise<any>; // Used in some protocols
      cancelRequest: (payload: any) => Promise<any>;

      // GraphQL
      sendGraphQL: (payload: any) => Promise<any>;

      // WebSocket
      wsConnect: (payload: any) => Promise<any>;
      wsSend: (payload: any) => Promise<any>;
      wsDisconnect: (payload: any) => Promise<any>;
      wsGetMessages: (payload: any) => Promise<any>;
      onWsMessage: (callback: (data: any) => void) => () => void;
      onWsClosed: (callback: (data: any) => void) => () => void;
      onWsError: (callback: (data: any) => void) => () => void;

      // Mock Server
      mockStart: (payload: any) => Promise<any>;
      mockStop: (payload: any) => Promise<any>;
      mockList: () => Promise<any>;
      mockUpdateRoutes: (payload: any) => Promise<any>;

      // Database / Persistence
      saveState: (key: string, value: any) => Promise<any>;
      loadState: (key: string) => Promise<any>;
      clearAllData: () => Promise<any>;
      getDataPath: () => Promise<string>;

      // Others
      onGithubAuth: (callback: (url: string) => void) => void;
    };
  }
}

export {};
