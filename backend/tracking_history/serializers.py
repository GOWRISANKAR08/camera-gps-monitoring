
from rest_framework import serializers
from .models import LocationRecord


class LocationRecordSerializer(serializers.ModelSerializer):
    device_identifier = serializers.CharField(
        source="device.device_identifier",
        read_only=True,
    )

    class Meta:
        model = LocationRecord
        fields = [
            "id",
            "device",
            "device_identifier",
            "session",
            "latitude",
            "longitude",
            "accuracy_meters",
            "recorded_at",
            "received_at",
        ]
        read_only_fields = ["id", "received_at"]

    def validate(self, attrs):
        latitude = attrs.get("latitude")
        longitude = attrs.get("longitude")
        accuracy = attrs.get("accuracy_meters")

        if latitude is not None and not -90 <= latitude <= 90:
            raise serializers.ValidationError({
                "latitude": "Must be between -90 and 90."
            })

        if longitude is not None and not -180 <= longitude <= 180:
            raise serializers.ValidationError({
                "longitude": "Must be between -180 and 180."
            })

        if accuracy is not None and accuracy < 0:
            raise serializers.ValidationError({
                "accuracy_meters": "Must be non-negative."
            })

        session = attrs.get("session")
        device = attrs.get("device")

        if session and device and session.device_id != device.id:
            raise serializers.ValidationError({
                "session": "Session does not belong to this GPS device."
            })

        if session and session.status != "active":
            raise serializers.ValidationError({
                "session": "GPS readings can only be recorded for active sessions."
            })

        return attrs
