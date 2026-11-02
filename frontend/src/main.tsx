import { i18n } from "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./shared/tokens.css";
const root = document.getElementById("root")!;
const render = () =>
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === "true") {
  import("./mocks/browser")
    .then(({ startMocks }) => startMocks())
    .then(render)
    .catch(() => {
      const main=document.createElement('main');
      main.style.cssText='display:grid;place-content:center;min-height:100vh;gap:12px;text-align:center';
      const text=document.createElement('p'),button=document.createElement('button');
      text.textContent=i18n.t('startup.mockFailed');button.textContent=i18n.t('common.reload');
      button.id='reload';button.dataset.role='secondary';main.append(text,button);root.replaceChildren(main);
      document
        .getElementById("reload")
        ?.addEventListener("click", () => window.location.reload());
    });
} else render();
