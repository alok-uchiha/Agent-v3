from langchain.agents import create_agent
from langchain.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.ai.prompt.prompts import system_prompt

model = create_agent(
    model="openrouter:nvidia/nemotron-3.5-lightning:free",
    tools=[],
    system_prompt=system_prompt,
    checkpointer=InMemorySaver()
)
