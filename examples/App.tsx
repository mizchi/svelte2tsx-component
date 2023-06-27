import React, {useEffect, useRef, Fragment} from "react";
import {css} from "@linaria/core";



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
      className={red}
    >
      Hello World
      {props.children}
    </div>
  </>;
}

const red = css`
  color: red; 
`;

