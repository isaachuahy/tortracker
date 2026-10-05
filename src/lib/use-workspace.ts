"use client";
import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "./types";
export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Please try again.");
  return body;
}
export function useWorkspace() {
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await request<Workspace>("/api/workspace"));
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load your notebook.",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, error, refresh };
}
export function jsonPost(data: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}
