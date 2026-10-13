
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/api'

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
  camera_type: 'USB' | 'RTSP' | 'IP'
  stream_url: string
  is_enabled: boolean
  connection_status: string
}

export interface GPSDevice {
  id: number
  name: string
  device_identifier: string
  is_enabled: boolean
  last_latitude: string | null
  last_longitude: string | null
  last_seen_at: string | null
}

export interface Destination {
  id: number
  name: string
  latitude: string
  longitude: string
  address: string
}

export interface TrackingSession {
  id: number
  device: number
  destination: number | null
  status: 'active' | 'paused' | 'stopped'
  started_at: string
  ended_at: string | null
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

  devices: () => request<GPSDevice[]>('/devices/'),
  currentLocation: (id: number) =>
    request(`/devices/${id}/location/`),

  destinations: () => request<Destination[]>('/destinations/'),
  createDestination: (data: Omit<Destination, 'id' | 'created_at'>) =>
    request<Destination>('/destinations/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  sessions: () => request<TrackingSession[]>('/sessions/'),
  startSession: (device: number, destination?: number) =>
    request<TrackingSession>('/sessions/', {
      method: 'POST',
      body: JSON.stringify({
        device,
        ...(destination ? { destination } : {}),
      }),
    }),

  pauseSession: (id: number) =>
    request<TrackingSession>(`/sessions/${id}/pause/`, { method: 'POST' }),
  resumeSession: (id: number) =>
    request<TrackingSession>(`/sessions/${id}/resume/`, { method: 'POST' }),
  stopSession: (id: number) =>
    request<TrackingSession>(`/sessions/${id}/stop/`, { method: 'POST' }),

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
