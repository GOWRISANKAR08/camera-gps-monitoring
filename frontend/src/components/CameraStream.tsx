
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type CameraStreamProps = {
  playlistUrl: string;
  className?: string;
};

export default function CameraStream({
  playlistUrl,
  className = "",
}: CameraStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSupported =
    typeof window !== "undefined" &&
    (Hls.isSupported() ||
      !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"));

  const [message, setMessage] = useState(
    isSupported ? "Loading live stream..." : "This browser does not support HLS playback."
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playlistUrl || !isSupported) return;

    let hls: Hls | null = null;
    let cancelled = false;

    // Safari supports HLS natively. Other browsers usually use hls.js.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playlistUrl;
      video.load();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 10,
        levelLoadingRetryDelay: 1000,
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) {
          setMessage("");
          void video.play().catch(() => {
            setMessage("Click play to view stream");
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && !cancelled) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setMessage("Buffering live stream...");
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              setMessage(`Stream error: ${data.details}. Check camera feed.`);
              break;
          }
        }
      });
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [playlistUrl, isSupported]);

  return (
    <div className={`relative flex h-full w-full items-center justify-center bg-black ${className}`}>
      <video
        ref={videoRef}
        controls
        muted
        autoPlay
        playsInline
        onPlaying={() => setMessage("")}
        className="h-full w-full object-contain"
      />
      {message && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
          <span className="rounded bg-black/80 px-2.5 py-1 text-[11px] text-slate-300 shadow">
            {message}
          </span>
        </div>
      )}
    </div>
  );
}
