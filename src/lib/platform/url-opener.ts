import * as tauriImpl from "./url-opener.tauri";
import * as webImpl from "./url-opener.web";

const impl = __IS_WEB__ ? webImpl : tauriImpl;

export const openExternal = impl.openExternal;
