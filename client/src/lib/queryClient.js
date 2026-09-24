import { QueryClient } from "@tanstack/react-query";
async function throwIfResNotOk(res) {
    if (!res.ok) {
        let message = `${res.status}: ${res.statusText}`;
        try {
            const body = await res.json();
            if (body?.error) {
                message = body.error;
            } else if (body?.message) {
                message = body.message;
            }
        } catch {
            const text = await res.text();
            if (text) message = text;
        }
        throw new Error(message);
    }
}
export async function apiRequest(method, url, data) {
    const res = await fetch(url, {
        method,
        headers: data ? { "Content-Type": "application/json" } : {},
        body: data ? JSON.stringify(data) : undefined,
        credentials: "include",
    });
    await throwIfResNotOk(res);
    return res;
}
export const getQueryFn = ({ on401: unauthorizedBehavior }) => async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/"), {
        credentials: "include",
    });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
    }
    await throwIfResNotOk(res);
    return await res.json();
};
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            queryFn: getQueryFn({ on401: "throw" }),
            refetchInterval: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: false,
        },
        mutations: {
            retry: false,
        },
    },
});
