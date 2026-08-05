import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/(marketing)/page";

describe("LandingPage", () => {
  it("leads with the product promise as the top-level heading", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Turn uncertainty into a path you can act on.",
    );
  });

  it("offers both a primary and a sample-viewing call to action", () => {
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Explore my options" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(screen.getByRole("link", { name: "View a sample insight" })).toHaveAttribute(
      "href",
      "/examples",
    );
  });

  it("never claims a guaranteed or predicted outcome", () => {
    const { container } = render(<LandingPage />);
    const text = container.textContent ?? "";

    for (const banned of ["guarantee", "predict your", "destiny", "will happen"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });
});
