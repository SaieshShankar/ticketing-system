import { proxyToBackend } from "@/lib/proxyToBackend";

export async function POST(request: Request) {
  const refreshToken = request.headers.get("x-refresh-token");

  if (!refreshToken) {
    return Response.json({ message: "Missing refresh token." }, { status: 401 });
  }

  return proxyToBackend("/auth/refresh", {
    headers: { "x-refresh-token": refreshToken },
  });
}