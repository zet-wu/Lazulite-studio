"""Studio integer milliseconds; external engines and media keep native units."""
from decimal import Decimal, ROUND_HALF_UP

def milliseconds(seconds):
    if seconds is None:
        return None
    value = Decimal(str(seconds)) * 1000
    if not value.is_finite() or value < 0:
        raise ValueError("time must be finite and non-negative")
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))

def clock(ms):
    minutes, remainder = divmod(ms, 60000)
    seconds, fraction = divmod(remainder, 1000)
    hours, minutes = divmod(minutes, 60)
    tail = f"{minutes:02d}:{seconds:02d}.{fraction:03d}"
    return f"{hours:02d}:{tail}" if hours else tail
