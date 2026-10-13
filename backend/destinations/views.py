
from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from .models import Destination
from .serializers import DestinationSerializer


class DestinationViewSet(viewsets.ModelViewSet):
    queryset = Destination.objects.all().order_by("-created_at")
    serializer_class = DestinationSerializer
    permission_classes = [AllowAny]
    authentication_classes = []
