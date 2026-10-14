from django.db import connection
from django.urls import include, path
from rest_framework import routers, status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from cameras.views import CameraViewSet
from cameras.streaming_views import StreamStartView, StreamStatusView, StreamStopView

router = routers.DefaultRouter()
router.register("cameras", CameraViewSet, basename="camera")


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
    path("streams/start/", StreamStartView.as_view(), name="stream-start"),
    path("streams/<str:stream_id>/status/", StreamStatusView.as_view(), name="stream-status"),
    path("streams/<str:stream_id>/stop/", StreamStopView.as_view(), name="stream-stop"),
]
