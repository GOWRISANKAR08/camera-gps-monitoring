
import ipaddress
import shutil
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings


FFMPEG_PATH = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"

HLS_ROOT = Path(settings.MEDIA_ROOT) / "hls"
HLS_ROOT.mkdir(parents=True, exist_ok=True)

# Development-only process registry. Use a dedicated process manager
# or shared registry for multi-worker production deployments.
STREAMS = {}
STREAM_LOCK = threading.Lock()


def validate_stream_url(stream_url: str) -> str:
    """Allow RTSP, HTTP, and HTTPS URLs pointing to private IPv4 addresses on the LAN or localhost."""
    parsed = urlparse(stream_url.strip())

    if parsed.scheme.lower() not in ("rtsp", "http", "https"):
        raise ValueError("Only rtsp://, http://, and https:// stream URLs are supported.")

    if not parsed.hostname:
        raise ValueError("The stream URL must include a host.")

    hostname = parsed.hostname
    if hostname.lower() == "localhost":
        hostname = "127.0.0.1"

    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        raise ValueError(
            "Use the camera's private IPv4 address or localhost in the stream URL."
        )

    if (
        address.version != 4
        or not (address.is_private or address.is_loopback)
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
    ):
        raise ValueError("The camera must use a private LAN IPv4 address or localhost.")

    return stream_url.strip()


def start_stream(stream_id: str, rtsp_url: str) -> dict:
    stream_url = validate_stream_url(rtsp_url)
    output_dir = HLS_ROOT / stream_id
    output_dir.mkdir(parents=True, exist_ok=True)

    playlist = output_dir / "index.m3u8"
    log_path = output_dir / "ffmpeg.log"

    parsed = urlparse(stream_url)
    is_rtsp = parsed.scheme.lower() == "rtsp"

    command = [
        FFMPEG_PATH,
        "-hide_banner",
        "-loglevel", "info",
    ]

    if is_rtsp:
        command.extend([
            "-rtsp_transport", "tcp+udp",
            "-timeout", "10000000",
        ])

    command.extend([
        "-probesize", "1000000",
        "-analyzeduration", "2000000",
        "-fflags", "nobuffer",
        "-i", stream_url,
        "-map", "0:v:0?",
        "-r", "25",
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-g", "25",
        "-f", "hls",
        "-hls_time", "1",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments+omit_endlist+temp_file",
        "-hls_segment_filename", str(output_dir / "segment_%05d.ts"),
        str(playlist),
    ])

    if not Path(FFMPEG_PATH).is_file():
        raise RuntimeError(
            f"FFmpeg executable not found: {FFMPEG_PATH}"
        )

    with STREAM_LOCK:
        if stream_id in STREAMS:
            raise ValueError("This stream ID is already in use.")

        log_file = open(log_path, "w", encoding="utf-8")
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=log_file,
            shell=False,
        )
        STREAMS[stream_id] = {
            "process": process,
            "output_dir": output_dir,
            "log_file": log_file,
        }

    # Briefly wait up to 1.5s to see if the playlist generates quickly or if FFmpeg exits
    start_time = time.time()
    ready = False
    while time.time() - start_time < 1.5:
        if playlist.is_file():
            ready = True
            break
        if process.poll() is not None:
            break
        time.sleep(0.1)

    failed = process.poll() is not None
    error_message = None
    if failed:
        try:
            log_file.flush()
            if log_path.is_file():
                with open(log_path, "r", encoding="utf-8") as f:
                    lines = [line.strip() for line in f if line.strip()]
                    if lines:
                        error_message = " - ".join(lines[-2:]) if len(lines) >= 2 else lines[-1]
        except Exception:
            pass

    return {
        "stream_id": stream_id,
        "status": "failed" if failed else "starting" if not ready else "running",
        "ready": ready,
        "error_detail": error_message,
        "playlist": f"{settings.MEDIA_URL.rstrip('/')}/hls/{stream_id}/index.m3u8",
    }


def get_stream_status(stream_id: str) -> dict:
    with STREAM_LOCK:
        stream = STREAMS.get(stream_id)

        if not stream:
            return {"stream_id": stream_id, "status": "not_found", "ready": False}

        process = stream["process"]
        running = process.poll() is None
        playlist_path = stream["output_dir"] / "index.m3u8"
        ready = playlist_path.is_file()

        error_message = None
        if not running:
            log_path = stream["output_dir"] / "ffmpeg.log"
            if log_path.is_file():
                try:
                    with open(log_path, "r", encoding="utf-8") as f:
                        lines = [line.strip() for line in f if line.strip()]
                        if lines:
                            error_message = " - ".join(lines[-2:]) if len(lines) >= 2 else lines[-1]
                except Exception:
                    pass

        return {
            "stream_id": stream_id,
            "status": "running" if running else "failed",
            "ready": ready,
            "return_code": process.poll(),
            "error_detail": error_message,
            "playlist": (
                f"{settings.MEDIA_URL.rstrip('/')}/hls/"
                f"{stream_id}/index.m3u8"
            ),
        }


def stop_stream(stream_id: str) -> bool:
    with STREAM_LOCK:
        stream = STREAMS.pop(stream_id, None)

    if not stream:
        return False

    process = stream["process"]
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)

    log_file = stream.get("log_file")
    if log_file and not log_file.closed:
        try:
            log_file.close()
        except Exception:
            pass

    # Clean up segment files and playlist while preserving the log file for diagnostics
    output_dir = stream.get("output_dir")
    if output_dir and output_dir.is_dir():
        for item in output_dir.iterdir():
            if item.name != "ffmpeg.log":
                if item.is_file():
                    item.unlink(missing_ok=True)
                elif item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)

    return True
