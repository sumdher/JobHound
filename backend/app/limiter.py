"""
Shared slowapi rate-limiter instance.
Import `limiter` in routers to apply per-endpoint limits.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
