import { describe, expect, it } from "vitest";
import { classifyAuthDeletion } from "./account-deletion";

describe("classifyAuthDeletion", () => {
  it("treats a plain success as deleted", () => {
    expect(
      classifyAuthDeletion({
        data: { message: "User deleted" },
        error: null,
      }),
    ).toBe("deleted");
  });

  it("recognises the email-confirmation flow", () => {
    expect(
      classifyAuthDeletion({
        data: { message: "Verification email sent" },
        error: null,
      }),
    ).toBe("confirm-by-email");
  });

  it("reports an error as the sign-in being kept", () => {
    expect(
      classifyAuthDeletion({
        data: null,
        error: { status: 404, message: "Not Found" },
      }),
    ).toBe("sign-in-kept");
  });

  it("reports a missing body as the sign-in being kept", () => {
    expect(classifyAuthDeletion({ data: null, error: null })).toBe(
      "sign-in-kept",
    );
  });
});
