/**
 * Forwards a request to the backend and always returns valid JSON,
 * even if the backend is down or replies with an empty / non-JSON body.
 */
export async function proxyToBackend(
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 200) };
      }
    } else if (!response.ok) {
      data = { message: `Backend responded with status ${response.status}.` };
    }

    return Response.json(data, { status: response.status });
  } catch {
    return Response.json(
      {
        message: `Cannot reach the backend at ${baseUrl}. Make sure the backend server is running.`,
      },
      { status: 502 }
    );
  }
}