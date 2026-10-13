
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

from .models import GPSDevice
from .serializers import GPSDeviceSerializer
from tracking_history.models import LocationRecord
from tracking_history.serializers import LocationRecordSerializer


class GPSDeviceViewSet(viewsets.ModelViewSet):
    queryset = GPSDevice.objects.all().order_by("id")
    serializer_class = GPSDeviceSerializer
    permission_classes = [AllowAny]
    authentication_classes = []

    @action(detail=True, methods=["get"], url_path="location")
    def location(self, request, pk=None):
        device = self.get_object()
        reading = device.location_history.order_by(
            "-recorded_at"
        ).first()

        if reading is None:
            return Response(
                {"detail": "No GPS readings have been received."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(LocationRecordSerializer(reading).data)
