import React, {useEffect, useRef} from "react";

export function App() {

  const _ref = useRef(false);
  useEffect(() => {
    // skip first render
    if (!_ref.current) {
      _ref.current = true;
      return;
    }
    console.log('after update');
  });
  return <div>Hello World</div>;
}