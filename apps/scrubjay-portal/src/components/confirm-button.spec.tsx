// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

describe("ConfirmButton", () => {
  it("does not fire the action until confirmed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        confirmTitle="Delete subscription?"
        label="Delete"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not fire when cancelled", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        confirmTitle="Sure?"
        label="Remove"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
