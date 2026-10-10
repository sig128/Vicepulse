import { createRoot } from "react-dom/client";
import "@fontsource/anton/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import { App } from "./App.tsx";
import { loadBrandFont } from "./lib/brandFont.ts";
import { watchFonts } from "./lib/readiness.ts";

watchFonts(loadBrandFont());
createRoot(document.getElementById("root")!).render(<App />);
