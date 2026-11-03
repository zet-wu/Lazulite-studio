"""TTML string fixture for document round-trip assertions."""
import xml.etree.ElementTree as ET
from server.time_units import normalize_ttml_tree, serialize_ttml

def normalized_ttml(value):
    root = ET.fromstring(value)
    normalize_ttml_tree(root)
    return serialize_ttml(root)
