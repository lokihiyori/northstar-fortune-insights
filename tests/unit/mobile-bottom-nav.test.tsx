import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAV, MobileBottomNav } from "@/components/navigation/app-sidebar";

/**
 * The bottom bar previously rendered `APP_NAV.slice(0, 4)` and nothing else, so
 * Compass and Plan had no mobile entry — and the sidebar that carries them is
 * `hidden md:block`. A phone had no route to either page.
 */

const route = vi.hoisted(() => ({ current: "/app" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.current,
}));

beforeEach(() => {
  route.current = "/app";
});

function moreButton() {
  return screen.getByRole("button", { name: "More" });
}

describe("MobileBottomNav", () => {
  it("keeps the four primary destinations directly on the bar", () => {
    render(<MobileBottomNav />);

    for (const item of APP_NAV.slice(0, 4)) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("starts collapsed and reports that state", () => {
    render(<MobileBottomNav />);

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Compass" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("exposes every remaining destination behind More", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    await user.click(moreButton());

    expect(moreButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Compass" })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/app/billing");
  });

  it("reaches every sidebar destination from the bar, directly or behind More", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);
    await user.click(moreButton());

    // The real guarantee: nothing in APP_NAV is unreachable on a phone.
    for (const item of APP_NAV) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("closes after a destination behind More is activated", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    await user.click(moreButton());
    await user.click(screen.getByRole("link", { name: "Compass" }));

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Compass" })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    await user.click(moreButton());
    await user.keyboard("{Escape}");

    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(moreButton()).toHaveFocus();
  });

  it("is operable from the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    moreButton().focus();
    await user.keyboard("{Enter}");

    expect(moreButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Plan" })).toBeVisible();
  });

  it("marks the current primary destination", () => {
    route.current = "/app/history";
    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ask" })).not.toHaveAttribute("aria-current");
  });

  it("does not hide the current route behind an unmarked More control", async () => {
    route.current = "/app/profile";
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    // The bar must still say where the user is, even when that page is nested.
    expect(moreButton().className).toContain("text-brand-teal");

    await user.click(moreButton());
    const panel = screen.getByRole("link", { name: "Compass" });
    expect(panel).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
  });

  it("treats /app as exact so a nested route does not mark the dashboard", () => {
    route.current = "/app/history";
    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the primary bar reachable while More is open", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);
    await user.click(moreButton());

    const nav = screen.getByRole("navigation", { name: "Application" });
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toBeVisible();
  });
});
