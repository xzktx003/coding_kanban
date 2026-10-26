// Cold initialization only. Never call this helper in a timed refresh/re-entry.
export async function focusInitialOriginalComposer({
  editor,
  frame,
  mobile = false,
}) {
  const focus = () =>
    mobile ? editor.tap({ timeout: 1500 }) : editor.click({ timeout: 1500 });
  try {
    await focus();
    return false;
  } catch (originalError) {
    const title = frame.getByText("Introducing GPT-6.1 Sol", { exact: true });
    const current = frame.getByRole("button", {
      name: "Continue with current model",
      exact: true,
    });
    if (
      (await title.count()) !== 1 ||
      (await current.count()) !== 1 ||
      !(await title.isVisible()) ||
      !(await current.isVisible())
    )
      throw originalError;
    if (mobile) await current.tap({ timeout: 1500 });
    else await current.click({ timeout: 1500 });
    await focus();
    return true;
  }
}
