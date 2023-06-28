import type { ComponentType } from "react";

declare const App: ComponentType<{
  name: string;
  onMessage: (data: { data: string }) => void;
}>;
export default App;
