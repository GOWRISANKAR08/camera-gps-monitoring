
from django.db import connection
from django.urls import include, path
from rest_framework import routers, status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from cameras.views import CameraViewSet
from gps_tracking.views import GPSDeviceViewSet
from destinations.views import DestinationViewSet
from tracking_sessions.views import TrackingSessionViewSet
from tracking_history.views import LocationIngestView, LocationHistoryView
from cameras.streaming_views import StreamStartView,StreamStatusView,StreamStopView

router = routers.DefaultRouter()
router.register("cameras", CameraViewSet, basename="camera")
router.register("devices", GPSDeviceViewSet, basename="gps-device")
router.register("destinations", DestinationViewSet, basename="destination")
router.register("sessions", TrackingSessionViewSet, basename="tracking-session")


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    try:
        connection.ensure_connection()
        db_status = "connected"
    except Exception:
        db_status = "unavailable"

    http_status = (
        status.HTTP_200_OK
        if db_status == "connected"
        else status.HTTP_503_SERVICE_UNAVAILABLE
    )

    return Response(
        {"api": "online", "database": db_status},
        status=http_status,
    )


urlpatterns = [
    path("health/", health, name="health"),
    path("", include(router.urls)),
    path("locations/ingest/", LocationIngestView.as_view(), name="location-ingest"),
    path("history/", LocationHistoryView.as_view(), name="location-history"),
    
    path("streams/start/", StreamStartView.as_view(), name="stream-start"),
    
    path("streams/<str:stream_id>/status/",StreamStatusView.as_view(),name="stream-status"),
    
    path("streams/<str:stream_id>/stop/",StreamStopView.as_view(),name="stream-stop"),
]
