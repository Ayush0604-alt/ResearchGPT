"""
SQLAlchemy declarative base.
All ORM models inherit from Base.
"""
from sqlalchemy.orm import DeclarativeBase, MappedColumn
from sqlalchemy import Integer
from sqlalchemy.orm import mapped_column


class Base(DeclarativeBase):
    pass
