
from django.db import transaction
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

from gps_tracking.models import GPSDevice
from .models import TrackingSession
from .serializers import TrackingSessionSerializer


class TrackingSessionViewSet(viewsets.ModelViewSet):
    serializer_class = TrackingSessionSerializer
    permission_classes = [AllowAny]
    authentication_classes = []

    queryset = TrackingSession.objects.select_related(
        "device", "destination"
    ).order_by("-started_at")

    def create(self, request, *args, **kwargs):
        device_id = request.data.get("device")
        destination_id = request.data.get("destination")

        if not device_id:
            return Response(
                {"device": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            device = GPSDevice.objects.get(
                pk=device_id,
                is_enabled=True,
            )
        except (GPSDevice.DoesNotExist, ValueError, TypeError):
            return Response(
                {"device": ["Enabled GPS device not found."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        destination = None
        if destination_id not in (None, ""):
            from destinations.models import Destination

            try:
                destination = Destination.objects.get(pk=destination_id)
            except (Destination.DoesNotExist, ValueError, TypeError):
                return Response(
                    {"destination": ["Destination not found."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            if TrackingSession.objects.select_for_update().filter(
                device=device,
                status="active",
            ).exists():
                return Response(
                    {"detail": "This device already has an active session."},
                    status=status.HTTP_409_CONFLICT,
                )

            session = TrackingSession.objects.create(
                device=device,
                destination=destination,
                status=TrackingSession.Status.ACTIVE,
            )

        return Response(
            self.get_serializer(session).data,
            status=status.HTTP_201_CREATED,
        )

    def _transition(self, session, new_status):
        if session.status == TrackingSession.Status.STOPPED:
            return Response(
                {"detail": "A stopped session cannot be changed."},
                status=status.HTTP_409_CONFLICT,
            )

        allowed = {
            "pause": (
                TrackingSession.Status.ACTIVE,
                TrackingSession.Status.PAUSED,
            ),
            "resume": (
                TrackingSession.Status.PAUSED,
                TrackingSession.Status.ACTIVE,
            ),
            "stop": (
                (TrackingSession.Status.ACTIVE,
                 TrackingSession.Status.PAUSED),
                TrackingSession.Status.STOPPED,
            ),
        }

        expected, target = allowed[new_status]
        valid = session.status in expected if isinstance(
            expected, tuple
        ) else session.status == expected

        if not valid:
            return Response(
                {"detail": f"Cannot {new_status} a session in '{session.status}' state."},
                status=status.HTTP_409_CONFLICT,
            )

        session.status = target

        if target == TrackingSession.Status.STOPPED:
            session.ended_at = timezone.now()

        session.save(update_fields=[
            "status", "ended_at", "updated_at"
        ])

        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        return self._transition(
            self.get_object(), "pause"
        )

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        return self._transition(
            self.get_object(), "resume"
        )

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        return self._transition(
            self.get_object(), "stop"
        )
