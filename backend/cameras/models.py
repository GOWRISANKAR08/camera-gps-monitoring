from django.db import models


class Camera(models.Model):
    class CameraType(models.TextChoices):
        USB = "USB", "USB / Webcam"
        RTSP = "RTSP", "RTSP Camera"
        IP = "IP", "External / IP Camera"

    name = models.CharField(max_length=120)
    camera_type = models.CharField(
        max_length=10,
        choices=CameraType.choices,
    )
    stream_url = models.URLField(blank=True)
    is_enabled = models.BooleanField(default=True)
    connection_status = models.CharField(
        max_length=20,
        default="disconnected",
    )
    
    stream_url = models.CharField(max_length=1000, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name