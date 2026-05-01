export interface CRMClient {
  get(path: string, params?: Record<string, string>): Promise<unknown>
  post(path: string, body?: unknown): Promise<unknown>
  patch(path: string, params?: Record<string, string>, body?: unknown): Promise<unknown>
  del(path: string, params?: Record<string, string>): Promise<unknown>
}

export function initClient(): CRMClient {
  const baseUrl = process.env.CRM_API_URL?.replace(/\/$/, '')
  const apiKey = process.env.CRM_API_KEY

  if (!baseUrl || !apiKey) {
    throw new Error('Missing required env vars: CRM_API_URL, CRM_API_KEY')
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  async function request(url: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(url, { ...init, headers })
    const text = await res.text()
    if (!res.ok) throw new Error(`CRM API error ${res.status}: ${text}`)
    return text ? JSON.parse(text) : null
  }

  function buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(`${baseUrl}/${path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    return url.toString()
  }

  return {
    get: (path, params) => request(buildUrl(path, params), { method: 'GET' }),
    post: (path, body) => request(buildUrl(path), { method: 'POST', body: JSON.stringify(body ?? {}) }),
    patch: (path, params, body) => request(buildUrl(path, params), { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
    del: (path, params) => request(buildUrl(path, params), { method: 'DELETE' }),
  }
}
