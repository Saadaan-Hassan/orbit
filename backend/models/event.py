from pydantic import BaseModel, Field


class CaptureEvent(BaseModel):
    id: str = Field(max_length=128)
    timestamp: int
    type: str = Field(max_length=64)
    raw_content: str | None = Field(default=None, max_length=10_000)
    app_name: str | None = Field(default=None, max_length=512)
    url: str | None = Field(default=None, max_length=4_096)
    source: str = Field(max_length=64)
    page_text: str | None = Field(default=None, max_length=10_000)
    link_target: str | None = Field(default=None, max_length=4_096)
    metadata: dict | None = None
    file_path: str | None = Field(default=None, max_length=4_096)
    is_user_active: bool | None = None
    screen_text: str | None = Field(default=None, max_length=10_000)
