export async function postJson(url, body, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {})
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function getJson(url, options = {}) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler() {
  return (error, _req, res, _next) => {
    const status = error.status && Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: error.message
    });
  };
}
