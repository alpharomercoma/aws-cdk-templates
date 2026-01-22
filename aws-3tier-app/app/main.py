"""
FastAPI 3-Tier Application

This application demonstrates a production-grade 3-tier architecture:
- Presentation: FastAPI REST endpoints
- Application: Business logic with caching
- Data: PostgreSQL (persistent) + Redis (cache)

Features:
- CRUD operations with PostgreSQL
- Cache-aside caching pattern with Redis
- Health checks for all services
- Timezone-aware datetime (Philippine time)
- Proper error handling and logging
"""

import os
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import asyncpg
import redis.asyncio as redis

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Philippine timezone
PH_TZ = ZoneInfo("Asia/Manila")

# Environment variables (injected by EC2 user data)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "appdb")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

# Cache TTL in seconds
CACHE_TTL = 60


# Pydantic models
class VisitorCreate(BaseModel):
    name: str
    message: Optional[str] = None


class Visitor(BaseModel):
    id: int
    name: str
    message: Optional[str]
    visit_time: datetime
    visit_count: int


class HealthStatus(BaseModel):
    status: str
    database: str
    cache: str
    timestamp: str


# Global connection pools
db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[redis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for connection pools."""
    global db_pool, redis_client

    # Startup
    logger.info("Starting application...")

    # Initialize PostgreSQL connection pool
    try:
        db_pool = await asyncpg.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            min_size=2,
            max_size=10,
            command_timeout=60,
        )
        logger.info(f"Connected to PostgreSQL at {DB_HOST}:{DB_PORT}")

        # Create tables if not exists
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS visitors (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    message TEXT,
                    visit_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    visit_count INTEGER DEFAULT 1
                )
            """)
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_visitors_name ON visitors(name)
            """)
        logger.info("Database tables initialized")
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        db_pool = None

    # Initialize Redis connection
    try:
        redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            decode_responses=True,
            socket_timeout=5,
        )
        await redis_client.ping()
        logger.info(f"Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        redis_client = None

    yield

    # Shutdown
    logger.info("Shutting down application...")
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()


app = FastAPI(
    title="AWS 3-Tier Application API",
    description="Demonstration of PostgreSQL + ElastiCache Redis integration",
    version="1.0.0",
    lifespan=lifespan,
)

templates = Jinja2Templates(directory="templates")


# Dependency for database connection
async def get_db():
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with db_pool.acquire() as conn:
        yield conn


# Dependency for Redis connection
async def get_redis():
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Cache unavailable")
    return redis_client


# ================================================================
# Health Check Endpoints
# ================================================================

@app.get("/health", tags=["Health"])
async def health_check():
    """
    Comprehensive health check for ALB target group.
    Checks connectivity to PostgreSQL and Redis.
    """
    db_status = "healthy"
    cache_status = "healthy"

    # Check PostgreSQL
    try:
        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        else:
            db_status = "unavailable"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    # Check Redis
    try:
        if redis_client:
            await redis_client.ping()
        else:
            cache_status = "unavailable"
    except Exception as e:
        cache_status = f"unhealthy: {str(e)}"

    overall_status = "healthy" if db_status == "healthy" and cache_status == "healthy" else "degraded"

    return {
        "status": overall_status,
        "database": db_status,
        "cache": cache_status,
        "timestamp": datetime.now(PH_TZ).isoformat(),
    }


@app.get("/health/db", tags=["Health"])
async def health_db(conn=Depends(get_db)):
    """Database-specific health check."""
    result = await conn.fetchval("SELECT version()")
    return {"status": "healthy", "version": result}


@app.get("/health/cache", tags=["Health"])
async def health_cache(cache=Depends(get_redis)):
    """Redis-specific health check."""
    info = await cache.info("server")
    return {"status": "healthy", "redis_version": info.get("redis_version")}


# ================================================================
# API Endpoints
# ================================================================

@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API information."""
    return {
        "message": "AWS 3-Tier Application API",
        "architecture": {
            "presentation": "FastAPI + CloudFront",
            "application": "EC2 (t4g.small)",
            "data": "PostgreSQL RDS + ElastiCache Redis",
        },
        "endpoints": {
            "health": "/health",
            "hello": "/hello",
            "time_json": "/time",
            "time_html": "/time-html",
            "visitors": "/visitors",
            "stats": "/stats",
        },
        "docs": "/docs",
    }


