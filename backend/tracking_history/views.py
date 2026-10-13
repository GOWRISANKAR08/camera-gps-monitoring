
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from gps_tracking.models import GPSDevice
from .models import LocationRecord
from .serializers import LocationRecordSerializer


class LocationIngestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LocationRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        device = serializer.validated_data["device"]
        session = serializer.validated_data["session"]

        if not device.is_enabled:
            return Response(
                {"detail": "GPS device is disabled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not session.device_id == device.id:
            return Response(
                {"detail": "Device and session do not match."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reading = serializer.save()

        # Only update the device's current location if this reading
        # is newer than the stored reading.
        if (
            device.last_seen_at is None
            or reading.recorded_at > device.last_seen_at
        ):
            device.last_latitude = reading.latitude
            device.last_longitude = reading.longitude
            device.last_seen_at = reading.recorded_at
            device.save(
                update_fields=[
                    "last_latitude",
                    "last_longitude",
                    "last_seen_at",
                ]
            )

        return Response(
            LocationRecordSerializer(reading).data,
            status=status.HTTP_201_CREATED,
        )


class LocationHistoryView(generics.ListAPIView):
    serializer_class = LocationRecordSerializer
    permission_classes = [AllowAny]
    authentication_classes = []

    def get_queryset(self):
        queryset = LocationRecord.objects.select_related(
            "device", "session"
        ).order_by("-recorded_at")

        device_id = self.request.query_params.get("device")
        session_id = self.request.query_params.get("session")

        if device_id:
            queryset = queryset.filter(device_id=device_id)

        if session_id:
            queryset = queryset.filter(session_id=session_id)

        return queryset[:500]
