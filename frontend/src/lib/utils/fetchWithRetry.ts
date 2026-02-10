/**
 * Fetch with Retry
 *
 * 带有指数退避重试的 fetch 工具函数
 */

export interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  maxRetryDelay?: number;
  timeout?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export class FetchError extends Error {
  status?: number;
  statusText?: string;
  response?: Response;

  constructor(message: string, response?: Response) {
    super(message);
    this.name = "FetchError";
    this.response = response;
    this.status = response?.status;
    this.statusText = response?.statusText;
  }
}

/**
 * Fetch with automatic retry on failure
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with retry configuration
 * @returns Promise<Response>
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    retries = 3,
    retryDelay = 1000,
    maxRetryDelay = 10000,
    timeout = 30000,
    onRetry,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Throw on non-ok responses (4xx, 5xx)
      if (!response.ok) {
        throw new FetchError(`HTTP ${response.status}: ${response.statusText}`, response);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on abort or if this was the last attempt
      if (error instanceof Error && error.name === "AbortError") {
        throw new FetchError("Request timeout");
      }

      if (attempt < retries) {
        // Calculate delay with exponential backoff
        const delay = Math.min(retryDelay * Math.pow(2, attempt), maxRetryDelay);

        // Call retry callback
        onRetry?.(attempt + 1, lastError);

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Fetch failed after retries");
}

/**
 * Fetch JSON with retry
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with retry configuration
 * @returns Promise<T>
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return response.json();
}

/**
 * Post JSON with retry
 *
 * @param url - The URL to post to
 * @param data - The data to send
 * @param options - Fetch options with retry configuration
 * @returns Promise<T>
 */
export async function postJsonWithRetry<T>(
  url: string,
  data: unknown,
  options: FetchWithRetryOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    method: "POST",
    body: JSON.stringify(data),
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return response.json();
}

export default fetchWithRetry;