@app.get("/hello", tags=["API"])
async def hello_world():
    """Returns Hello World with tier information."""
    return {
        "message": "Hello World from 3-Tier Architecture!",
        "tiers": ["Presentation (CloudFront/ALB)", "Application (EC2)", "Data (RDS/Redis)"],
    }


@app.get("/time", tags=["API"])
async def get_philippine_time(cache=Depends(get_redis)):
    """
    Returns Philippine time with caching demonstration.
    Cached for 1 second to show cache behavior.
    """
    cache_key = "philippine_time"

    # Try cache first (cache-aside pattern)
    try:
        cached = await cache.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["from_cache"] = True
            return data
    except Exception as e:
        logger.warning(f"Cache read failed: {e}")

    # Generate fresh data
    now = datetime.now(PH_TZ)
    data = {
        "timezone": "Asia/Manila",
        "utc_offset": "+08:00",
        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "iso_format": now.isoformat(),
        "unix_timestamp": int(now.timestamp()),
        "day_of_week": now.strftime("%A"),
        "from_cache": False,
    }

    # Cache the result (short TTL for demo)
    try:
        await cache.setex(cache_key, 1, json.dumps(data))
    except Exception as e:
        logger.warning(f"Cache write failed: {e}")

    return data


@app.get("/time-html", response_class=HTMLResponse, tags=["Web"])
async def get_philippine_time_html(request: Request):
    """Returns Philippine time as HTML."""
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


# ================================================================
# Visitor CRUD Endpoints (Database + Cache Demo)
# ================================================================

@app.post("/visitors", tags=["Visitors"])
async def create_visitor(visitor: VisitorCreate, conn=Depends(get_db), cache=Depends(get_redis)):
    """
    Create or update a visitor record.
    Demonstrates write-through caching pattern.
    """
    # Check if visitor exists
    existing = await conn.fetchrow(
        "SELECT id, visit_count FROM visitors WHERE name = $1",
        visitor.name
    )

    if existing:
        # Update existing visitor
        result = await conn.fetchrow(
            """
            UPDATE visitors
            SET message = $1, visit_time = NOW(), visit_count = visit_count + 1
            WHERE name = $2
            RETURNING id, name, message, visit_time, visit_count
            """,
            visitor.message,
            visitor.name
        )
    else:
        # Create new visitor
        result = await conn.fetchrow(
            """
            INSERT INTO visitors (name, message)
            VALUES ($1, $2)
            RETURNING id, name, message, visit_time, visit_count
            """,
            visitor.name,
            visitor.message
        )

    # Invalidate cache
    try:
        await cache.delete(f"visitor:{visitor.name}")
        await cache.delete("visitors:all")
        await cache.delete("stats")
    except Exception as e:
        logger.warning(f"Cache invalidation failed: {e}")

    return {
        "id": result["id"],
        "name": result["name"],
        "message": result["message"],
        "visit_time": result["visit_time"].isoformat(),
        "visit_count": result["visit_count"],
    }


@app.get("/visitors", tags=["Visitors"])
async def get_visitors(
    limit: int = 10,
    conn=Depends(get_db),
    cache=Depends(get_redis)
):
    """
    Get recent visitors with caching.
    Demonstrates cache-aside pattern for reads.
    """
    cache_key = "visitors:all"

    # Try cache first
    try:
        cached = await cache.get(cache_key)
        if cached:
            data = json.loads(cached)
            return {"visitors": data, "from_cache": True}
    except Exception as e:
        logger.warning(f"Cache read failed: {e}")

    # Query database
    rows = await conn.fetch(
        """
        SELECT id, name, message, visit_time, visit_count
        FROM visitors
        ORDER BY visit_time DESC
        LIMIT $1
        """,
        limit
    )

    visitors = [
        {
            "id": row["id"],
            "name": row["name"],
            "message": row["message"],
            "visit_time": row["visit_time"].isoformat(),
            "visit_count": row["visit_count"],
        }
        for row in rows
    ]

    # Cache result
    try:
        await cache.setex(cache_key, CACHE_TTL, json.dumps(visitors))
    except Exception as e:
        logger.warning(f"Cache write failed: {e}")

    return {"visitors": visitors, "from_cache": False}


