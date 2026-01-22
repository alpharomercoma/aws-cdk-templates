"""
FastAPI Application for AWS Infrastructure PoC

This application demonstrates:
- RESTful API endpoints
- JSON responses
- HTML template rendering
- Timezone-aware datetime handling

Endpoints:
- GET /health - Health check endpoint for ALB
- GET /hello - Returns "Hello World" as JSON
- GET /time - Returns current Philippine time as JSON
- GET /time-html - Returns current Philippine time as HTML
"""

from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

app = FastAPI(
    title="AWS Infrastructure PoC API",
    description="Demonstration API for AWS WAF, ALB, EC2, CloudFront integration",
    version="1.0.0",
)

templates = Jinja2Templates(directory="templates")

# Philippine timezone
PH_TZ = ZoneInfo("Asia/Manila")


@app.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint for ALB target group.
    Returns 200 OK if the application is running.
    """
    return {"status": "healthy", "service": "aws-infra-poc-api"}


@app.get("/hello", tags=["API"])
async def hello_world():
    """
    Returns a simple Hello World message as JSON.
    Demonstrates basic REST API response.
    """
    return {"message": "Hello World", "source": "AWS EC2 FastAPI"}


@app.get("/time", tags=["API"])
async def get_philippine_time():
    """
    Returns the current time in the Philippines as JSON.
    Uses Asia/Manila timezone (UTC+8).
    """
    now = datetime.now(PH_TZ)
    return {
        "timezone": "Asia/Manila",
        "utc_offset": "+08:00",
        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "iso_format": now.isoformat(),
        "unix_timestamp": int(now.timestamp()),
        "day_of_week": now.strftime("%A"),
    }


@app.get("/time-html", response_class=HTMLResponse, tags=["Web"])
async def get_philippine_time_html(request: Request):
    """
    Returns the current Philippine time rendered in an HTML template.
    Demonstrates server-side rendering with Jinja2.
    """
    now = datetime.now(PH_TZ)
    return templates.TemplateResponse(
        "time.html",
        {
            "request": request,
            "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": "Asia/Manila (Philippine Standard Time)",
            "day_of_week": now.strftime("%A"),
            "date_formatted": now.strftime("%B %d, %Y"),
        },
    )


@app.get("/", tags=["Web"])
async def root():
    """
    Root endpoint - redirects to API documentation.
    """
    return {
        "message": "AWS Infrastructure PoC API",
        "docs": "/docs",
        "endpoints": {
            "health": "/health",
            "hello": "/hello",
            "time_json": "/time",
            "time_html": "/time-html",
        },
    }
