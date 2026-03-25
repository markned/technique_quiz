import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerGlobalAudioUnlock } from "./lib/audioUnlock";
import "./styles.css";

registerGlobalAudioUnlock();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
