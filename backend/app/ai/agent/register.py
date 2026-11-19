from backend.app.ai.agent.spec import AgentSpec
from backend.app.ai.prompt.research_prompt import build_researcher_prompt
from backend.app.ai.tools.tavily_tool import web_search


AGENTS : dict[str, AgentSpec] = {
    "researcher" : AgentSpec(
        name="researcher",
        prompt=build_researcher_prompt(),
        tools= (web_search,),
        model=None
    ),
}

