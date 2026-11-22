import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./EmptyState";
import { StatCard } from "./StatCard";
import { StatusBadge } from "./StatusBadge";
import { WorkspaceTable } from "./WorkspaceTable";

describe("UI Primitives (Stage 05.1 Design System)", () => {
  describe("EmptyState", () => {
    it("renders title, description and action button", () => {
      const html = renderToStaticMarkup(
        <EmptyState
          title="Hech narsa topilmadi"
          description="Qidiruv bo'yicha ma'lumot yo'q."
          action={{ label: "Qayta urinish", onClick: () => {} }}
        />
      );

      expect(html).toContain("Hech narsa topilmadi");
      expect(html).toContain("Qidiruv bo&#x27;yicha ma&#x27;lumot yo&#x27;q.");
      expect(html).toContain("Qayta urinish");
      expect(html).toContain("role=\"status\"");
    });
  });

  describe("StatCard", () => {
    it("renders standard KPI metrics", () => {
      const html = renderToStaticMarkup(
        <StatCard
          label="Faol Sinflar"
          value={12}
          sub="O'quv guruhlari"
          accent={true}
        />
      );

      expect(html).toContain("Faol Sinflar");
      expect(html).toContain("12");
      expect(html).toContain("O&#x27;quv guruhlari");
      expect(html).toContain("text-emerald-400");
    });

    it("renders error state with retry button when query fails", () => {
      const html = renderToStaticMarkup(
        <StatCard
          label="Tekshirish Navbati"
          value={0}
          isError={true}
          onRetry={() => {}}
        />
      );

      expect(html).toContain("Yuklab bo‘lmadi · Qayta urinish ⟳");
      expect(html).toContain("text-red-400");
    });
  });

  describe("StatusBadge", () => {
    it("renders badges with proper semantic variants", () => {
      const brandHtml = renderToStaticMarkup(
        <StatusBadge variant="brand">Faol</StatusBadge>
      );
      expect(brandHtml).toContain("workspace-badge-brand");
      expect(brandHtml).toContain("Faol");

      const amberHtml = renderToStaticMarkup(
        <StatusBadge variant="amber">Kutilmoqda</StatusBadge>
      );
      expect(amberHtml).toContain("workspace-badge-amber");
      expect(amberHtml).toContain("Kutilmoqda");

      const dangerHtml = renderToStaticMarkup(
        <StatusBadge variant="danger">Xato</StatusBadge>
      );
      expect(dangerHtml).toContain("workspace-badge-danger");
      expect(dangerHtml).toContain("Xato");
    });
  });

  describe("WorkspaceTable", () => {
    it("renders table inside a scrollable accessible region", () => {
      const html = renderToStaticMarkup(
        <WorkspaceTable ariaLabel="O'quvchilar ro'yxati">
          <thead>
            <tr>
              <th>Ism</th>
              <th>Ball</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ali Valiyev</td>
              <td>85</td>
            </tr>
          </tbody>
        </WorkspaceTable>
      );

      expect(html).toContain("role=\"region\"");
      expect(html).toContain("aria-label=\"O&#x27;quvchilar ro&#x27;yxati\"");
      expect(html).toContain("Ali Valiyev");
      expect(html).toContain("workspace-table");
    });
  });
});
