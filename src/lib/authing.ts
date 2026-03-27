import Authing from "@authing/browser";

const appId = import.meta.env.VITE_AUTHING_APP_ID as string;
const appHost = import.meta.env.VITE_AUTHING_APP_HOST as string;
const redirectUri = import.meta.env.VITE_AUTHING_REDIRECT_URI as string;

if (!appId || !appHost) {
  console.warn("[Authing] VITE_AUTHING_APP_ID or VITE_AUTHING_APP_HOST not set");
}

export const authingClient = new Authing({
  appId,
  appHost,
  redirectUri,
});
