from django.db import models


class LocationRecord(models.Model):
    device = models.ForeignKey(
        "gps_tracking.GPSDevice",
        on_delete=models.PROTECT,
        related_name="location_history",
    )
    session = models.ForeignKey(
        "tracking_sessions.TrackingSession",
        on_delete=models.CASCADE,
        related_name="locations",
    )
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
    )
    accuracy_meters = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(db_index=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]
        indexes = [
            models.Index(
                fields=["device", "recorded_at"],
                name="gps_device_time_idx",
            ),
            models.Index(
                fields=["session", "recorded_at"],
                name="gps_session_time_idx",
            ),
        ]

    def __str__(self):
        return f"GPS record {self.pk}"