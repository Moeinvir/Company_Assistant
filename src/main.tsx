import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
// Persian / Arabic-script glyphs (Inter has none, so the browser falls through to this).
import "@fontsource-variable/vazirmatn";
import "./styles/globals.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Root container is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
