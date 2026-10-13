
import { useEffect, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, useMapEvents,
  Polyline, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
  Camera, Check, Crosshair, LocateFixed, Pause, Play,
  RefreshCw, Search, Square, Video, X, AlertTriangle, Wifi,
  ZoomIn, ZoomOut,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { api, type Camera as ApiCamera, type Destination } from './services/api'
import CameraStream from "./components/CameraStream";

type Point = [number, number]
type CameraType = 'USB / Webcam' | 'RTSP Camera' | 'External / IP'
type TrackingState = 'Idle' | 'Tracking' | 'Paused' | 'Stopped'

const iconFor = (color: string) =>
  new L.DivIcon({
    className: '',
    html: `<div style="width:15px;height:15px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 5px ${color}33"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7],
  })

const gpsIcon = iconFor('#22d3ee')
const destinationIcon = iconFor('#fb7185')

function MapInteractions({
  onPick,
}: {
  onPick: (point: Point) => void
}) {
  useMapEvents({
    click(e) {
      onPick([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

function MapFocus({ point }: { point: Point | null }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.flyTo(point, 15, { duration: 0.8 })
  }, [point, map])
  return null
}

function MapZoomEvents() {
  const map = useMap()

  useEffect(() => {
    const zoomIn = () => map.zoomIn()
    const zoomOut = () => map.zoomOut()

    window.addEventListener('map-zoom-in', zoomIn)
    window.addEventListener('map-zoom-out', zoomOut)

    return () => {
      window.removeEventListener('map-zoom-in', zoomIn)
      window.removeEventListener('map-zoom-out', zoomOut)
    }
  }, [map])

  return null
}


function Section({
  title, subtitle, icon, action, children,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[18px] border border-[#1d3153] bg-[#0d192f]">
      <div className="flex min-h-[50px] flex-wrap items-center justify-between gap-2 border-b border-[#1d3153] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-cyan-400">{icon}</span>
          <div>
            <h2 className="text-[13px] font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[10px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, color = 'text-slate-100' }: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1d3153] bg-[#111f39] px-3 py-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-xs font-medium ${color}`}>{value}</p>
    </div>
  )
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<'Connected' | 'Disconnected' | 'Connecting...'>('Connecting...')
  const [cameras, setCameras] = useState<ApiCamera[]>([])
  const [apiError, setApiError] = useState('')
  const [savedDestinations, setSavedDestinations] = useState<Destination[]>([])

  const [cameraType, setCameraType] = useState<CameraType>('USB / Webcam')
  const [cameraMenu, setCameraMenu] = useState(true)
  const [cameraStatus, setCameraStatus] = useState('Disconnected')
  const [cameraError, setCameraError] = useState('')
  const [cameraLoading, setCameraLoading] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [hlsPlaylistUrl, setHlsPlaylistUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraUrl, setCameraUrl] = useState('')
  const [gps, setGps] = useState<Point | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [gpsStatus, setGpsStatus] = useState('Waiting for permission')
  const [gpsError, setGpsError] = useState('')
  const [destination, setDestination] = useState<Point | null>(null)
  const [destinationText, setDestinationText] = useState('')
  const [tracking, setTracking] = useState<TrackingState>('Idle')
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    api.health()
      .then(() => {
        if (!cancelled) setBackendStatus('Connected')
      })
      .catch(() => {
        if (!cancelled) setBackendStatus('Disconnected')
      })

    api.cameras()
      .then(data => {
        if (!cancelled) {
          setCameras(data)
          setApiError('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiError('Unable to load cameras from Django.')
        }
      })

    api.destinations()
      .then(data => {
        if (!cancelled) setSavedDestinations(data)
      })
      .catch(() => {
        if (!cancelled) {
          setApiError('Unable to load saved destinations.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      void videoRef.current.play().catch(() => {
        setCameraError('Camera connected, but playback could not start.')
      })
    }
  }, [stream])

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    stream?.getTracks().forEach(track => track.stop())
    if (activeStreamId) {
      void api.stopStream(activeStreamId).catch(() => {})
    }
  }, [stream, activeStreamId])

  async function connectCamera() {
    setCameraError('')

    if (cameraType === 'USB / Webcam') {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access requires localhost or HTTPS.')
        return
      }

      setCameraLoading(true)
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        setStream(media)
        setHlsPlaylistUrl(null)
        setActiveStreamId(null)
        setCameraStatus('Streaming')
        setCameraMenu(false)
      } catch (error) {
        setCameraStatus('Disconnected')
        setCameraError(error instanceof Error ? error.message : 'Unable to access webcam.')
      } finally {
        setCameraLoading(false)
      }
      return
    }

    if (!cameraUrl.trim()) {
      setCameraError('Please provide an RTSP stream URL.')
      return
    }

    setCameraLoading(true)
    setCameraStatus('Connecting...')
    try {
      const res = await api.startStream(cameraUrl.trim())
      if (res.status === 'failed') {
        const detail = res.error_detail ? `: ${res.error_detail}` : ''
        throw new Error(`Camera stream connection failed${detail}`)
      }
      const baseUrl = import.meta.env.VITE_API_BASE_URL
        ? new URL(import.meta.env.VITE_API_BASE_URL).origin
        : 'http://127.0.0.1:8000'
      const fullPlaylist = res.playlist.startsWith('http')
        ? res.playlist
        : `${baseUrl}${res.playlist}`

      setActiveStreamId(res.stream_id)

      let isReady = res.ready ?? false
      let attempts = 0
      const maxAttempts = 35

      while (!isReady && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 600))
        attempts++
        setCameraStatus(`Buffering stream (${attempts * 2}s)...`)
        try {
          const statusRes = await api.streamStatus(res.stream_id)
          if (statusRes.status === 'failed') {
            const detail = statusRes.error_detail ? `: ${statusRes.error_detail}` : ''
            throw new Error(`Camera stream connection failed${detail}`)
          }
          if (statusRes.ready) {
            isReady = true
          }
        } catch (pollErr) {
          if (pollErr instanceof Error && pollErr.message.includes('Camera stream')) {
            throw pollErr
          }
        }
      }

      if (!isReady) {
        throw new Error('Timed out waiting for camera to produce video segments. Verify the phone is broadcasting and reachable.')
      }

      setHlsPlaylistUrl(fullPlaylist)
      setStream(null)
      setCameraStatus('Streaming')
      setCameraMenu(false)
    } catch (error) {
      setCameraStatus('Disconnected')
      setCameraError(error instanceof Error ? error.message : 'Failed to start RTSP stream on backend.')
    } finally {
      setCameraLoading(false)
    }
  }

  function disconnectCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
    if (activeStreamId) {
      void api.stopStream(activeStreamId).catch(() => {})
      setActiveStreamId(null)
      setHlsPlaylistUrl(null)
    }
    setCameraStatus('Disconnected')
    setCameraError('')
  }

  function startGps() {
    if (!navigator.geolocation) {
      setGpsStatus('Unavailable')
      setGpsError('Geolocation is not supported by this browser.')
      return
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)

    setGpsError('')
    setGpsStatus('Requesting permission')
    setWatching(true)
    watchId.current = navigator.geolocation.watchPosition(
      result => {
        const point: Point = [result.coords.latitude, result.coords.longitude]
        setGps(point)
        setAccuracy(result.coords.accuracy)
        setLastUpdate(new Date(result.timestamp).toLocaleTimeString())
        setGpsStatus(result.coords.accuracy > 100 ? 'Low accuracy' : 'GPS locked')
      },
      error => {
        setGpsStatus(error.code === 1 ? 'Permission denied' : 'GPS unavailable')
        setGpsError(
          error.code === 1
            ? 'Location permission denied. Enable location access in your browser settings.'
            : error.code === 3
              ? 'GPS timed out. Check your device location settings and retry.'
              : 'Current location is unavailable.',
        )
        setWatching(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
  }

  function stopGps() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    setWatching(false)
    setGpsStatus('Not connected')
  }

  async function searchDestination() {
    if (!destinationText.trim()) return
    setGpsError('')
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(destinationText)}`,
      )
      if (!response.ok) throw new Error('Search service unavailable')
      const results = await response.json()
      if (!results.length) {
        setGpsError('No destination found. Try another place.')
        return
      }
      setDestination([Number(results[0].lat), Number(results[0].lon)])
    } catch {
      setGpsError('Destination search failed. Check your connection and try again.')
    }
  }

  const origin = gps
  const route = origin && destination ? [origin, destination] as Point[] : []
  const connected = cameraStatus === 'Streaming'

  return (
    <main className="min-h-screen bg-[#07111f] px-3 py-4 text-slate-200 sm:px-5">
      <div className="mx-auto max-w-[1800px] space-y-3.5">

        {/* Header */}
        <header className="rounded-[18px] border border-[#1d3153] bg-[#0d192f] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-cyan-400" />
              <div>
                <h1 className="text-sm font-bold text-slate-100">Sentinel Track</h1>
                <p className="text-[10px] text-slate-500">Camera Tracking & Live GPS Monitoring</p>
              </div>
              <div className="ml-2 hidden items-center gap-2 rounded-lg border border-[#1d3153] bg-[#111f39] px-3 py-2 text-[11px] sm:flex">
                <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-slate-500'}`} />
                {connected ? 'Camera connected' : 'Waiting for devices'}
                <span className="text-slate-500">• {backendStatus === 'Connected' ? 'API connected' : 'API pending'}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-medium">Monitoring Operator</p>
                <p className="mt-1 text-[10px] text-slate-500">Local dashboard</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1b3053] text-xs font-semibold">ST</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-[#1d3153] pt-3 text-[10px] text-slate-500">
            <p>Project: <span className="text-slate-300">Camera & GPS Monitoring</span> • Region: <span className="text-slate-300">Device location</span> • Refresh: 5s</p>
            <p>
              Backend:{' '}
              <span className={
                backendStatus === 'Connected'
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }>
                {backendStatus}
              </span>
            </p>
          </div>
        </header>

        <p className="px-1 text-[10px] text-slate-500">
          <span className="mr-1 text-emerald-400">▮ Systems status</span>
          • Camera: {cameraStatus} • GPS: {gpsStatus} • {lastUpdate ? `Last sync ${lastUpdate}` : 'Waiting for location data'}
        </p>
        {apiError && (
          <p role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300">
            <AlertTriangle size={13} className="mr-1 inline" />{apiError}
          </p>
        )}

        {/* Main workspace */}
        <div className="grid grid-cols-1 items-stretch gap-3.5 xl:grid-cols-2">

          {/* Camera */}
          <div className="space-y-3.5">
            <Section title="Camera monitoring" icon={<Video size={15} />} action={
              <span className={`rounded-md border px-2 py-1 text-[10px] ${connected ? 'border-emerald-900 bg-emerald-950/40 text-emerald-400' : 'border-slate-700 text-slate-400'}`}>
                ● {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            }>
              <div className="p-3.5">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[#1d3153] bg-[#040a13]">
                  {stream ? (
                    <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
                  ) : hlsPlaylistUrl ? (
                    <CameraStream playlistUrl={hlsPlaylistUrl} />
                  ) : (
                    <div className="px-5 text-center">
                      <Camera size={32} className="mx-auto mb-3 text-slate-600" />
                      <p className="text-xs font-medium text-slate-300">No active camera feed</p>
                      <p className="mt-1 text-[10px] text-slate-500">Connect a webcam or RTSP stream to view live video</p>
                    </div>
                  )}

                  <span className="absolute left-2.5 top-2.5 z-10 rounded-md border border-[#1d3153] bg-black/70 px-2 py-1 text-[10px]">
                    {connected ? 'LIVE' : 'NO SIGNAL'}
                  </span>
                  {connected && (
                    <span className="absolute right-2.5 top-2.5 z-10 rounded-md bg-cyan-400 px-2 py-1 text-[10px] font-semibold text-slate-950">
                      {stream ? 'Webcam' : 'RTSP / HLS'}
                    </span>
                  )}
                  <span className="absolute bottom-2.5 left-2.5 z-10 rounded-md border border-[#1d3153] bg-black/70 px-2.5 py-2 text-[10px] text-slate-400">
                    {stream
                      ? 'Browser webcam connected'
                      : hlsPlaylistUrl
                        ? 'RTSP stream active'
                        : 'Camera details unavailable'}
                  </span>
                </div>

                {cameraError && <p role="alert" className="mt-2 rounded-lg border border-rose-900 bg-rose-950/30 p-2.5 text-[11px] text-rose-300">{cameraError}</p>}

                <button onClick={() => setCameraMenu(v => !v)} className="mt-3 w-full rounded-lg bg-cyan-400 py-2.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300">
                  <Camera size={14} className="mr-2 inline" /> Select camera source
                </button>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Metric label="Status" value={cameraStatus} color={connected ? 'text-emerald-400' : 'text-slate-300'} />
                  <Metric label="Latency" value="Not measured" />
                  <Metric label="Storage" value="Not configured" />
                </div>

                <div className="mt-3 rounded-xl border border-[#1d3153] bg-[#111f39] p-3">
                  <div className="mb-2 flex justify-between gap-2 text-[10px]">
                    <span className="font-medium text-slate-200">Compact controls</span>
                    <span className="text-slate-500">PTZ • Exposure • Audio</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['Pan', 'Tilt', 'Zoom +', 'Disconnect'].map(control => (
                      <button key={control} onClick={() => control === 'Disconnect' ? disconnectCamera() : setCameraError('PTZ control requires a compatible camera and backend integration.')} className="rounded-lg border border-[#1d3153] bg-[#0d192f] px-2 py-2 text-[10px] text-slate-300 hover:border-cyan-700">
                        {control}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">Camera controls become available when supported by the connected device.</p>
                </div>
              </div>
            </Section>

            {/* Camera selector */}
            {cameraMenu && (
              <Section title="Select camera source" subtitle="Choose how to connect your live feed" icon={<Camera size={15} />} action={
                <button aria-label="Close camera selection" onClick={() => setCameraMenu(false)} className="text-slate-400"><X size={15} /></button>
              }>
                <div className="space-y-3 p-3.5">
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['USB / Webcam', 'Browser access'],
                      ['RTSP Camera', 'Stream URL'],
                      ['External / IP', 'Network camera'],
                    ] as const).map(([type, desc]) => (
                      <button key={type} onClick={() => setCameraType(type)} className={`min-w-0 rounded-lg border p-2.5 text-center ${cameraType === type ? 'border-cyan-500 bg-[#193253]' : 'border-[#1d3153] bg-[#111f39]'}`}>
                        <p className="text-[10px] font-semibold">{type}</p>
                        <p className="mt-1 text-[9px] text-slate-500">{desc}</p>
                        {cameraType === type && <Check size={12} className="mx-auto mt-1 text-cyan-300" />}
                      </button>
                    ))}
                  </div>
                  {cameraType !== 'USB / Webcam' && (
                    <label className="block text-[10px] text-slate-400">
                      Stream URL
                      <input value={cameraUrl} onChange={e => setCameraUrl(e.target.value)} placeholder="rtsp://camera-host:554/stream" className="mt-1.5 w-full rounded-lg border border-[#1d3153] bg-[#091422] px-3 py-2.5 text-xs outline-none focus:border-cyan-500" />
                    </label>
                  )}
                  {cameras.length > 0 && (
                    <div className="rounded-lg border border-[#1d3153] bg-[#091422] p-2.5">
                      <p className="mb-1 text-[10px] font-medium text-slate-400">Configured Backend Cameras:</p>
                      <div className="flex flex-wrap gap-1">
                        {cameras.map(cam => (
                          <button
                            key={cam.id}
                            type="button"
                            onClick={() => {
                              setCameraUrl(cam.stream_url)
                              if (cam.camera_type === 'USB') setCameraType('USB / Webcam')
                              else if (cam.camera_type === 'RTSP') setCameraType('RTSP Camera')
                              else setCameraType('External / IP')
                            }}
                            className="rounded border border-[#1d3153] bg-[#111f39] px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-400"
                          >
                            {cam.name} ({cam.camera_type})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={connectCamera} disabled={cameraLoading} className="flex-1 rounded-lg bg-cyan-400 py-2.5 text-xs font-semibold text-slate-950 disabled:opacity-50">
                      {cameraLoading ? <RefreshCw size={13} className="mr-1 inline animate-spin" /> : <Wifi size={13} className="mr-1 inline" />}
                      {cameraLoading ? 'Connecting...' : 'Connect camera'}
                    </button>
                    <button onClick={() => setCameraMenu(false)} className="rounded-lg border border-[#1d3153] px-3 text-xs text-slate-300">Cancel</button>
                  </div>
                  <p className="text-center text-[10px] text-slate-500">Real device access only — no simulated feed when offline.</p>
                </div>
              </Section>
            )}
          </div>

          {/* GPS */}
          <Section title="Live GPS tracking" icon={<Crosshair size={15} />} action={
            <span className="text-[10px] text-slate-500">Auto-refresh target: 5s</span>
          }>
            <div className="p-3.5">
              <div className="flex gap-2">
                <input value={destinationText} onChange={e => setDestinationText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchDestination() }} placeholder="Search destination or place..." className="min-w-0 flex-1 rounded-lg border border-[#1d3153] bg-[#111f39] px-3 py-2.5 text-xs outline-none focus:border-cyan-500" />
                <button onClick={() => void searchDestination()} className="rounded-lg bg-[#1b3053] px-3 text-xs hover:bg-[#27416b]"><Search size={14} className="inline" /> Search</button>
              </div>
              {savedDestinations.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Saved:</span>
                  {savedDestinations.map(d => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setDestination([Number(d.latitude), Number(d.longitude)])
                        setDestinationText(d.name)
                      }}
                      className="rounded border border-[#1d3153] bg-[#111f39] px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
              <p className="mb-2 mt-2 text-[10px] text-slate-500">Tap the map to drop a destination pin • Search a place above</p>

              <div className="relative h-[270px] overflow-hidden rounded-xl border border-[#1d3153] sm:h-[310px]">
                <MapContainer center={gps ?? [19.076, 72.8777]} zoom={gps ? 14 : 12} scrollWheelZoom className="h-full w-full">
                  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <MapInteractions onPick={setDestination} />
                  <MapFocus point={destination} />
                  <MapZoomEvents />
                  {gps && <Marker position={gps} icon={gpsIcon}><Popup>Current GPS position</Popup></Marker>}
                  {destination && <Marker position={destination} icon={destinationIcon}><Popup>Selected destination</Popup></Marker>}
                  {route.length === 2 && <Polyline positions={route} pathOptions={{ color: '#22d3ee', weight: 4, opacity: 0.85, dashArray: '8 7' }} />}
                </MapContainer>
                <div className="absolute right-2 top-2 z-[500] flex flex-col gap-1">
                  <button title="Zoom in" onClick={() => window.dispatchEvent(new CustomEvent('map-zoom-in'))} className="rounded-md border border-[#1d3153] bg-[#0d192f] p-2 text-slate-300"><ZoomIn size={14} /></button>
                  <button title="Zoom out" onClick={() => window.dispatchEvent(new CustomEvent('map-zoom-out'))} className="rounded-md border border-[#1d3153] bg-[#0d192f] p-2 text-slate-300"><ZoomOut size={14} /></button>
                </div>
                <div className="absolute bottom-2 left-2 z-[500] rounded-md border border-[#1d3153] bg-[#091422]/95 px-2.5 py-2 text-[10px]">
                  <p className="font-mono text-slate-300">{gps ? `${gps[0].toFixed(5)}° N, ${gps[1].toFixed(5)}° E` : 'GPS coordinates unavailable'}</p>
                  <p className={`mt-1 ${gps ? 'text-emerald-400' : 'text-amber-400'}`}>● {gps ? `${gpsStatus} • ±${Math.round(accuracy ?? 0)} m` : gpsStatus}</p>
                </div>
              </div>

              {gpsError && <p role="alert" className="mt-2 rounded-lg border border-amber-900 bg-amber-950/30 p-2.5 text-[11px] text-amber-300"><AlertTriangle size={13} className="mr-1 inline" />{gpsError}</p>}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Metric label="Distance" value={route.length ? 'Route pending' : '—'} />
                <Metric label="ETA" value="—" />
                <Metric label="Route done" value="—" color="text-emerald-400" />
              </div>

              <div className="mt-3">
                <div className="mb-2 flex justify-between text-[10px]">
                  <span className="text-slate-500">Route progress</span>
                  <span className="text-slate-300">Waiting for route service</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#172641]">
                  <div className="h-full w-0 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <button disabled={!gps || tracking === 'Tracking'} onClick={() => { setTracking('Tracking'); setGpsError('') }} className="rounded-lg bg-emerald-500 py-2.5 text-[11px] font-semibold text-slate-950 disabled:opacity-40"><Play size={12} className="mr-1 inline" />Start</button>
                <button disabled={tracking !== 'Tracking'} onClick={() => setTracking('Paused')} className="rounded-lg bg-[#1b3053] py-2.5 text-[11px] disabled:opacity-40"><Pause size={12} className="mr-1 inline" />Pause</button>
                <button disabled={tracking !== 'Paused'} onClick={() => setTracking('Tracking')} className="rounded-lg border border-cyan-700 py-2.5 text-[11px] text-cyan-300 disabled:opacity-40"><Play size={12} className="mr-1 inline" />Resume</button>
                <button disabled={tracking === 'Idle' || tracking === 'Stopped'} onClick={() => { setTracking('Stopped'); stopGps() }} className="rounded-lg border border-rose-800 py-2.5 text-[11px] text-rose-300 disabled:opacity-40"><Square size={11} className="mr-1 inline" />Stop</button>
              </div>

              <div className="mt-3 rounded-xl border border-[#1d3153] bg-[#111f39] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-slate-200">Tracking timeline</p>
                  <span className={`rounded-full px-2 py-1 text-[9px] ${tracking === 'Tracking' ? 'bg-emerald-950 text-emerald-400' : 'bg-[#172641] text-slate-400'}`}>● {tracking}</span>
                </div>
                <div className="mt-3 flex gap-2.5">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-slate-500">Last GPS update: {lastUpdate ?? 'No readings received'}</p>
                    <p className="mt-1 break-all text-[10px] text-slate-300">{gps ? `${gps[0].toFixed(5)}, ${gps[1].toFixed(5)}` : 'Current position not available'}</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-[#1d3153] pt-2 text-[10px] text-slate-500">
                  Permission: <span className={gps ? 'text-emerald-400' : 'text-amber-400'}>{gps ? 'Granted' : 'Not confirmed'}</span>
                  <span className="float-right">GPS accuracy: {accuracy !== null ? `±${Math.round(accuracy)} m` : '—'}</span>
                </div>
              </div>
              <button onClick={startGps} disabled={watching} className="mt-3 rounded-lg border border-[#1d3153] px-3 py-2 text-[10px] text-slate-300 disabled:opacity-40"><LocateFixed size={13} className="mr-1 inline" />{watching ? 'GPS active' : 'Enable GPS'}</button>
            </div>
          </Section>
        </div>

        {/* Status footer */}
        <footer className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { color: 'bg-cyan-400', text: `GPS ${gps ? 'connected' : 'waiting'} • real browser readings only` },
            { color: 'bg-cyan-400', text: `Route ${destination ? 'destination selected' : 'waiting for destination'}` },
            { color: 'bg-amber-400', text: `Location: ${gpsError ? 'check error above' : gps ? 'available' : 'permission pending'}` },
            { color: 'bg-rose-400', text: `Camera: ${connected ? 'connected' : 'not connected'}` },
          ].map(item => (
            <div key={item.text} className="flex items-center gap-2 rounded-lg border border-[#1d3153] bg-[#0d192f] px-3 py-3 text-[10px] text-slate-500">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.color}`} />{item.text}
            </div>
          ))}
        </footer>
      </div>
    </main>
  )
}
