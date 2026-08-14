import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
// Tokens first: theme.css is written entirely in var(--baud-*) and needs the
// custom properties defined before it. Generated from tokens/tokens.json.
import "./tokens/tokens.generated.css";
import "./theme.css";

const container = document.getElementById("root");

if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
