from django.contrib import admin
from .models import Camera


@admin.register(Camera)
class CameraAdmin(admin.ModelAdmin):
    list_display = ("name", "camera_type", "stream_url", "is_enabled", "connection_status", "created_at")
    list_filter = ("camera_type", "is_enabled")
    search_fields = ("name", "stream_url")
