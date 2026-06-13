from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings

# Strip sslmode/channel_binding from URL and pass ssl=True separately
# asyncpg doesn't accept these as query params
connect_args = {}
db_url = settings.DATABASE_URL

if "neon.tech" in db_url or "sslmode" in db_url:
    # Remove query params asyncpg can't handle
    db_url = db_url.split("?")[0]
    connect_args["ssl"] = "require"

engine = create_async_engine(
    db_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
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