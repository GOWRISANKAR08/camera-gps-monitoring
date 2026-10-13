
from rest_framework import serializers
from .models import GPSDevice


class GPSDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = GPSDevice
        fields = "__all__"
        read_only_fields = ["id", "last_seen_at", "last_latitude", "last_longitude", "created_at"]
