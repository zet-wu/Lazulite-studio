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
      root.innerHTML =
        "<main style='display:grid;place-content:center;min-height:100vh;gap:12px;text-align:center'><p>开发模拟服务启动失败，请重试。</p><button id='reload'>重新加载</button></main>";
      document
        .getElementById("reload")
        ?.addEventListener("click", () => window.location.reload());
    });
} else render();
