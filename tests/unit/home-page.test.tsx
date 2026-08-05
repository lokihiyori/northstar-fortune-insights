import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("Home", () => {
  it("renders the product name as the top-level heading", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "NorthStar Fortune Insights",
    );
  });

  it("describes the Phase 0 foundation in an accessible region", () => {
    render(<Home />);

    const section = screen.getByRole("region", { name: "Foundation in place" });
    expect(section).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
