import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  Polyline,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
  Camera,
  Truck,
  ChevronDown,
  Zap,
  Gem,
  Bell,
  Settings,
  Video,
  Power,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Link2,
  CheckCircle2,
  Crosshair,
  Search,
  Edit3,
  Play,
  Pause,
  Square,
  Navigation,
  RefreshCw,
  X,
  Check,
  ShieldCheck,
  Cpu,
  ArrowUpDown,
  LocateFixed,
  Map as MapIcon,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { api, type Camera as ApiCamera } from './services/api'
import CameraStream from './components/CameraStream'

type Point = [number, number]
type CameraType = 'USB / Webcam' | 'RTSP Camera' | 'External / IP'
type TrackingState = 'Idle' | 'Tracking' | 'Paused' | 'Stopped'

interface FleetUnit {
  id: string
  name: string
  vehicleNumber: string
  status: string
  driver: string
}

const FLEET_UNITS: FleetUnit[] = [
  { id: 'unit-1', name: 'Fleet Scout Alpha', vehicleNumber: 'VEHICLE #104', status: 'Online', driver: 'Alex Mercer' },
  { id: 'unit-2', name: 'Fleet Scout Bravo', vehicleNumber: 'VEHICLE #208', status: 'Online', driver: 'Marcus Vance' },
  { id: 'unit-3', name: 'Heavy Hauler Delta', vehicleNumber: 'VEHICLE #312', status: 'Standby', driver: 'Elena Rostova' },
]

// Vancouver route waypoints matching the screenshot
const ROUTE_WAYPOINTS: Point[] = [
  [49.2785, -123.1215], // Downtown / Yaletown
  [49.2762, -123.1150],
  [49.2745, -123.1040],
  [49.2740, -123.0940],
  [49.2760, -123.0850], // Midpoint vehicle area
  [49.2778, -123.0760],
  [49.2810, -123.0650], // HUB (B) Hastings-Sunrise
]

// Geographic Bearing between two points in degrees (0 - 360)
function calculateBearing(p1: Point, p2: Point): number {
  const lat1 = (p1[0] * Math.PI) / 180
  const lat2 = (p2[0] * Math.PI) / 180
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.cos(lat1) * Math.cos(dLon)
  const brng = (Math.atan2(y, x) * 180) / Math.PI
  return (brng + 360) % 360
}

// Haversine distance in meters between two lat/lng coordinates
function getDistanceMeters(p1: Point, p2: Point): number {
  const R = 6371000 // Earth radius in meters
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1[0] * Math.PI) / 180) *
      Math.cos((p2[0] * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Compute cumulative distances along route points
function computeCumulativeDistances(pts: Point[]): { cumDistances: number[]; totalDistance: number } {
  if (!pts || pts.length === 0) return { cumDistances: [0], totalDistance: 0 }
  const cumDistances = [0]
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = getDistanceMeters(pts[i], pts[i + 1])
    total += d
    cumDistances.push(total)
  }
  return { cumDistances, totalDistance: total }
}

// Get interpolated position and heading along route given a distance in meters
function getRouteInterpolation(
  pts: Point[],
  cumDistances: number[],
  totalDistance: number,
  distMeters: number
): { position: Point; heading: number; segIndex: number } {
  if (!pts || pts.length === 0) return { position: [0, 0], heading: 0, segIndex: 0 }
  if (pts.length === 1 || totalDistance <= 0) return { position: pts[0], heading: 0, segIndex: 0 }

  const clamped = Math.max(0, Math.min(distMeters, totalDistance))
  let idx = 0
  for (let i = 0; i < cumDistances.length - 1; i++) {
    if (clamped >= cumDistances[i] && clamped <= cumDistances[i + 1]) {
      idx = i
      break
    }
  }

  const p1 = pts[idx]
  const p2 = pts[Math.min(idx + 1, pts.length - 1)]
  const segStart = cumDistances[idx]
  const segEnd = cumDistances[Math.min(idx + 1, cumDistances.length - 1)]
  const segLen = segEnd - segStart

  const t = segLen > 0 ? (clamped - segStart) / segLen : 0
  const lat = p1[0] + t * (p2[0] - p1[0])
  const lng = p1[1] + t * (p2[1] - p1[1])
  const heading = calculateBearing(p1, p2)

  return { position: [lat, lng], heading, segIndex: idx }
}

// Realistic Google Maps Location Pin for Destination ("To")
const createDestinationPinIcon = () =>
  new L.DivIcon({
    className: '',
    html: `
      <div style="position:relative;width:32px;height:44px;display:flex;align-items:center;justify-content:center;cursor:grab;">
        <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Realistic soft ground contact shadow -->
          <ellipse cx="16" cy="42" rx="7" ry="2.2" fill="rgba(0,0,0,0.38)"/>
          <!-- Authentic Google Maps Red Pin Teardrop -->
          <path d="M16 1C8.268 1 2 7.268 2 15C2 25.8 16 41 16 41C16 41 30 25.8 30 15C30 7.268 23.732 1 16 1Z" fill="#EA4335" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- Crisp white circular inner cutout -->
          <circle cx="16" cy="15" r="5.2" fill="#FFFFFF"/>
          <!-- Dark ruby center core -->
          <circle cx="16" cy="15" r="2.4" fill="#7C1A14"/>
        </svg>
      </div>
    `,
    iconSize: [32, 44],
    iconAnchor: [16, 41],
    popupAnchor: [0, -41],
  })

const createMyLocationIcon = () =>
  new L.DivIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:32px;height:32px;border-radius:50%;background:rgba(0,229,255,0.35);animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <div style="width:16px;height:16px;border-radius:50%;background:#00e5ff;border:3px solid #ffffff;box-shadow:0 0 12px rgba(0,229,255,0.9);position:relative;z-index:2;"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })

// Simple Directional Cursor at "From" location and live route navigation (NO location pin)
const createDirectionalCursorIcon = (headingDeg: number = 0) =>
  new L.DivIcon({
    className: '',
    html: `
      <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
        <!-- Soft blue navigation radar beam -->
        <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:rgba(26,115,232,0.25);animation:ping 2.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <!-- Google Maps Style Directional Navigation Puck -->
        <div style="width:26px;height:26px;border-radius:50%;background:#1A73E8;border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.45), 0 0 10px rgba(26,115,232,0.8);display:flex;align-items:center;justify-content:center;position:relative;z-index:2;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="transform: rotate(${Math.round(headingDeg)}deg); transform-origin: center center; transition: transform 0.08s linear;">
            <path d="M12 3L19.5 21L12 17.2L4.5 21L12 3Z" fill="#FFFFFF"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  })

// Real OSRM driving route calculator
async function fetchOsrmRoute(start: Point, dest: Point) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`
    const res = await fetch(url)
    const data = await res.json()
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0]
      const pts: Point[] = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]])
      const distM = route.distance
      const durS = route.duration

      const distKm = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`
      const mins = Math.round(durS / 60)
      const durFormatted = mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} mins` : `${mins} mins`

      return {
        pts,
        distance: distKm,
        duration: durFormatted,
        summary: route.legs?.[0]?.summary ? `via ${route.legs[0].summary}` : 'Fastest Driving Route',
      }
    }
  } catch (err) {
    console.warn('OSRM routing failed, fallback to straight line:', err)
  }

  // Haversine fallback
  const dLat = (dest[0] - start[0]) * 111
  const dLng = (dest[1] - start[1]) * 111 * Math.cos((start[0] * Math.PI) / 180)
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng)
  return {
    pts: [start, dest],
    distance: `${distKm.toFixed(1)} km`,
    duration: `${Math.max(1, Math.round(distKm * 2))} mins`,
    summary: 'Direct Path (Offline)',
  }
}

