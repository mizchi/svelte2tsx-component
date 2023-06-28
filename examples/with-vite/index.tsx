import React from "react";
import App from "./App.svelte";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root")!;

createRoot(root).render(<App
  name="svelte-app"
  onMessage={(data) => {
    console.log("message received", data)
  }
} />);
