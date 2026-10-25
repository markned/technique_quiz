import React from "react";
import ReactDOM from "react-dom/client";
import { registerGlobalAudioUnlock } from "./lib/audioUnlock";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

registerGlobalAudioUnlock();

async function bootstrap() {
  const root = document.getElementById("root")!;
  if (import.meta.env.DEV && window.location.pathname === "/simulate") {
    const { MultiplayerSimulation } = await import("./dev/MultiplayerSimulation");
    ReactDOM.createRoot(root).render(<MultiplayerSimulation />);
  } else if (/\/community\/?$/.test(window.location.pathname)) {
    const { CommunityApp } = await import("./community/CommunityApp");
    await import("./editor/editor.css");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ErrorBoundary>
          <CommunityApp />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } else if (import.meta.env.DEV && /\/editor\/?$/.test(window.location.pathname)) {
    sessionStorage.removeItem("technique_quiz_preview_return");
    const { RoundEditorApp } = await import("./editor/RoundEditorApp");
    await import("./editor/editor.css");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <RoundEditorApp />
      </React.StrictMode>,
    );
  } else {
    const { loadCommunityCatalog } = await import("./community/api");
    await loadCommunityCatalog();
    const { default: App } = await import("./App");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  }
}

void bootstrap();
