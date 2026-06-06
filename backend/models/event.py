from pydantic import BaseModel


class CaptureEvent(BaseModel):
    id: str
    timestamp: int
    type: str
    raw_content: str | None = None
    app_name: str | None = None
    url: str | None = None
    source: str