@app.get("/visitors/{name}", tags=["Visitors"])
async def get_visitor(name: str, conn=Depends(get_db), cache=Depends(get_redis)):
    """Get a specific visitor by name with caching."""
    cache_key = f"visitor:{name}"

    # Try cache first
    try:
        cached = await cache.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["from_cache"] = True
            return data
    except Exception as e:
        logger.warning(f"Cache read failed: {e}")

    # Query database
    row = await conn.fetchrow(
        "SELECT id, name, message, visit_time, visit_count FROM visitors WHERE name = $1",
        name
    )

    if not row:
        raise HTTPException(status_code=404, detail=f"Visitor '{name}' not found")

    visitor = {
        "id": row["id"],
        "name": row["name"],
        "message": row["message"],
        "visit_time": row["visit_time"].isoformat(),
        "visit_count": row["visit_count"],
        "from_cache": False,
    }

    # Cache result
    try:
        await cache.setex(cache_key, CACHE_TTL, json.dumps(visitor))
    except Exception as e:
        logger.warning(f"Cache write failed: {e}")

    return visitor


@app.delete("/visitors/{name}", tags=["Visitors"])
async def delete_visitor(name: str, conn=Depends(get_db), cache=Depends(get_redis)):
    """Delete a visitor and invalidate cache."""
    result = await conn.execute(
        "DELETE FROM visitors WHERE name = $1",
        name
    )

    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail=f"Visitor '{name}' not found")

    # Invalidate cache
    try:
        await cache.delete(f"visitor:{name}")
        await cache.delete("visitors:all")
        await cache.delete("stats")
    except Exception as e:
        logger.warning(f"Cache invalidation failed: {e}")

    return {"message": f"Visitor '{name}' deleted"}


# ================================================================
# Statistics Endpoint (Aggregation + Caching Demo)
# ================================================================

@app.get("/stats", tags=["Statistics"])
async def get_stats(conn=Depends(get_db), cache=Depends(get_redis)):
    """
    Get visitor statistics with caching.
    Demonstrates caching of computed/aggregated data.
    """
    cache_key = "stats"

    # Try cache first
    try:
        cached = await cache.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["from_cache"] = True
            return data
    except Exception as e:
        logger.warning(f"Cache read failed: {e}")

    # Query database for statistics
    stats = await conn.fetchrow("""
        SELECT
            COUNT(*) as total_visitors,
            COALESCE(SUM(visit_count), 0) as total_visits,
            MAX(visit_time) as last_visit,
            AVG(visit_count)::numeric(10,2) as avg_visits_per_visitor
        FROM visitors
    """)

    # Get top visitors
    top_visitors = await conn.fetch("""
        SELECT name, visit_count
        FROM visitors
        ORDER BY visit_count DESC
        LIMIT 5
    """)

    data = {
        "total_visitors": stats["total_visitors"],
        "total_visits": stats["total_visits"],
        "last_visit": stats["last_visit"].isoformat() if stats["last_visit"] else None,
        "avg_visits_per_visitor": float(stats["avg_visits_per_visitor"]) if stats["avg_visits_per_visitor"] else 0,
        "top_visitors": [{"name": v["name"], "visits": v["visit_count"]} for v in top_visitors],
        "from_cache": False,
    }

    # Cache result
    try:
        await cache.setex(cache_key, CACHE_TTL, json.dumps(data))
    except Exception as e:
        logger.warning(f"Cache write failed: {e}")

    return data


# ================================================================
# Cache Management Endpoints
# ================================================================

@app.post("/cache/clear", tags=["Cache"])
async def clear_cache(cache=Depends(get_redis)):
    """Clear all application cache."""
    try:
        keys = await cache.keys("*")
        if keys:
            await cache.delete(*keys)
        return {"message": f"Cleared {len(keys)} cache keys"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cache clear failed: {e}")


@app.get("/cache/stats", tags=["Cache"])
async def cache_stats(cache=Depends(get_redis)):
    """Get Redis cache statistics."""
    info = await cache.info()
    return {
        "used_memory": info.get("used_memory_human"),
        "connected_clients": info.get("connected_clients"),
        "total_connections_received": info.get("total_connections_received"),
        "keyspace_hits": info.get("keyspace_hits"),
        "keyspace_misses": info.get("keyspace_misses"),
        "hit_rate": (
            round(info.get("keyspace_hits", 0) / max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 1), 1) * 100, 2)
        ),
    }