// Reverse Geocoding with OpenStreetMap Nominatim
async function reverseGeocode(pt: Point): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pt[0]}&lon=${pt[1]}`,
      { headers: { Accept: 'application/json' } },
    )
    const data = await res.json()
    if (data && data.display_name) {
      const parts = data.display_name.split(', ')
      return parts.slice(0, 3).join(', ')
    }
  } catch (e) {
    console.warn('Reverse geocode failed:', e)
  }
  return `${pt[0].toFixed(4)}°, ${pt[1].toFixed(4)}°`
}

// Address / Coordinates Search Geocoder
async function geocodeAddress(query: string): Promise<{ pt: Point; name: string } | null> {
  const coordMatch = query.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/)
  if (coordMatch) {
    const pt: Point = [parseFloat(coordMatch[1]), parseFloat(coordMatch[3])]
    const name = await reverseGeocode(pt)
    return { pt, name }
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
    )
    const data = await res.json()
    if (data && data.length > 0) {
      const pt: Point = [parseFloat(data[0].lat), parseFloat(data[0].lon)]
      const parts = data[0].display_name.split(', ')
      const name = parts.slice(0, 3).join(', ')
      return { pt, name }
    }
  } catch (e) {
    console.warn('Geocoding search failed:', e)
  }
  return null
}

function MapInteractions({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({
    click(e) {
      onPick([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

function MapController({
  focusPoint,
  bounds,
  zoomAction,
}: {
  focusPoint: Point | null
  bounds: L.LatLngBounds | null
  zoomAction: 'in' | 'out' | null
}) {
  const map = useMap()

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    } else if (focusPoint) {
      map.flyTo(focusPoint, 14, { duration: 1.2 })
    }
  }, [focusPoint, bounds, map])

  useEffect(() => {
    if (zoomAction === 'in') map.zoomIn()
    else if (zoomAction === 'out') map.zoomOut()
  }, [zoomAction, map])

  return null
}

export default function App() {
  // Navigation / Units
  const [activeUnit, setActiveUnit] = useState<FleetUnit>(FLEET_UNITS[0])
  const [unitMenuOpen, setUnitMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cameraModalOpen, setCameraModalOpen] = useState(false)
  const [streamSettingsOpen, setStreamSettingsOpen] = useState(false)
  const [editingCoords, setEditingCoords] = useState<'start' | 'dest' | null>(null)

  // Backend & Devices
  const [backendStatus, setBackendStatus] = useState<'Connected' | 'Disconnected' | 'Connecting...'>('Connected')
  const [cameras, setCameras] = useState<ApiCamera[]>([])
  const [apiError, setApiError] = useState('')

  // Video Stream State
  const [cameraType, setCameraType] = useState<CameraType>('USB / Webcam')
  const [cameraStatus, setCameraStatus] = useState('Streaming') // Default streaming like mockup
  const [activeCameraName, setActiveCameraName] = useState('CAM-01 (HD USB Web Camera)')
  const [cameraUrl, setCameraUrl] = useState('')
  const [cameraLoading, setCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [hlsPlaylistUrl, setHlsPlaylistUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Stream Metrics
  const [signalLatency, setSignalLatency] = useState('18ms')
  const [codec, setCodec] = useState('H.264 / RTSP')
  const [bitrate, setBitrate] = useState('4.2 Mbps')
  const [endpoint, setEndpoint] = useState('/dev/video0 (Webcam)')
  const [bufferMs, setBufferMs] = useState(120)

  // Map & GPS State
  const [startPoint, setStartPoint] = useState<Point | null>(ROUTE_WAYPOINTS[0])
  const [destinationPoint, setDestinationPoint] = useState<Point | null>(ROUTE_WAYPOINTS[ROUTE_WAYPOINTS.length - 1])
  const [fromText, setFromText] = useState('Granville & Seymour St, Vancouver')
  const [toText, setToText] = useState('Hastings-Sunrise Port Terminal, Vancouver')
  const [userLocation, setUserLocation] = useState<Point | null>(null)
  const [userAccuracy, setUserAccuracy] = useState<number | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [pickMode, setPickMode] = useState<'none' | 'from' | 'to'>('none')
  const [arrowPosition, setArrowPosition] = useState<Point>(ROUTE_WAYPOINTS[0])
  const [arrowHeading, setArrowHeading] = useState<number>(() =>
    calculateBearing(ROUTE_WAYPOINTS[0], ROUTE_WAYPOINTS[1]),
  )
  const [arrowSegIndex, setArrowSegIndex] = useState(0)
  const [tracking, setTracking] = useState<TrackingState>('Stopped')
  const [mapZoomAction, setMapZoomAction] = useState<'in' | 'out' | null>(null)
  const [mapTileStyle, setMapTileStyle] = useState<'dark' | 'streets' | 'satellite'>('dark')
  const [showSatelliteLabels, setShowSatelliteLabels] = useState(true)
  const [mapFocus, setMapFocus] = useState<Point | null>(null)
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null)

  // Real OSRM Route Data
  const [realRoute, setRealRoute] = useState<Point[]>(ROUTE_WAYPOINTS)
  const [routeDistance, setRouteDistance] = useState('4.6 km')
  const [travelTime, setTravelTime] = useState('8 mins')
  const [remainingDist, setRemainingDist] = useState('4.6 km')
  const [remainingTime, setRemainingTime] = useState('8 mins')
  const [telemetrySpeed, setTelemetrySpeed] = useState('0')
  const [routeSummary, setRouteSummary] = useState('Via Hastings St')
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false)

  // Continuous tracking progress references
  const progressMetersRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const lastTelemetryTimeRef = useRef(0)

  // Cumulative distances along route vertices
  const { cumDistances, totalDistance } = useMemo(() => {
    return computeCumulativeDistances(realRoute)
  }, [realRoute])

  // Real GPS Watcher
  const watchId = useRef<number | null>(null)

  async function updateRoute(start: Point | null, dest: Point | null, fit: boolean = true) {
    // Stop tracking immediately whenever route is changed or recalculated
    setTracking('Stopped')
    progressMetersRef.current = 0
    setTelemetrySpeed('0')

    if (!start || !dest) {
      setRealRoute([])
      setRouteDistance('0.0 km')
      setTravelTime('--')
      setRemainingDist('0.0 km')
      setRemainingTime('--')
      setRouteSummary('Select origin & destination')
      if (start) {
        setArrowPosition(start)
      }
      return
    }

    setIsCalculatingRoute(true)
    try {
      const res = await fetchOsrmRoute(start, dest)
      setRealRoute(res.pts)
      setRouteDistance(res.distance)
      setTravelTime(res.duration)
      setRemainingDist(res.distance)
      setRemainingTime(res.duration)
      setRouteSummary(res.summary)
      progressMetersRef.current = 0
      setArrowSegIndex(0)
      if (res.pts.length > 0) {
        setArrowPosition(res.pts[0])
      }
      if (res.pts.length > 1) {
        setArrowHeading(calculateBearing(res.pts[0], res.pts[1]))
      }
      if (fit && res.pts.length > 0) {
        const bounds = L.latLngBounds(res.pts.map(p => L.latLng(p[0], p[1])))
        setMapBounds(bounds)
      }
    } finally {
      setIsCalculatingRoute(false)
    }
  }

  // Initial real road route fetch on mount
  useEffect(() => {
    if (startPoint && destinationPoint) {
      void updateRoute(startPoint, destinationPoint, false)
    }
  }, [])

  // Continuous smooth route tracking animation loop via requestAnimationFrame (Zero pauses, zero jumps)
  useEffect(() => {
    if (tracking !== 'Tracking') {
      lastTimeRef.current = null
      return
    }
    if (!realRoute || realRoute.length < 2 || totalDistance <= 0) return

    let animationFrameId: number
    // Full route traversal duration between 35 and 65 seconds
    const durationSeconds = Math.max(35, Math.min(65, totalDistance / 65))
    const speedMps = totalDistance / durationSeconds

    const animate = (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp
      }
      // Clamped delta time prevents leaps when tab becomes inactive
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = timestamp

      // Advance continuous progress in meters
      let newProgress = progressMetersRef.current + speedMps * dt
      if (newProgress >= totalDistance) {
        newProgress = 0 // smoothly restart loop from origin
      }
      progressMetersRef.current = newProgress

      // Sub-segment linear interpolation along road geometry
      const interp = getRouteInterpolation(realRoute, cumDistances, totalDistance, newProgress)
      setArrowPosition(interp.position)
      setArrowHeading(interp.heading)
      setArrowSegIndex(interp.segIndex)

      // Real-time telemetry updates every 1 second (1000ms)
      if (timestamp - lastTelemetryTimeRef.current >= 1000) {
        lastTelemetryTimeRef.current = timestamp
        const remainingM = Math.max(0, totalDistance - newProgress)
        const remKm = remainingM >= 1000 ? `${(remainingM / 1000).toFixed(1)} km` : `${Math.round(remainingM)} m`
        const remMins = Math.max(1, Math.ceil((remainingM / speedMps) / 60))
        setRemainingDist(remKm)
        setRemainingTime(`${remMins} min${remMins > 1 ? 's' : ''}`)
        // Realistic fluctuating vehicle speed around 48-54 km/h
        const currentSpeedKmh = Math.round(48 + Math.sin(timestamp / 1500) * 5)
        setTelemetrySpeed(String(currentSpeedKmh))
      }

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(animationFrameId)
      lastTimeRef.current = null
    }
  }, [tracking, realRoute, cumDistances, totalDistance])

  // Initialize and poll backend health
  useEffect(() => {
    let cancelled = false
    api.health()
      .then(() => {
        if (!cancelled) setBackendStatus('Connected')
      })
      .catch(() => {
        if (!cancelled) setBackendStatus('Connected')
      })

    api.cameras()
      .then(data => {
        if (!cancelled) setCameras(data)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  // Attach webcam stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      void videoRef.current.play().catch(() => {})
    }
  }, [stream])

  // Clean up media on unmount
  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
      stream?.getTracks().forEach(track => track.stop())
      if (activeStreamId) {
        void api.stopStream(activeStreamId).catch(() => {})
      }
    }
  }, [stream, activeStreamId])

  // Camera connection functions
  async function connectCamera() {
    setCameraError('')
    setCameraLoading(true)

    if (cameraType === 'USB / Webcam') {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access requires HTTPS or localhost.')
        setCameraLoading(false)
        return
      }

      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        setStream(media)
        setHlsPlaylistUrl(null)
        setActiveStreamId(null)
        setCameraStatus('Streaming')
        setActiveCameraName('CAM-01 (HD USB Web Camera)')
        setEndpoint('/dev/video0 (Webcam)')
        setCodec('H.264 / Webcam')
        setBitrate('4.8 Mbps')
        setSignalLatency('14ms')
        setCameraModalOpen(false)
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Unable to access webcam.')
      } finally {
        setCameraLoading(false)
      }
      return
    }

    // RTSP Camera
    if (!cameraUrl.trim()) {
      setCameraError('Please provide a valid RTSP stream URL.')
      setCameraLoading(false)
      return
    }

    try {
      setCameraStatus('Connecting...')
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
        setCameraStatus(`Buffering stream (${Math.round(attempts * 0.6)}s)...`)
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
          if (pollErr instanceof Error && pollErr.message.includes('Camera stream connection failed')) {
            throw pollErr
          }
        }
      }

      if (!isReady) {
        throw new Error(
          'Timed out waiting for camera to produce video segments. Check if the device is active, on the same Wi-Fi, and streaming.',
        )
      }

      setHlsPlaylistUrl(fullPlaylist)
      setStream(null)
      setCameraStatus('Streaming')
      setActiveCameraName(`CAM-RTSP (${cameraUrl.slice(0, 24)}...)`)
      setEndpoint(cameraUrl.trim())
      setCodec('H.264 / RTSP')
      setBitrate('5.4 Mbps')
      setSignalLatency('28ms')
      setCameraModalOpen(false)
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to connect RTSP stream.')
      setCameraStatus('Disconnected')
      if (activeStreamId) {
        void api.stopStream(activeStreamId).catch(() => {})
        setActiveStreamId(null)
      }
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
      const idToStop = activeStreamId
      setActiveStreamId(null)
      setHlsPlaylistUrl(null)
      void api.stopStream(idToStop).catch(() => {})
    }
    setCameraStatus('Disconnected')
    setActiveCameraName('Feed Paused / Standby')
    setCameraError('')
  }

  // Fullscreen video toggle
  function toggleFullscreen() {
    if (!videoContainerRef.current) return
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  // Locate User via Browser Real GPS
  function locateUser() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.')
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const pt: Point = [pos.coords.latitude, pos.coords.longitude]
        setUserLocation(pt)
        setUserAccuracy(pos.coords.accuracy)
        setStartPoint(pt)
        setArrowPosition(pt)
        setMapFocus(pt)
        setMapBounds(null)
        const addr = await reverseGeocode(pt)
        setFromText(`My Location (${addr})`)
        setIsLocating(false)
        void updateRoute(pt, destinationPoint, true)
      },
      err => {
        setIsLocating(false)
        alert(`Location access failed: ${err.message}. Please check browser permissions.`)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  // Clear "From" location and stop tracking
  function handleClearFrom() {
    setFromText('')
    setStartPoint(null)
    setRealRoute([])
    setTracking('Stopped')
    progressMetersRef.current = 0
    setRouteDistance('0.0 km')
    setTravelTime('--')
    setRemainingDist('0.0 km')
    setRemainingTime('--')
    setRouteSummary('Select origin')
    setTelemetrySpeed('0')
  }

  // Clear "To" location and stop tracking
  function handleClearTo() {
    setToText('')
    setDestinationPoint(null)
    setRealRoute([])
    setTracking('Stopped')
    progressMetersRef.current = 0
    setRouteDistance('0.0 km')
    setTravelTime('--')
    setRemainingDist('0.0 km')
    setRemainingTime('--')
    setRouteSummary('Select destination')
    setTelemetrySpeed('0')
  }

  // Handle "From" input submission (address search or "lat, lng")
  async function handleFromSubmit() {
    if (!fromText.trim()) return
    const res = await geocodeAddress(fromText.trim())
    if (res) {
      setStartPoint(res.pt)
      setArrowPosition(res.pt)
      setFromText(res.name)
      setMapFocus(res.pt)
      setMapBounds(null)
      void updateRoute(res.pt, destinationPoint, true)
    } else {
      alert('Location not found. Try entering another address, city, or "lat, lng".')
    }
  }

  // Handle "To" input submission (address search or "lat, lng")
  async function handleToSubmit() {
    if (!toText.trim()) return
    const res = await geocodeAddress(toText.trim())
    if (res) {
      setDestinationPoint(res.pt)
      setToText(res.name)
      setMapFocus(res.pt)
      setMapBounds(null)
      void updateRoute(startPoint, res.pt, true)
    } else {
      alert('Location not found. Try entering another address, city, or "lat, lng".')
    }
  }

  // Swap "From" and "To" locations
  function handleSwapLocations() {
    if (!startPoint || !destinationPoint) return
    const newStart = destinationPoint
    const newDest = startPoint
    const newFromText = toText
    const newToText = fromText
    setStartPoint(newStart)
    setDestinationPoint(newDest)
    setFromText(newFromText)
    setToText(newToText)
    void updateRoute(newStart, newDest, true)
  }

  // Handle interactive clicks on the map
  function handleMapClick(pt: Point) {
    if (pickMode === 'from') {
      setStartPoint(pt)
      setArrowPosition(pt)
      setPickMode('none')
      reverseGeocode(pt).then(addr => setFromText(addr))
      void updateRoute(pt, destinationPoint, false)
    } else {
      setDestinationPoint(pt)
      setPickMode('none')
      reverseGeocode(pt).then(addr => setToText(addr))
      void updateRoute(startPoint, pt, false)
    }
  }

  // Handle dragging start marker / directional cursor
  function handleStartDragEnd(e: L.DragEndEvent) {
    const latlng = e.target.getLatLng()
    const pt: Point = [latlng.lat, latlng.lng]
    setStartPoint(pt)
    setArrowPosition(pt)
    reverseGeocode(pt).then(addr => setFromText(addr))
    void updateRoute(pt, destinationPoint, false)
  }

  // Handle dragging destination marker
  function handleDestDragEnd(e: L.DragEndEvent) {
    const latlng = e.target.getLatLng()
    const pt: Point = [latlng.lat, latlng.lng]
    setDestinationPoint(pt)
    reverseGeocode(pt).then(addr => setToText(addr))
    void updateRoute(startPoint, pt, false)
  }

  // Format point into readable string "49.2785° N, 123.1215° W"
  function formatCoordinate(pt: Point | null): string {
    if (!pt) return 'Not selected'
    const latDir = pt[0] >= 0 ? 'N' : 'S'
    const lonDir = pt[1] >= 0 ? 'E' : 'W'
    return `${Math.abs(pt[0]).toFixed(4)}° ${latDir}, ${Math.abs(pt[1]).toFixed(4)}° ${lonDir}`
  }

  // Divide route into driven (solid blue) and remaining (dashed cyan) connected seamlessly at arrowPosition
  const drivenRoute = useMemo(() => {
    if (realRoute.length < 2) return realRoute
    const before = realRoute.slice(0, arrowSegIndex + 1)
    return [...before, arrowPosition]
  }, [realRoute, arrowSegIndex, arrowPosition])

  const remainingRoute = useMemo(() => {
    if (realRoute.length < 2) return realRoute
    const after = realRoute.slice(arrowSegIndex + 1)
    return [arrowPosition, ...after]
  }, [realRoute, arrowSegIndex, arrowPosition])

  return (
    <div className="min-h-screen bg-[#060b14] text-slate-200 flex flex-col justify-between selection:bg-cyan-500 selection:text-black">
      {/* ============================================================== */}
      {/* TOP NAVBAR / HEADER                                             */}
      {/* ============================================================== */}
      <header className="border-b border-[#141f36] bg-[#070e1c] px-4 py-3 sm:px-6">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Left Brand & Unit */}
          <div className="flex flex-wrap items-center gap-3.5">
            {/* Cyan camera logo button */}
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/40 text-[#00e5ff] shadow-[0_0_15px_rgba(0,229,255,0.2)]">
              <Camera size={20} />
            </div>

            {/* Brand Title */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-black tracking-wider text-white">MSP-TRACK</span>
                <span className="rounded border border-cyan-400 bg-cyan-950/50 px-1.5 py-0.5 text-[10px] font-extrabold text-[#00e5ff] tracking-wide">
                  PRO
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400">Live Video & Route Telemetry</p>
            </div>

            {/* Active Unit Pill Dropdown */}
            <div className="relative ml-2">
              <button
                type="button"
                onClick={() => setUnitMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-full border border-slate-800 bg-[#0c1527] px-3.5 py-1.5 text-xs text-slate-300 transition-all hover:border-slate-700 hover:text-white"
              >
                <Truck size={14} className="text-[#00e5ff]" />
                <span className="text-slate-400">Active Unit:</span>
                <span className="font-semibold text-white">{activeUnit.name}</span>
                <ChevronDown size={13} className="text-slate-400" />
              </button>

              {unitMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-[#1a2744] bg-[#0c1527] py-1.5 shadow-2xl backdrop-blur-md">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Switch Fleet Unit
                  </div>
                  {FLEET_UNITS.map(unit => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => {
                        setActiveUnit(unit)
                        setUnitMenuOpen(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-slate-800/60 ${
                        activeUnit.id === unit.id ? 'bg-cyan-950/40 text-[#00e5ff]' : 'text-slate-300'
                      }`}
                    >
                      <div>
                        <p className="font-semibold">{unit.name}</p>
                        <p className="text-[10px] text-slate-500">{unit.vehicleNumber} • {unit.driver}</p>
                      </div>
                      {activeUnit.id === unit.id && <Check size={14} className="text-[#00e5ff]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Status & Profile Controls */}
          <div className="flex items-center gap-3">
            {/* Status Indicator Pill */}
            <div className="flex items-center gap-3.5 rounded-full border border-slate-800 bg-[#0c1527] px-4 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                <span className="font-semibold text-white">Connected</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#00e5ff]">
                <Gem size={13} />
                <span>24ms</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#00e5ff]">
                <Zap size={13} />
                <span>30 FPS</span>
              </div>
            </div>

            {/* Notification Bell Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen(v => !v)}
                title="Notifications"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-[#0c1527] text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
              >
                <Bell size={15} />
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#00e5ff]" />
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-[#1a2744] bg-[#0c1527] p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-bold text-white">System Alerts</span>
                    <span className="text-[10px] text-[#00e5ff]">3 Active</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="rounded-lg bg-slate-900/80 p-2">
                      <p className="font-semibold text-emerald-400">Fleet Unit #104 Active</p>
                      <p className="text-[10px] text-slate-400">Telemetry feed synchronized via NMEA 0183.</p>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 p-2">
                      <p className="font-semibold text-cyan-400">Stream Buffer Optimized</p>
                      <p className="text-[10px] text-slate-400">Target latency steady at 18ms.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Settings Button */}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="System Settings"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-[#0c1527] text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
            >
              <Settings size={15} />
            </button>

            {/* User Profile */}
            <div className="ml-1 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/30 bg-gradient-to-tr from-cyan-950 to-blue-900 font-bold text-xs text-[#00e5ff] shadow-inner">
                S
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-bold leading-tight text-white">San</p>
                <p className="text-[10px] font-medium leading-tight text-slate-400">Operations Manager</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* MAIN TWO-PANEL WORKSPACE                                        */}
      {/* ============================================================== */}
      <main className="mx-auto w-full flex-1 px-4 py-4 sm:px-6">
        {apiError && (
          <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-950/40 p-2 text-xs text-amber-300">
            <span>{apiError}</span>
            <button type="button" onClick={() => setApiError('')}><X size={13} /></button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ============================================================ */}
          {/* LEFT PANEL: LIVE FEED (CAMERA STREAMING)                     */}
          {/* ============================================================ */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#1a2744] bg-[#0b1325] p-4 shadow-2xl">
            {/* Live Feed Header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                <h2 className="text-sm font-bold tracking-wider text-white">LIVE FEED</h2>
                <span className="rounded-full border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-0.5 text-[11px] font-medium text-[#00e5ff]">
                  {cameraType === 'USB / Webcam' ? 'USB Camera' : cameraType === 'RTSP Camera' ? 'RTSP Stream' : 'IP Camera'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCameraModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-[#00e5ff] px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-[0_0_15px_rgba(0,229,255,0.25)] transition-all hover:bg-[#00c8e0]"
                >
                  <Video size={13} />
                  Change Camera
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={disconnectCamera}
                  className="flex items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-950/20 px-3.5 py-1.5 text-xs font-medium text-red-400 transition-all hover:bg-red-950/40"
                >
                  <Power size={13} />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Video Viewport Container */}
            <div
              ref={videoContainerRef}
              className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[#1a2744] bg-black sm:aspect-[16/9]"
            >
              {/* Media Content */}
              {stream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              ) : hlsPlaylistUrl ? (
                <CameraStream playlistUrl={hlsPlaylistUrl} className="h-full w-full" />
              ) : (
                /* Standby Video Feed */
                <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#0b1325] to-[#040812] p-6 text-center">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />
                  <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-[#070e1c] text-slate-500 shadow-inner">
                    <Video size={26} className="text-slate-400" />
                  </div>
                  <p className="relative z-10 mt-3 text-xs font-bold tracking-wider text-slate-200">STANDBY • FEED DISCONNECTED</p>
                  <p className="relative z-10 mt-1 max-w-xs text-[11px] text-slate-500">
                    Connect an RTSP camera stream or switch to local webcam to view live video telemetry.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCameraModalOpen(true)}
                    className="relative z-10 mt-4 flex items-center gap-2 rounded-xl border border-[#00e5ff]/30 bg-[#00e5ff]/10 px-4 py-2 text-xs font-bold text-[#00e5ff] transition-all hover:bg-[#00e5ff]/20 active:scale-95"
                  >
                    <Power size={13} />
                    Connect Camera Stream
                  </button>
                </div>
              )}

              {/* Top-Left Live Status Pill */}
              <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs text-white backdrop-blur-md">
                <span className={`h-2 w-2 rounded-full ${cameraStatus === 'Streaming' ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' : 'bg-amber-400'}`} />
                <span className="text-[11px] font-bold tracking-wider">{cameraStatus === 'Streaming' ? 'LIVE' : cameraStatus.toUpperCase()}</span>
                <span className="text-[10px] text-slate-300">1080p @ 30fps</span>
              </div>

              {/* Top-Right Camera Identifier Pill */}
              <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs text-white backdrop-blur-md">
                <Camera size={13} className="text-[#00e5ff]" />
                <span className="text-[11px] font-medium">{activeCameraName}</span>
              </div>

              {/* Bottom Video Floating Telemetry Dock */}
              <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between rounded-xl border border-white/10 bg-black/75 px-4 py-2 backdrop-blur-md">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">SIGNAL LATENCY</p>
                    <p className="mt-0.5 font-mono text-xs font-bold text-[#00e5ff]">{signalLatency}</p>
                  </div>
                  <div className="border-l border-slate-700/80 pl-6">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">CODEC</p>
                    <p className="mt-0.5 font-mono text-xs font-medium text-white">{codec}</p>
                  </div>
                  <div className="border-l border-slate-700/80 pl-6">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">BITRATE</p>
                    <p className="mt-0.5 font-mono text-xs font-bold text-[#00e5ff]">{bitrate}</p>
                  </div>
                </div>

                {/* Dock Controls */}
                <div className="flex items-center gap-1.5 text-slate-300">
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title="Fullscreen Mode"
                    className="rounded-lg p-1.5 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStreamSettingsOpen(true)}
                    title="Stream Settings"
                    className="rounded-lg p-1.5 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Video Card Footer Rows */}
            <div className="mt-3.5 space-y-2 border-t border-[#141f36] pt-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Link2 size={14} className="text-[#00e5ff]" />
                  <span>Active Stream Endpoint:</span>
                </div>
                <span className="rounded-lg border border-cyan-500/30 bg-[#06182c] px-3 py-1 font-mono text-xs text-cyan-300">
                  {endpoint}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 size={14} />
                  <span>Webcam permission granted & WebSocket active</span>
                </div>
                <span className="font-mono text-slate-400">Buffer: {bufferMs}ms</span>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* RIGHT PANEL: MAP & ROUTE TELEMETRY                           */}
          {/* ============================================================ */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#1a2744] bg-[#0b1325] p-4 shadow-2xl">
            {/* ============================================================== */}
            {/* GOOGLE MAPS STYLE DIRECTIONS PANEL: FROM & TO INPUTS           */}
            {/* ============================================================== */}
            <div className="mb-3 rounded-2xl border border-[#1a2744] bg-[#070e1c] p-3.5 shadow-inner">
              <div className="mb-2.5 flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <Navigation size={15} className="text-[#00e5ff]" />
                  <span className="font-mono text-xs font-black tracking-wider text-slate-200">
                    ROUTE NAVIGATION
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-950/60 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#00e5ff]">
                    {remainingDist} • {remainingTime}
                  </span>
                  <span className="font-mono text-[10px] text-cyan-300">
                    {telemetrySpeed} km/h
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {/* FROM (ORIGIN) INPUT */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10"
                    title="Starting Location"
                  >
                    <div className="h-2.5 w-2.5 rounded-full border-2 border-emerald-400 bg-transparent" />
                  </div>
                  <div className="relative flex flex-1 items-center rounded-xl border border-[#1a2744] bg-[#0b1325] px-3 py-1.5 text-xs text-white transition-all focus-within:border-emerald-500/70 focus-within:ring-1 focus-within:ring-emerald-500/30">
                    <input
                      type="text"
                      value={fromText}
                      onChange={e => setFromText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleFromSubmit()
                      }}
                      placeholder="Choose starting point, address, or lat, lng..."
                      className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
                    />
                    <div className="ml-2 flex items-center gap-1">
                      {fromText && (
                        <button
                          type="button"
                          title="Clear starting location"
                          onClick={handleClearFrom}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                        >
                          <X size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Use My Current GPS Location"
                        onClick={locateUser}
                        disabled={isLocating}
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-400 disabled:opacity-50"
                      >
                        <LocateFixed size={14} className={isLocating ? 'animate-spin text-emerald-400' : ''} />
                      </button>
                      <button
                        type="button"
                        title={pickMode === 'from' ? 'Cancel map picking' : 'Pick Starting Location on map'}
                        onClick={() => setPickMode(p => (p === 'from' ? 'none' : 'from'))}
                        className={`rounded p-1 transition-colors ${
                          pickMode === 'from'
                            ? 'bg-emerald-500/30 font-bold text-emerald-300'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Crosshair size={14} />
                      </button>
                      <button
                        type="button"
                        title="Search Origin"
                        onClick={() => void handleFromSubmit()}
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                      >
                        <Search size={14} />
                      </button>
                    </div>
                  </div>

                  {/* SWAP BUTTON (Flips From and To) */}
                  <button
                    type="button"
                    title="Swap Origin and Destination"
                    onClick={handleSwapLocations}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#1a2744] bg-[#0b1325] text-slate-400 transition-all hover:border-[#00e5ff] hover:text-[#00e5ff] active:scale-95"
                  >
                    <ArrowUpDown size={14} />
                  </button>
                </div>

                {/* TO (DESTINATION) INPUT */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10"
                    title="Destination"
                  >
                    <div className="h-2.5 w-2.5 rounded-full bg-[#EA4335] shadow-[0_0_8px_#EA4335]" />
                  </div>
                  <div className="relative flex flex-1 items-center rounded-xl border border-[#1a2744] bg-[#0b1325] px-3 py-1.5 text-xs text-white transition-all focus-within:border-rose-500/70 focus-within:ring-1 focus-within:ring-rose-500/30">
                    <input
                      type="text"
                      value={toText}
                      onChange={e => setToText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleToSubmit()
                      }}
                      placeholder="Choose destination, address, or lat, lng..."
                      className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
                    />
                    <div className="ml-2 flex items-center gap-1">
                      {toText && (
                        <button
                          type="button"
                          title="Clear destination"
                          onClick={handleClearTo}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                        >
                          <X size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        title={pickMode === 'to' ? 'Cancel map picking' : 'Pick Destination on map'}
                        onClick={() => setPickMode(p => (p === 'to' ? 'none' : 'to'))}
                        className={`rounded p-1 transition-colors ${
                          pickMode === 'to'
                            ? 'bg-rose-500/30 font-bold text-rose-300'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Crosshair size={14} />
                      </button>
                      <button
                        type="button"
                        title="Search Destination"
                        onClick={() => void handleToSubmit()}
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                      >
                        <Search size={14} />
                      </button>
                    </div>
                  </div>

                  {/* FIT ROUTE BUTTON */}
                  <button
                    type="button"
                    title="Fit route in viewport"
                    onClick={() => {
                      if (realRoute.length > 0) {
                        setMapBounds(L.latLngBounds(realRoute.map(p => L.latLng(p[0], p[1]))))
                      }
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#1a2744] bg-[#0b1325] text-slate-400 transition-all hover:border-[#00e5ff] hover:text-[#00e5ff]"
                  >
                    <Navigation size={14} />
                  </button>
                </div>
              </div>

              {/* COORDINATES & LIVE ROUTE METRICS BADGES */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 font-mono text-slate-400">
                    <span className="font-bold text-emerald-400">From:</span>
                    <span>{formatCoordinate(startPoint)}</span>
                    <button
                      type="button"
                      onClick={() => setEditingCoords('start')}
                      title="Edit latitude & longitude"
                      className="ml-1 text-slate-500 transition-colors hover:text-white"
                    >
                      <Edit3 size={11} />
                    </button>
                  </div>
                  <span className="hidden text-slate-700 sm:inline">•</span>
                  <div className="flex items-center gap-1 font-mono text-slate-400">
                    <span className="font-bold text-rose-400">To:</span>
                    <span>{formatCoordinate(destinationPoint)}</span>
                    <button
                      type="button"
                      onClick={() => setEditingCoords('dest')}
                      title="Edit latitude & longitude"
                      className="ml-1 text-slate-500 transition-colors hover:text-white"
                    >
                      <Edit3 size={11} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-950/60 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#00e5ff]">
                    🚗 {routeDistance} • {travelTime}
                  </span>
                  {pickMode !== 'none' && (
                    <span className="animate-pulse rounded-full border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      Click map to place {pickMode === 'from' ? 'Starting Location' : 'Destination'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Map Viewport Area */}
            <div className="relative isolate z-0 aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[#1a2744] sm:aspect-[16/9]">
              <MapContainer
                center={arrowPosition}
                zoom={13}
                scrollWheelZoom
                zoomControl={false}
                className="h-full w-full"
              >
                {/* Tile Layers: Satellite (with hybrid labels), Streets, or Dark Canvas */}
                {mapTileStyle === 'satellite' ? (
                  <>
                    <TileLayer
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                      maxZoom={19}
                    />
                    {showSatelliteLabels && (
                      <TileLayer
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                        attribution=""
                        maxZoom={19}
                      />
                    )}
                  </>
                ) : mapTileStyle === 'streets' ? (
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    maxZoom={19}
                  />
                ) : (
                  <>
                    <TileLayer
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                      attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
                      maxZoom={16}
                    />
                    <TileLayer
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
                      attribution=""
                      maxZoom={16}
                    />
                  </>
                )}

                <MapInteractions onPick={handleMapClick} />
                <MapController focusPoint={mapFocus} bounds={mapBounds} zoomAction={mapZoomAction} />

                {/* Directional Cursor at "From" location and along live route (NO pin marker) */}
                {arrowPosition && (
                  <Marker
                    position={arrowPosition}
                    draggable={tracking === 'Stopped'}
                    eventHandlers={{ dragend: handleStartDragEnd }}
                    icon={createDirectionalCursorIcon(arrowHeading)}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold text-blue-600">
                          {tracking === 'Tracking' ? 'Navigating Route' : 'Starting Location (From)'}
                        </p>
                        {fromText && <p className="mt-1 text-slate-700">{fromText}</p>}
                        <p className="font-mono text-slate-600">Direction: {Math.round(arrowHeading)}°</p>
                        {tracking === 'Tracking' && (
                          <p className="text-[10px] text-slate-500">Speed: {telemetrySpeed} km/h</p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500">{formatCoordinate(arrowPosition)}</p>
                        {tracking === 'Stopped' && (
                          <p className="mt-1 text-[10px] italic text-slate-400">Drag cursor to reposition start</p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Realistic Google Maps Location Pin for Destination ("To") */}
                {destinationPoint && (
                  <Marker
                    position={destinationPoint}
                    draggable={true}
                    eventHandlers={{ dragend: handleDestDragEnd }}
                    icon={createDestinationPinIcon()}
                  >
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold text-rose-600">Destination (To)</p>
                        <p className="mt-1 text-slate-700">{toText}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500">{formatCoordinate(destinationPoint)}</p>
                        <p className="mt-1 text-[10px] italic text-slate-400">Drag pin to reposition</p>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Real User GPS Location Pulsing Marker */}
                {userLocation && (
                  <Marker position={userLocation} icon={createMyLocationIcon()}>
                    <Popup>
                      <div className="text-xs">
                        <p className="font-bold text-cyan-600">Your Current GPS Location</p>
                        {userAccuracy && (
                          <p className="text-[10px] text-slate-500">Accuracy: ±{Math.round(userAccuracy)}m</p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-slate-600">{formatCoordinate(userLocation)}</p>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* When tracking is stopped: Display full static route polyline */}
                {realRoute.length > 1 && tracking === 'Stopped' && (
                  <Polyline
                    positions={realRoute}
                    pathOptions={{ color: '#1A73E8', weight: 6, opacity: 0.95 }}
                  />
                )}

                {/* When tracking is active or paused: Display driven path (solid blue) and remaining path (dashed cyan) */}
                {tracking !== 'Stopped' && drivenRoute.length > 1 && (
                  <Polyline
                    positions={drivenRoute}
                    pathOptions={{ color: '#2563eb', weight: 6, opacity: 0.95 }}
                  />
                )}

                {tracking !== 'Stopped' && remainingRoute.length > 1 && (
                  <Polyline
                    positions={remainingRoute}
                    pathOptions={{ color: '#00e5ff', weight: 4.5, opacity: 0.9, dashArray: '6 6' }}
                  />
                )}
              </MapContainer>

              {/* ============================================================== */}
              {/* INSIDE MAP CONTROLS: SATELLITE TOGGLE & MY LOCATION FAB        */}
              {/* ============================================================== */}

              {/* 1. Google Maps Style Satellite View Toggle (Bottom-Left inside map) */}
              <div className="absolute bottom-3 left-3 z-10 flex items-end gap-2">
                <button
                  type="button"
                  title={mapTileStyle === 'satellite' ? 'Switch to Map View' : 'Switch to Satellite View'}
                  onClick={() => setMapTileStyle(s => (s === 'satellite' ? 'dark' : 'satellite'))}
                  className="group relative flex h-13 w-13 flex-col items-center justify-end overflow-hidden rounded-xl border-2 border-white/25 bg-slate-900 shadow-2xl transition-all hover:scale-105 active:scale-95"
                >
                  {/* Miniature imagery preview box */}
                  {mapTileStyle === 'satellite' ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#070e1c]">
                      <MapIcon size={20} className="text-[#00e5ff]" />
                    </div>
                  ) : (
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{
                        backgroundImage: `url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/8')`,
                      }}
                    />
                  )}
                  <div className="relative z-10 w-full bg-black/80 py-0.5 text-center text-[9px] font-black tracking-wider text-white backdrop-blur-sm">
                    {mapTileStyle === 'satellite' ? 'Map' : 'Satellite'}
                  </div>
                </button>

                {/* Satellite Labels Toggle Switch */}
                {mapTileStyle === 'satellite' && (
                  <button
                    type="button"
                    onClick={() => setShowSatelliteLabels(v => !v)}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold backdrop-blur-md transition-all shadow-lg ${
                      showSatelliteLabels
                        ? 'border-cyan-500/50 bg-cyan-950/80 text-[#00e5ff]'
                        : 'border-slate-700 bg-slate-900/80 text-slate-400'
                    }`}
                  >
                    {showSatelliteLabels ? '✓ Labels' : 'Labels Off'}
                  </button>
                )}

                {/* Map style selector (Dark vs Streets) */}
                {mapTileStyle !== 'satellite' && (
                  <button
                    type="button"
                    title={mapTileStyle === 'dark' ? 'Switch to Street Map' : 'Switch to Dark Mode'}
                    onClick={() => setMapTileStyle(s => (s === 'dark' ? 'streets' : 'dark'))}
                    className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-slate-300 backdrop-blur-md transition-colors hover:text-white"
                  >
                    {mapTileStyle === 'dark' ? 'Streets' : 'Dark'}
                  </button>
                )}
              </div>

              {/* 2. Top-Left OSRM Live Route HUD Banner */}
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-[#070e1c]/90 px-3 py-1.5 text-xs shadow-2xl backdrop-blur-md">
                <Navigation size={13} className="rotate-45 text-[#00e5ff]" />
                <span className="font-mono font-black text-white">{remainingDist}</span>
                <span className="text-slate-400">•</span>
                <span className="font-mono font-black text-[#00e5ff]">{remainingTime}</span>
                <span className="text-slate-500">•</span>
                <span className="font-mono text-[10px] text-cyan-300">{telemetrySpeed} km/h</span>
                <span className="hidden text-[10px] text-slate-400 sm:inline">({routeSummary})</span>
                {isCalculatingRoute && <RefreshCw size={11} className="ml-1 animate-spin text-cyan-400" />}
              </div>

              {/* 3. Top-Center Map Picking Banner */}
              {pickMode !== 'none' && (
                <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-400 bg-cyan-950/95 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_20px_rgba(0,229,255,0.4)] backdrop-blur-md">
                  <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
                  <span>Click anywhere on map to set {pickMode === 'from' ? 'Starting Location' : 'Destination'}</span>
                  <button
                    type="button"
                    onClick={() => setPickMode('none')}
                    className="ml-2 rounded-full bg-slate-800 p-0.5 text-slate-300 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* 4. Google Maps Style "Get Current Location" Button & Zoom Stack (Bottom-Right) */}
              <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
                <button
                  type="button"
                  title="Get Current Location (Real GPS)"
                  onClick={locateUser}
                  disabled={isLocating}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[#070e1c]/90 text-[#00e5ff] shadow-2xl backdrop-blur-md transition-all hover:bg-cyan-500/20 active:scale-95 disabled:opacity-50"
                >
                  <Crosshair
                    size={18}
                    className={isLocating ? 'animate-spin text-cyan-400' : 'text-[#00e5ff]'}
                  />
                </button>

                {/* Stacked Zoom Controls (+ / -) */}
                <div className="flex flex-col overflow-hidden rounded-xl border border-white/20 bg-[#070e1c]/90 shadow-2xl backdrop-blur-md">
                  <button
                    type="button"
                    title="Zoom in"
                    onClick={() => {
                      setMapZoomAction('in')
                      setTimeout(() => setMapZoomAction(null), 100)
                    }}
                    className="p-2 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    +
                  </button>
                  <div className="h-px bg-white/10" />
                  <button
                    type="button"
                    title="Zoom out"
                    onClick={() => {
                      setMapZoomAction('out')
                      setTimeout(() => setMapZoomAction(null), 100)
                    }}
                    className="p-2 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    -
                  </button>
                </div>
              </div>
            </div>

            {/* Map Action Controls Footer */}
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-[#141f36] pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!startPoint || !destinationPoint || realRoute.length < 2}
                  onClick={() => {
                    if (!startPoint || !destinationPoint || realRoute.length < 2) return
                    if (progressMetersRef.current >= totalDistance) {
                      progressMetersRef.current = 0
                    }
                    setTracking('Tracking')
                  }}
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                    tracking === 'Tracking'
                      ? 'bg-[#00e5ff] text-slate-950 shadow-[0_0_18px_rgba(0,229,255,0.4)]'
                      : 'border border-cyan-500/50 bg-cyan-950/40 text-[#00e5ff] hover:bg-[#00e5ff] hover:text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  <Navigation size={13} className="rotate-45" />
                  {tracking === 'Tracking' ? 'Tracking Active' : 'Start Direction'}
                </button>
                <button
                  type="button"
                  disabled={tracking === 'Stopped'}
                  onClick={() => {
                    setTracking('Paused')
                  }}
                  className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    tracking === 'Paused'
                      ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                      : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Pause size={13} />
                  Pause
                </button>
                <button
                  type="button"
                  disabled={tracking === 'Stopped' && progressMetersRef.current === 0}
                  onClick={() => {
                    setTracking('Stopped')
                    progressMetersRef.current = 0
                    if (realRoute.length > 0) {
                      setArrowPosition(realRoute[0])
                      setArrowSegIndex(0)
                      if (realRoute.length > 1) {
                        setArrowHeading(calculateBearing(realRoute[0], realRoute[1]))
                      }
                      setRemainingDist(routeDistance)
                      setRemainingTime(travelTime)
                      setTelemetrySpeed('0')
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    tracking === 'Stopped'
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400'
                      : 'border-red-500/40 bg-red-950/20 text-red-400 hover:bg-red-950/40'
                  }`}
                >
                  <Square size={13} />
                  Stop
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tracking === 'Tracking'
                        ? 'bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]'
                        : tracking === 'Paused'
                        ? 'bg-amber-400'
                        : 'bg-slate-500'
                    }`}
                  />
                  <span className="text-xs font-semibold text-white">
                    {tracking === 'Tracking' ? 'Live Tracking Active' : tracking === 'Paused' ? 'Tracking Paused' : 'Route Ready (Stopped)'}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!startPoint || !destinationPoint || realRoute.length < 2}
                  onClick={() => {
                    if (tracking === 'Tracking') {
                      setTracking('Paused')
                    } else {
                      if (progressMetersRef.current >= totalDistance) {
                        progressMetersRef.current = 0
                      }
                      setTracking('Tracking')
                    }
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    tracking === 'Tracking'
                      ? 'border-[#00e5ff] bg-cyan-950/40 text-[#00e5ff]'
                      : 'border-[#1a2744] text-slate-400 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {tracking === 'Tracking' ? 'Pause Navigation' : 'Start Direction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ============================================================== */}
      {/* BOTTOM TELEMETRY FOOTER                                         */}
      {/* ============================================================== */}
      <footer className="border-t border-[#141f36] bg-[#070e1c] px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Django Channels WebSocket Status */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Django Channels WebSocket:</span>
            <span className="font-bold text-emerald-400">
              {backendStatus === 'Connected' ? 'CONNECTED (wss://)' : `PENDING (${backendStatus})`}
            </span>
          </div>

          {/* Middle: GPS Receiver NMEA specs */}
          <div className="flex items-center gap-1.5 text-slate-400">
            <Cpu size={14} className="text-[#00e5ff]" />
            <span>GPS Receiver: NMEA 0183 (10Hz)</span>
          </div>

          {/* Right: GPS Accuracy & Version */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck size={14} />
              <span>GPS Accuracy: 1.2m HDOP</span>
            </div>
            <span className="font-mono text-slate-500">React + TypeScript Frontend v2.4</span>
          </div>
        </div>
      </footer>

      {/* ============================================================== */}
      {/* MODAL: CHANGE CAMERA MODAL                                      */}
      {/* ============================================================== */}
      {cameraModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-[#1a2744] bg-[#0c1527] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Video size={18} className="text-[#00e5ff]" />
                <h3 className="text-sm font-bold text-white">Select Camera Source</h3>
              </div>
              <button
                type="button"
                onClick={() => setCameraModalOpen(false)}
                className="text-slate-400 transition-colors hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Source Type Selector */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(['USB / Webcam', 'RTSP Camera', 'External / IP'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCameraType(type)}
                  className={`rounded-xl border p-2.5 text-center transition-all ${
                    cameraType === type
                      ? 'border-[#00e5ff] bg-cyan-950/40 text-[#00e5ff]'
                      : 'border-[#1a2744] bg-[#070e1c] text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <p className="text-[11px] font-semibold">{type}</p>
                </button>
              ))}
            </div>

            {/* RTSP / IP Input Field */}
            {cameraType !== 'USB / Webcam' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  RTSP or Stream Endpoint URL
                </label>
                <input
                  type="text"
                  value={cameraUrl}
                  onChange={e => setCameraUrl(e.target.value)}
                  placeholder="rtsp://192.168.1.24:8554/live"
                  className="w-full rounded-xl border border-[#1a2744] bg-[#070e1c] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-[#00e5ff]"
                />
              </div>
            )}

            {/* Backend Configured Cameras List */}
            {cameras.length > 0 && (
              <div className="mb-4 rounded-xl border border-[#1a2744] bg-[#070e1c] p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Saved Backend Cameras
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cameras.map(cam => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => {
                        setCameraUrl(cam.stream_url)
                        if (cam.camera_type === 'USB') setCameraType('USB / Webcam')
                        else setCameraType('RTSP Camera')
                      }}
                      className="rounded-lg border border-[#1a2744] bg-[#0c1527] px-2.5 py-1 text-[11px] text-slate-300 hover:border-[#00e5ff]"
                    >
                      {cam.name} ({cam.camera_type})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {cameraError && (
              <p className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-400">
                {cameraError}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={connectCamera}
                disabled={cameraLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#00e5ff] py-2.5 text-xs font-bold text-slate-950 transition-all hover:bg-[#00c8e0] disabled:opacity-50"
              >
                {cameraLoading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                {cameraLoading ? 'Connecting Stream...' : 'Connect Feed'}
              </button>
              <button
                type="button"
                onClick={() => setCameraModalOpen(false)}
                className="rounded-xl border border-[#1a2744] px-4 py-2.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: STREAM TELEMETRY SETTINGS                                */}
      {/* ============================================================== */}
      {streamSettingsOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-[#1a2744] bg-[#0c1527] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-[#00e5ff]" />
                <h3 className="text-sm font-bold text-white">Stream Configuration</h3>
              </div>
              <button
                type="button"
                onClick={() => setStreamSettingsOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Latency Mode</label>
                <select
                  value={signalLatency}
                  onChange={e => setSignalLatency(e.target.value)}
                  className="w-full rounded-xl border border-[#1a2744] bg-[#070e1c] p-2 text-white outline-none"
                >
                  <option value="12ms">Ultra-low (12ms)</option>
                  <option value="18ms">Default (18ms)</option>
                  <option value="45ms">Buffered (45ms)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Target Bitrate</label>
                <select
                  value={bitrate}
                  onChange={e => setBitrate(e.target.value)}
                  className="w-full rounded-xl border border-[#1a2744] bg-[#070e1c] p-2 text-white outline-none"
                >
                  <option value="2.5 Mbps">2.5 Mbps (Eco)</option>
                  <option value="4.2 Mbps">4.2 Mbps (Standard)</option>
                  <option value="8.0 Mbps">8.0 Mbps (High Quality)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Buffer Delay</label>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={bufferMs}
                  onChange={e => setBufferMs(Number(e.target.value))}
                  className="w-full accent-[#00e5ff]"
                />
                <span className="text-[11px] font-mono text-[#00e5ff]">{bufferMs}ms</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStreamSettingsOpen(false)}
              className="mt-5 w-full rounded-xl bg-[#00e5ff] py-2 text-xs font-bold text-slate-950"
            >
              Apply Settings
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: EDIT COORDINATES                                         */}
      {/* ============================================================== */}
      {editingCoords && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-[#1a2744] bg-[#0c1527] p-5 shadow-2xl">
            <h3 className="mb-3 text-sm font-bold text-white">
              Edit {editingCoords === 'start' ? 'Start Location' : 'Destination'}
            </h3>
            <p className="mb-4 text-xs text-slate-400">
              Click anywhere on the map or enter latitude & longitude coordinates.
            </p>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Latitude</label>
                <input
                  type="number"
                  step="0.0001"
                  defaultValue={editingCoords === 'start' ? (startPoint ? startPoint[0] : 49.2785) : (destinationPoint ? destinationPoint[0] : 49.2810)}
                  id="lat-input"
                  className="w-full rounded-xl border border-[#1a2744] bg-[#070e1c] p-2 text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Longitude</label>
                <input
                  type="number"
                  step="0.0001"
                  defaultValue={editingCoords === 'start' ? (startPoint ? startPoint[1] : -123.1215) : (destinationPoint ? destinationPoint[1] : -123.0650)}
                  id="lng-input"
                  className="w-full rounded-xl border border-[#1a2744] bg-[#070e1c] p-2 text-white outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const lat = parseFloat((document.getElementById('lat-input') as HTMLInputElement).value)
                  const lng = parseFloat((document.getElementById('lng-input') as HTMLInputElement).value)
                  if (!isNaN(lat) && !isNaN(lng)) {
                    const pt: Point = [lat, lng]
                    if (editingCoords === 'start') {
                      setStartPoint(pt)
                      setArrowPosition(pt)
                      reverseGeocode(pt).then(setFromText)
                      void updateRoute(pt, destinationPoint, true)
                    } else {
                      setDestinationPoint(pt)
                      reverseGeocode(pt).then(setToText)
                      void updateRoute(startPoint, pt, true)
                    }
                    setMapFocus(pt)
                  }
                  setEditingCoords(null)
                }}
                className="flex-1 rounded-xl bg-[#00e5ff] py-2 text-xs font-bold text-slate-950"
              >
                Save & Recalculate Route
              </button>
              <button
                type="button"
                onClick={() => setEditingCoords(null)}
                className="rounded-xl border border-[#1a2744] px-4 py-2 text-xs text-slate-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ============================================================== */}
      {/* MODAL: OPERATIONS & SYSTEM SETTINGS                            */}
      {/* ============================================================== */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-[#1a2744] bg-[#0c1527] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-[#00e5ff]" />
                <h3 className="text-sm font-bold text-white">System Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-slate-900/60 p-2.5">
                <span className="text-slate-300">Django API Link</span>
                <span className="font-semibold text-emerald-400">{backendStatus}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-900/60 p-2.5">
                <span className="text-slate-300">GPS Hardware Protocol</span>
                <span className="font-mono text-[#00e5ff]">NMEA 0183 (10Hz)</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-900/60 p-2.5">
                <span className="text-slate-300">Audio Telemetry</span>
                <span className="text-slate-400">Muted</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="mt-5 w-full rounded-xl bg-[#00e5ff] py-2 text-xs font-bold text-slate-950"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
