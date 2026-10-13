
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from gps_tracking.models import GPSDevice
from destinations.models import Destination
from tracking_sessions.models import TrackingSession
from tracking_history.models import LocationRecord


class TrackingAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.device = GPSDevice.objects.create(
            name="Test GPS",
            device_identifier="TEST-GPS-001",
        )
        self.destination = Destination.objects.create(
            name="Test Destination",
            latitude=19.076000,
            longitude=72.877700,
        )
        self.session = TrackingSession.objects.create(
            device=self.device,
            destination=self.destination,
            status="active",
        )

    def test_health_endpoint(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["database"], "connected")

    def test_destination_list(self):
        response = self.client.get("/api/destinations/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_ingest_valid_location(self):
        response = self.client.post(
            "/api/locations/ingest/",
            {
                "device": self.device.id,
                "session": self.session.id,
                "latitude": 19.079200,
                "longitude": 72.878000,
                "accuracy_meters": 4.0,
                "recorded_at": "2026-10-12T12:30:00Z",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(LocationRecord.objects.count(), 1)

        self.device.refresh_from_db()
        self.assertAlmostEqual(
            float(self.device.last_latitude), 19.0792, places=4
        )

    def test_invalid_coordinates_rejected(self):
        response = self.client.post(
            "/api/locations/ingest/",
            {
                "device": self.device.id,
                "session": self.session.id,
                "latitude": 100,
                "longitude": 72.878,
                "recorded_at": "2026-10-12T12:30:00Z",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_pause_and_resume_session(self):
        response = self.client.post(
            f"/api/sessions/{self.session.id}/pause/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "paused")

        response = self.client.post(
            f"/api/sessions/{self.session.id}/resume/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "active")

    def test_stop_session(self):
        response = self.client.post(
            f"/api/sessions/{self.session.id}/stop/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "stopped")
        self.assertIsNotNone(response.data["ended_at"])
