
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : '/api')

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `API request failed: ${response.status}`)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

export interface Camera {
  id: number
  name: string
  camera_type: 'USB' | 'RTSP'
  stream_url: string
  is_enabled: boolean
  connection_status: string
}

export interface StreamResult {
  stream_id: string
  status: string
  playlist: string
  ready?: boolean
  error_detail?: string | null
}

export const api = {
  health: () => request<{ api: string; database: string }>('/health/'),

  cameras: () => request<Camera[]>('/cameras/'),
  createCamera: (data: Partial<Camera>) =>
    request<Camera>('/cameras/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  startStream: (rtsp_url: string) =>
    request<StreamResult>('/streams/start/', {
      method: 'POST',
      body: JSON.stringify({ rtsp_url }),
    }),
  streamStatus: (stream_id: string) =>
    request<StreamResult>(`/streams/${stream_id}/status/`),
  stopStream: (stream_id: string) =>
    request<{ stream_id: string; status: string }>(`/streams/${stream_id}/stop/`, {
      method: 'POST',
    }),
}
