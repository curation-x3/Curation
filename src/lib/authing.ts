import { Authing } from "@authing/browser";

const appId = import.meta.env.VITE_AUTHING_APP_ID as string;
// domain: full URL, e.g. "https://your-app.authing.cn"
const domain = import.meta.env.VITE_AUTHING_DOMAIN as string;
const redirectUri = import.meta.env.VITE_AUTHING_REDIRECT_URI as string;

if (!appId || !domain) {
  console.warn("[Authing] VITE_AUTHING_APP_ID or VITE_AUTHING_DOMAIN not set");
}

export const authingClient = new Authing({
  appId,
  domain,
  redirectUri,
  scope: "openid profile email phone",
});

// Tauri WKWebView may clear sessionStorage across origin navigations during redirect flow.
// Patch the internal transactionProvider (PKCE state) to use localStorage which persists.
(authingClient as any).transactionProvider = {
  get: (key: string) => {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  },
  put: (key: string, val: unknown) => {
    localStorage.setItem(key, JSON.stringify(val));
  },
  delete: (key: string) => {
    localStorage.removeItem(key);
  },
};
