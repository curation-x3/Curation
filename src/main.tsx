import ReactDOM from "react-dom/client";
import App from "./App";
import CardFormatPreview from "./CardFormatPreview";
import { AuthProvider } from "./lib/authStore";

const isPreview = window.location.search.includes("preview");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isPreview ? (
    <CardFormatPreview />
  ) : (
    <AuthProvider>
      <App />
    </AuthProvider>
  ),
);
