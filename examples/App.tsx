import React, {useEffect, useRef, Fragment} from "react";

export function App(props: {children?: React.ReactNode}) {

  const _ref = useRef(false);
  useEffect(() => {
    // skip first render
    if (!_ref.current) {
      _ref.current = true;
      return;
    }
    console.log('after update');
  });
  return <>
    {console.log('render')}
    <div
      className=""
    >
      Hello World
      {props.children}
    </div>
  </>;
}