import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryModal } from "../retry-modal";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: /reintentar/i });
  await user.click(trigger);
}

describe("RetryModal", () => {
  it("muestra cantidad de prompts completados", async () => {
    const user = userEvent.setup();
    render(
      <RetryModal runId="r1" totalPrompts={10} lastSucceededPromptIndex={3} failedAtIndex={4} />,
    );
    await openModal(user);
    expect(await screen.findByText(/4 de 10 prompts/)).toBeInTheDocument();
  });

  it("opción resume está disabled y default es start cuando lastSucceededPromptIndex es null", async () => {
    const user = userEvent.setup();
    render(
      <RetryModal runId="r1" totalPrompts={5} lastSucceededPromptIndex={null} failedAtIndex={0} />,
    );
    await openModal(user);
    const resumeRadio = await screen.findByDisplayValue("resume");
    expect(resumeRadio).toBeDisabled();
    const startRadio = screen.getByDisplayValue("start");
    expect(startRadio).toBeChecked();
  });

  it("click en Reintentar hace POST con from=resume", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "new-run" }),
      }),
    );

    render(
      <RetryModal runId="r1" totalPrompts={10} lastSucceededPromptIndex={3} failedAtIndex={4} />,
    );
    await openModal(user);
    await user.click(screen.getByTestId("retry-submit"));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/runs/r1/retry?from=resume",
        expect.objectContaining({ method: "POST" }),
      );
    });
    vi.unstubAllGlobals();
  });

  it("click con mode=start hace POST con from=start", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "new-run" }),
      }),
    );

    render(
      <RetryModal runId="r1" totalPrompts={10} lastSucceededPromptIndex={3} failedAtIndex={4} />,
    );
    await openModal(user);
    await user.click(screen.getByDisplayValue("start"));
    await user.click(screen.getByTestId("retry-submit"));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/runs/r1/retry?from=start",
        expect.objectContaining({ method: "POST" }),
      );
    });
    vi.unstubAllGlobals();
  });

  it("error de API muestra mensaje de error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "foo" } }),
      }),
    );

    render(
      <RetryModal runId="r1" totalPrompts={10} lastSucceededPromptIndex={null} failedAtIndex={0} />,
    );
    await openModal(user);
    await user.click(screen.getByTestId("retry-submit"));

    expect(await screen.findByText("foo")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("respuesta exitosa redirige a /dashboard/runs/<newId>", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "new-run-id" }),
      }),
    );

    render(
      <RetryModal runId="r1" totalPrompts={10} lastSucceededPromptIndex={3} failedAtIndex={4} />,
    );
    await openModal(user);
    await user.click(screen.getByTestId("retry-submit"));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/runs/new-run-id");
    });
    vi.unstubAllGlobals();
  });
});
