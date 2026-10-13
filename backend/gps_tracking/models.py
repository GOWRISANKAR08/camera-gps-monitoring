from django.db import models


class GPSDevice(models.Model):
    name = models.CharField(max_length=120)
    device_identifier = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
    )
    is_enabled = models.BooleanField(default=True)
    last_latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
    )
    last_longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.device_identifier})"