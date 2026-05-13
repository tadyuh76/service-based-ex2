async function requestJson(url, options = {}, serviceName = "service") {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  const init = {
    method: options.method || "GET",
    headers
  };

  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, init);
    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `${serviceName} returned HTTP ${response.status}`,
        data: payload
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: `${serviceName} is unavailable`,
      data: { detail: error.message }
    };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

module.exports = {
  requestJson
};
