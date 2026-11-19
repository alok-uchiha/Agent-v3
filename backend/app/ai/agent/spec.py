from dataclasses import dataclass

from langchain_core.tools import BaseTool



@dataclass(frozen=True)
class AgentSpec:
    name : str
    prompt : str
    tools : tuple[BaseTool, ...] = ()
    model:str | None = None
    