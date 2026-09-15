"use client";

import { useSyncExternalStore } from "react";
import { CHANGE_EVENT, STORAGE_KEY, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  addEventListener(CHANGE_EVENT, onChange);
  return () => removeEventListener(CHANGE_EVENT, onChange);
}

const readTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the choice lasts until the tab closes.
    }
    dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [theme, toggle];
}
