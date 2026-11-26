import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CenterOverview from "./CenterOverview";
import StudentResults from "./StudentResults";

vi.mock("@/lib/api", () => ({
  get: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
}));

describe("Admin analytics truthfulness", () => {
  it("CenterOverview renders zero hardcoded fake lab or incident numbers when offline", () => {
    const html = renderToStaticMarkup(<CenterOverview onNavigate={() => {}} />);
    expect(html).not.toContain("Across 3 active labs");
    expect(html).not.toContain("4 total computer labs");
    expect(html).not.toContain("98.2% completion rate");
    expect(html).not.toContain("2 blurs, 1 shortcut blocked");
    expect(html).toContain("0 computer labs reported");
    expect(html).toContain("Awaiting lab telemetry");
  });

  it("StudentResults renders honest empty prediction state without fake scores", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <StudentResults />
      </QueryClientProvider>,
    );
    expect(html).not.toContain("62 / 75 pts");
    expect(html).not.toContain("Reading — Matching Headings");
    expect(html).toContain("No center-wide weak module predictions returned by the backend yet.");
  });
});
