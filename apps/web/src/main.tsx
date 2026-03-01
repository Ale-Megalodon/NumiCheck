import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./app/providers/AuthProvider";
import { AppEntry } from "./app/layouts/AppEntry";
import "./shared/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppEntry />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
