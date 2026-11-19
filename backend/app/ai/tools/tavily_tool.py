import logging
import time
from typing import Literal
import asyncio

from tavily import AsyncTavilyClient
from langchain.tools import tool
from pydantic import BaseModel, Field

from backend.app.ai.config.settings import get_setting


logger = logging.getLogger(__name__)

MAX_RESULTS = 5
MAX_CONTENT_CHARS = 1000
TIMEOUT_SECONDS= 20

_client : AsyncTavilyClient| None = None

def _get_client() -> AsyncTavilyClient:
    global _client

    if _client is None:
        key=get_setting().tavily_api_key.get_secret_value()
        if not key:
            raise RuntimeError("TAVILY_API_KEY is missing in env")
        _client = AsyncTavilyClient(api_key=key)
        logger.info("Tavily client created")

    return _client

class SearchInput(BaseModel):
    """What the LLM is allowed to send. Pydantic rejects anything else."""

    query : str = Field(
        min_length=1,
        max_length=400,
        description="A clear, specific search query"
    )

    topic : Literal["news", "finance", "general"] = Field(
        default="general",
        description="Use 'news' for recent events, 'finance' for markets, otherwise 'general'.",
    )

    time_range : Literal["day", "week", "month", "year"] | None = Field(
        default= None,
        description="Only return results from this recent period. Leave empty for any time.",
    )
    max_results: int = Field(
        default=MAX_RESULTS,
        ge=1,
        le=10,
        description="how many results to return (1-10)"
    )
    deep: bool = Field(
        default=False,
        description="True for hard research questions. Slower and costs more. Default False.",
    )



@tool("web_search", args_schema=SearchInput)
async def web_search(
    query : str,
    topic : str = "general",
    time_range : str | None = None,
    max_results : int = MAX_RESULTS,
    deep: bool = False,
) -> str :
    """Search the live web. ALWAYS use this for anything that changes over time:
    prices, availability, news, scores, software versions, who currently holds a role.
    Never answer those from memory, and never ask the user for permission to search. Just call it.
    Returns a short answer plus numbered sources with URLs. Cite the URLs you use."""


    logger.info("web search started | query=%r", query)
    start = time.perf_counter()


    try:
        response = await asyncio.wait_for(
            _get_client().search(
                query=query,
                topic=topic,
                time_range=time_range,
                max_results=max_results,
                search_depth="advanced" if deep else "basic",
                include_answer=True,
            ), timeout= TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning("web_search timeout | query=%r", query)
        return "Search failed: the search service timeout, try again later"
    except Exception as e:
        logger.exception("web search failed | query=%r", query)
        return f'search failed: {e}'

    results = response.get('results',[])
    duration = time.perf_counter() - start
    logger.info("web search done | results=%d | took=%.2fs", len(results), duration)

    if not results:
        logger.warning("web search returned nothing | query=%r", query)
        return f"no result found for: {query}"

    lines = []

    for i, r in enumerate(results, 1):
        content = r.get("content", "")[:MAX_CONTENT_CHARS]
        lines.append(
    f"[{i}] {r.get('title', 'untitled')}\n"
    f"{r.get('url', '')}\n"
    f"{content}"
)
    return"\n\n".join(lines)