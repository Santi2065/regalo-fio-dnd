import React from "react";
import ReactDOM from "react-dom/client";
import PlayerDisplay from "./pages/PlayerDisplay";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PlayerDisplay />
  </React.StrictMode>,
);
