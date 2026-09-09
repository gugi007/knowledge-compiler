"use client";

import { useEffect, useRef } from "react";

type MathJaxApi = {
  typesetClear?: (nodes?: HTMLElement[]) => void;
  typesetPromise?: (nodes?: HTMLElement[]) => Promise<void>;
};

declare global {
  interface Window {
    MathJax?: MathJaxApi & Record<string, unknown>;
  }
}

const MATHJAX_SCRIPT_ID = "knowledge-compiler-mathjax";

function ensureMathJax(): Promise<MathJaxApi | undefined> {
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);

  window.MathJax = {
    tex: {
      inlineMath: [["$", "$"], ["\\(", "\\)"]],
      displayMath: [["$$", "$$"], ["\\[", "\\]"]],
      processEscapes: true,
    },
    svg: { fontCache: "global" },
  } as MathJaxApi & Record<string, unknown>;

  const existing = document.getElementById(MATHJAX_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      if (window.MathJax?.typesetPromise) resolve(window.MathJax);
      else existing.addEventListener("load", () => resolve(window.MathJax), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = MATHJAX_SCRIPT_ID;
    script.async = true;
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
    script.addEventListener("load", () => resolve(window.MathJax), { once: true });
    script.addEventListener("error", () => resolve(undefined), { once: true });
    document.head.appendChild(script);
  });
}

export function LatexText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    const node = ref.current;
    if (!node || (!children.includes("$") && !children.includes("\\("))) return;

    void ensureMathJax().then(async (mathJax) => {
      if (cancelled || !node || !mathJax?.typesetPromise) return;
      mathJax.typesetClear?.([node]);
      await mathJax.typesetPromise([node]);
    });

    return () => {
      cancelled = true;
    };
  }, [children]);

  return (
    <span className={`inline-block max-w-full align-baseline [&_mjx-container]:max-w-full [&_mjx-container]:overflow-x-auto ${className ?? ""}`} ref={ref}>
      {children}
    </span>
  );
}
