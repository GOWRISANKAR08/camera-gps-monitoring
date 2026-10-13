
from rest_framework import serializers
from .models import Camera


class CameraSerializer(serializers.ModelSerializer):
    class Meta:
        model = Camera
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_stream_url(self, value):
        if value and not value.startswith(("rtsp://", "rtsps://", "http://", "https://")):
            raise serializers.ValidationError("Unsupported camera URL scheme.")
        return value
