import { proxyToBackend } from "@/lib/proxyToBackend";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return proxyToBackend("/auth/login", { body });
}