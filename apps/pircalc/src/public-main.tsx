import React from "react";
import ReactDOM from "react-dom/client";
import { PublicPirApp } from "./PublicPirApp";
import "./styles/app.css";

document.body.classList.add("public-pir-body");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PublicPirApp />
  </React.StrictMode>,
);
