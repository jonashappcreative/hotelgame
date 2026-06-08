import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyTheme, getStoredThemeId } from "./lib/themePreview";

// TEST-ONLY: apply the stored green/turquoise preview theme before first paint
// so there's no flash of the old blue palette.
applyTheme(getStoredThemeId());

createRoot(document.getElementById("root")!).render(<App />);
