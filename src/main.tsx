import "./lib/diagnostics/consoleCapture";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./lib/authStore";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
