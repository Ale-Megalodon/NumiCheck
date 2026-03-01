import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "./app/providers/AuthProvider";
import { AppEntry } from "./app/layouts/AppEntry";
import { AppErrorBoundary } from "./shared/components/ui/AppErrorBoundary";
import "./shared/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <AppEntry />
        </AuthProvider>
      </HashRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
