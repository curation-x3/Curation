import * as tauriImpl from "./dialog.tauri";
import * as webImpl from "./dialog.web";

const impl = __IS_WEB__ ? webImpl : tauriImpl;

export const openFolderPicker = impl.openFolderPicker;
