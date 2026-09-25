import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import App from "./App";

const root = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(root);
