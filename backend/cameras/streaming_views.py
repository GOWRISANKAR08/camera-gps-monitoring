
import uuid

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .streaming import (
    get_stream_status,
    start_stream,
    stop_stream,
)


class StreamStartView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        stream_url = request.data.get("rtsp_url") or request.data.get("stream_url")

        if not isinstance(stream_url, str) or not stream_url.strip():
            return Response(
                {"error": "stream_url is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stream_id = uuid.uuid4().hex

        try:
            print(f"[STREAM] Starting camera stream {stream_id} for {stream_url.strip()}")
            result = start_stream(stream_id, stream_url.strip())
            return Response(result, status=status.HTTP_201_CREATED)
        except ValueError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except (OSError, RuntimeError) as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class StreamStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, stream_id):
        result = get_stream_status(stream_id)

        if result["status"] == "not_found":
            return Response(result, status=status.HTTP_404_NOT_FOUND)

        return Response(result)


class StreamStopView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, stream_id):
        stopped = stop_stream(stream_id)

        if not stopped:
            return Response(
                {"error": "Stream not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "stream_id": stream_id,
            "status": "stopped",
        })
