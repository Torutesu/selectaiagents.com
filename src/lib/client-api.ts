"use client";
export async function api<T = Record<string, unknown>>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Proxies and crashes can answer with HTML or an empty body. Parse leniently
  // so users see the status-based message instead of "Unexpected token <".
  const text = await response.text();
  let data: {
    error?: {
      message?: string;
      details?: { path: string[]; message: string }[];
    };
  } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (response.ok) throw new Error("The server sent an unreadable response.");
  }
  if (!response.ok)
    throw new Error(
      data.error?.details
        ?.map(
          (issue: { path: string[]; message: string }) =>
            `${issue.path.join(" ")}: ${issue.message}`,
        )
        .join(" · ") ||
        data.error?.message ||
        "Request failed. Please try again.",
    );
  return data as T;
}
