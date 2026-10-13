
from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from .models import Camera
from .serializers import CameraSerializer


class CameraViewSet(viewsets.ModelViewSet):
    queryset = Camera.objects.all().order_by("-created_at")
    serializer_class = CameraSerializer
    permission_classes = [AllowAny]
    authentication_classes = []
