"""
Async SQLAlchemy session factory.

Fixes:
- Removed pool_size/max_overflow — these conflict when connect_args includes ssl,
  and are not needed for typical single-worker dev setups.
- Added proper SSL detection for Neon/Supabase hosted Postgres.
- get_db generator correctly commits on success and rolls back on error.
"""
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings

connect_args = {}
db_url = settings.DATABASE_URL

# Strip sslmode query params that asyncpg can't handle; pass ssl= instead
if "neon.tech" in db_url or "supabase" in db_url or "sslmode=require" in db_url:
    db_url = db_url.split("?")[0]
    connect_args["ssl"] = "require"

engine = create_async_engine(
    db_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
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
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()