/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BESTWAY_API_URL?: string;
  readonly VITE_API_URL?: string;
  readonly BESTWAY_WEB_URL?: string;
  readonly VITE_WEB_URL?: string;
  /** "true" only for a deliberate demo build: shows the sample students and room in Live Proctoring. */
  readonly VITE_DEMO_DATA?: string;
}
