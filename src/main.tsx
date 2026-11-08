import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./styles.css";

const queryClient = new QueryClient();

/**
 * Last-resort screen for a render error anywhere in the app. Without it a
 * single throw (for example a WebGL library on a PC without GPU support)
 * unmounted the whole tree and left a black window.
 */
function RootCrash() {
  return (
    <div className="app-crash" role="alert">
      <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Ilovada kutilmagan xatolik yuz berdi</p>
      <p style={{ fontSize: 13, opacity: 0.7, margin: 0, maxWidth: 420 }}>
        Saqlangan javoblaringiz yo&apos;qolmaydi. Ilovani qayta yuklang; xatolik takrorlansa, nazoratchiga murojaat qiling.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-brand"
        style={{ marginTop: 8, padding: "8px 18px", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}
      >
        Qayta yuklash
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<RootCrash />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
