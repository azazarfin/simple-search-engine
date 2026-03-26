/**
 * main.jsx — Application Entry Point
 * ------------------------------------
 * This is the standard Vite + React entry point.
 * It renders the root <App /> component into the DOM element with id="root".
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
