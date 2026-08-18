export function usePrintHubApi() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';

  const buildHeaders = options => ({
    'x-telegram-init-data': initData,
    ...(options?.headers || {}),
  });

  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: buildHeaders(options),
    });

    let data = {};
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.reason = data.reason;
      throw error;
    }

    return data;
  };

  const requestBlob = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: buildHeaders(options),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {}
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return response.blob();
  };

  return { tg, initData, request, requestBlob };
}
