import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { AccountDeletionDialog } from "./components/AccountDeletionDialog";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
    <AccountDeletionDialog />
  </React.StrictMode>,
);
