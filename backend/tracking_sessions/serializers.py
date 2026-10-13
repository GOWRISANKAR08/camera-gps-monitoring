
from rest_framework import serializers
from .models import TrackingSession


class TrackingSessionSerializer(serializers.ModelSerializer):
    device_identifier = serializers.CharField(
        source="device.device_identifier",
        read_only=True,
    )
    destination_name = serializers.CharField(
        source="destination.name",
        read_only=True,
        default=None,
    )

    class Meta:
        model = TrackingSession
        fields = [
            "id",
            "device",
            "device_identifier",
            "destination",
            "destination_name",
            "status",
            "started_at",
            "ended_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "status", "started_at", "ended_at", "updated_at"
        ]
