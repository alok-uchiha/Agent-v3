from contextlib import asynccontextmanager

from langgraph.checkpoint.mysql.asyncmy import AsyncMySaver
from sqlalchemy.engine import make_url


def to_saver_url(db_url):
    url = make_url(db_url).set(drivername="mysql")
    return url.render_as_string(hide_password=False)


@asynccontextmanager
async def open_checkpointer(db_url):
    async with AsyncMySaver.from_conn_string(to_saver_url(db_url)) as saver:
        await saver.setup()
        yield saver
        