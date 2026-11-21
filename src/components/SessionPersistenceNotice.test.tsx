// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionPersistenceNotice } from "./SessionPersistenceNotice";
import { useSessionStore } from "@/lib/session-store";
import { setAppLanguage } from "@/lib/ui-prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useSessionStore.setState({ persistence: "native", status: "logged-out" });
});

describe("SessionPersistenceNotice", () => {
  it("warns a signed-in user in the selected language when the session is memory-only", () => {
    setAppLanguage("en");
    useSessionStore.setState({ persistence: "memory_only", status: "ready" });
    act(() => root.render(<SessionPersistenceNotice />));
    expect(host.textContent).toContain("sign in again after closing the app");
    act(() => setAppLanguage("uz"));
    expect(host.textContent).toContain("qayta kirishingiz kerak");
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("");
  });

  it("stays hidden with native persistence or when signed out", () => {
    useSessionStore.setState({ persistence: "native", status: "ready" });
    act(() => root.render(<SessionPersistenceNotice />));
    expect(host.textContent).toBe("");
    useSessionStore.setState({ persistence: "memory_only", status: "logged-out" });
    act(() => root.render(<SessionPersistenceNotice />));
    expect(host.textContent).toBe("");
  });
});
