import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./apply.css";
import ApplyApp from "./ApplyApp";
import "./visual-theme.css";
document.body.classList.add("apply-console");

// apply.atriveo.com — the application-engine console, admin only.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApplyApp />
  </StrictMode>,
);
