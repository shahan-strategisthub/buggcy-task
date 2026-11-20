import { useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}, user?: number): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (user) headers.set('X-User-Id', String(user));
  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.code, data.message);
  return data;
}

export function useResource<T>(path: string | null, revision = 0) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    request<T>(path, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setResult({ path, data }); },
      (error: Error) => { if (!controller.signal.aborted) setResult({ path, error: error.message }); },
    );
    return () => controller.abort();
  }, [path, revision]);
  return result?.path === path ? result : undefined;
}

export function send<T>(path: string, user: number, body?: object, method = 'POST') {
  return request<T>(path, { method, body: body ? JSON.stringify(body) : undefined }, user);
}
