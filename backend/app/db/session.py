"""
Async SQLAlchemy session factory.

- SSL detection for hosted Postgres (Neon, Supabase), which asyncpg needs as
  connect_args={"ssl": ...} rather than an ?sslmode= query parameter.
- An explicit connection pool. These were once removed as conflicting with the
  ssl connect_args, which they don't — they are pool arguments, not connection
  ones — and the defaults (5 + 10) left a ceiling the app's own fan-out could
  exhaust on a single request. See D-36 in claudeMD/decisions.md.
- get_db owns the transaction: it commits on success and rolls back on error.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

connect_args = {}
db_url = settings.DATABASE_URL

# Strip sslmode query params that asyncpg can't handle; pass ssl= instead
if "neon.tech" in db_url or "supabase" in db_url or "sslmode=require" in db_url:
    db_url = db_url.split("?")[0]
    connect_args["ssl"] = "require"

engine = create_async_engine(
    db_url,
    echo=settings.SQL_ECHO,
    pool_pre_ping=True,
    # Set explicitly rather than left at SQLAlchemy's 5 + 10. Request handlers
    # hold a connection while background work (search cache reads, collection
    # progress writes) opens its own, so the ceiling has to cover both at once;
    # see DB_FANOUT in app/services/search and collection_service.
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=1800,  # hosted Postgres (Neon) drops idle connections
    connect_args=connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Request-scoped session that owns the transaction.

    Routes only add/flush; the commit happens here once the handler returns,
    and FastAPI (>=0.106) runs this before the response is sent, so a failed
    commit becomes a 500 instead of a silently lost write. Background jobs open
    their own AsyncSessionLocal() and commit themselves.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
