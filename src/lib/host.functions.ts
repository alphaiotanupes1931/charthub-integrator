import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";

export const getHost = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return getRequestHost() ?? "";
  } catch {
    return "";
  }
});
