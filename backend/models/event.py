from pydantic import BaseModel


class CaptureEvent(BaseModel):
    id: str
    timestamp: int
    type: str
    raw_content: str | None = None
    app_name: str | None = None
    url: str | None = None
    source: str
    page_text: str | None = None
    link_target: str | None = None
    metadata: dict | None = None
    file_path: str | None = None
    is_user_active: bool | None = None
