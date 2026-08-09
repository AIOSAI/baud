# Handlers

Implementation details for `BAUD`. Pure functions where possible.

Handlers do the actual work — file I/O, data transforms, external calls. They never import from modules/ (no circular deps).
