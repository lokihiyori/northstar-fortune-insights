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

/**
 * Matched on a prefix, because the accessible name is itself under test: it
 * gains ", current section" when the route sits behind the disclosure. The
 * assertions below use exact names to tell the two states apart — Testing
 * Library matches a string `name` in full, so `"More"` never matches
 * `"More, current section"`.
 */
function moreButton() {
  return screen.getByRole("button", { name: /^More/ });
}

/**
 * Whitespace-tolerant, because engines disagree on separator insertion between
 * a text node and an inline element. Measured: jsdom yields
 * "More, current section" and Chrome yields "More , current section". Both
 * speak identically, so one pattern serves the unit and browser suites alike.
 */
const CURRENT_SECTION_NAME = /^More\s*,\s*current section$/;

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

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("expands with %s and lands Tab on Compass, then Plan", async (_label, key) => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    moreButton().focus();
    expect(moreButton()).toHaveFocus();

    await user.keyboard(key);
    expect(moreButton()).toHaveAttribute("aria-expanded", "true");

    // The whole point of H1: the revealed links are the *next* stops.
    await user.tab();
    expect(screen.getByRole("link", { name: "Compass" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Plan" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(moreButton()).toHaveFocus();
  });

  it("marks the current primary destination", () => {
    route.current = "/app/history";
    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ask" })).not.toHaveAttribute("aria-current");
  });

  it("announces the current section on the control, not just in colour", async () => {
    route.current = "/app/profile";
    const user = userEvent.setup();
    render(<MobileBottomNav />);

    /*
     * The accessible name, not a class. Teal + font-weight is a visual channel
     * only; asserting the utility class proved nothing a user perceives and
     * broke on any token rename.
     */
    expect(screen.getByRole("button", { name: CURRENT_SECTION_NAME })).toBeInTheDocument();

    await user.click(moreButton());
    // aria-current="page" belongs on the thing that navigates, not the toggle.
    expect(screen.getByRole("link", { name: "Compass" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
    expect(moreButton()).not.toHaveAttribute("aria-current");
  });

  it("does not claim a current section from a primary destination", () => {
    route.current = "/app/history";
    render(<MobileBottomNav />);

    // Exact match: "More" must not match "More, current section".
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("marks a nested route under a secondary destination as the current section", () => {
    route.current = "/app/billing/invoices";
    render(<MobileBottomNav />);

    expect(screen.getByRole("button", { name: CURRENT_SECTION_NAME })).toBeInTheDocument();
  });

  it("keeps the disclosure target in the document so aria-controls always resolves", () => {
    render(<MobileBottomNav />);

    const panel = document.getElementById(moreButton().getAttribute("aria-controls") ?? "");
    expect(panel, "aria-controls points at nothing while collapsed").not.toBeNull();
    // Hidden, therefore out of the tab order and the accessibility tree.
    expect(panel).toHaveAttribute("hidden");
  });

  it("orders the revealed links after the trigger in the DOM", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNav />);
    await user.click(moreButton());

    const compass = screen.getByRole("link", { name: "Compass" });
    const position = moreButton().compareDocumentPosition(compass);

    /*
     * Sequential focus follows DOM order. With the panel before the bar, Tab
     * from More left the nav entirely and the revealed links sat seven stops
     * behind it.
     */
    expect(
      position & Node.DOCUMENT_POSITION_FOLLOWING,
      "Compass must come after More in the DOM, or Tab skips past it",
    ).toBeTruthy();
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
